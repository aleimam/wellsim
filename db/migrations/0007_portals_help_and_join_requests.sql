BEGIN;

-- Companies are private by default. An owner/administrator must explicitly
-- opt in before the company appears in the authenticated join directory.
ALTER TABLE app.organization
  ADD COLUMN join_policy text NOT NULL DEFAULT 'invite_only'
    CHECK (join_policy IN ('invite_only','request')),
  ADD COLUMN directory_summary text NOT NULL DEFAULT ''
    CHECK (length(directory_summary) <= 500 AND directory_summary !~ '[[:cntrl:]]');

CREATE TABLE app.organization_join_request (
  workspace_id uuid NOT NULL REFERENCES app.organization(workspace_id),
  id uuid NOT NULL,
  requester_user_id uuid NOT NULL REFERENCES app.app_user(id),
  requested_role text NOT NULL DEFAULT 'engineer' CHECK (requested_role = 'engineer'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','cancelled')),
  reviewed_by uuid,
  requested_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  reviewed_at timestamptz,
  PRIMARY KEY (workspace_id,id),
  FOREIGN KEY (workspace_id,reviewed_by)
    REFERENCES app.membership(workspace_id,user_id),
  CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status='cancelled' AND reviewed_by IS NULL AND reviewed_at IS NOT NULL)
    OR (status IN ('approved','declined') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX organization_join_request_pending_uidx
  ON app.organization_join_request(requester_user_id,workspace_id) WHERE status='pending';
CREATE INDEX organization_join_request_company_idx
  ON app.organization_join_request(workspace_id,status,requested_at DESC);
CREATE INDEX organization_join_request_user_idx
  ON app.organization_join_request(requester_user_id,requested_at DESC);

-- Platform administrators are deliberately independent of company roles.
-- This table has no self-service API: the migration owner provisions the
-- first administrator after that person has completed verified sign-in.
CREATE TABLE app.platform_administrator (
  user_id uuid PRIMARY KEY REFERENCES app.app_user(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  granted_by uuid REFERENCES app.app_user(id),
  granted_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

-- Help content is revisioned. Publishing only moves a pointer to an immutable
-- revision, making rollback and review possible without accepting HTML.
CREATE TABLE app.help_page (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=80),
  section_key text NOT NULL CHECK (section_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(section_key)<=80),
  sort_order integer NOT NULL DEFAULT 100 CHECK (sort_order BETWEEN 0 AND 10000),
  draft_revision_id uuid,
  published_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE app.help_revision (
  page_slug text NOT NULL REFERENCES app.help_page(slug),
  id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number>0),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160 AND title !~ '[[:cntrl:]]'),
  summary text NOT NULL CHECK (length(summary)<=500 AND summary !~ '[[:cntrl:]]'),
  body_markdown text NOT NULL CHECK (length(body_markdown) BETWEEN 1 AND 100000),
  created_by uuid NOT NULL REFERENCES app.platform_administrator(user_id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (id),
  UNIQUE (page_slug,id),
  UNIQUE (page_slug,revision_number)
);
ALTER TABLE app.help_page ADD CONSTRAINT help_page_draft_revision_fk
  FOREIGN KEY (slug,draft_revision_id) REFERENCES app.help_revision(page_slug,id);
ALTER TABLE app.help_page ADD CONSTRAINT help_page_published_revision_fk
  FOREIGN KEY (slug,published_revision_id) REFERENCES app.help_revision(page_slug,id);

CREATE TABLE app.platform_audit_event (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES app.platform_administrator(user_id),
  action text NOT NULL,
  target_slug text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

-- Even tables reachable only through fixed SECURITY DEFINER functions retain
-- RLS as defense in depth. No direct runtime table grants are added below.
ALTER TABLE app.organization_join_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_administrator ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.help_page ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.help_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.platform_audit_event ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app.help_catalog()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'slug',p.slug,'section',p.section_key,'sortOrder',p.sort_order,
    'title',r.title,'summary',r.summary,'updatedAt',r.created_at)
    ORDER BY p.section_key,p.sort_order,p.slug),'[]'::jsonb)
  FROM app.help_page p JOIN app.help_revision r
    ON r.page_slug=p.slug AND r.id=p.published_revision_id;
$function$;

CREATE FUNCTION app.help_read(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
  SELECT jsonb_build_object('slug',p.slug,'section',p.section_key,'sortOrder',p.sort_order,
    'title',r.title,'summary',r.summary,'bodyMarkdown',r.body_markdown,
    'revision',r.revision_number,'updatedAt',r.created_at)
  FROM app.help_page p JOIN app.help_revision r
    ON r.page_slug=p.slug AND r.id=p.published_revision_id
  WHERE p.slug=p_slug;
$function$;

-- Authenticated operations for personal/company portals. Company IDs are
-- selections only: every company operation rechecks active membership after
-- locking that exact organization. Join approval always grants engineer.
CREATE FUNCTION app.portal_command(p_hash text,p_action text,p_workspace uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE
  actor uuid; actor_role text; label text; policy text; target uuid; decision text;
  request_row app.organization_join_request%ROWTYPE; result jsonb; mfa_required boolean:=false;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('context','directory.search','join.mine','join.create','join.cancel',
      'company.settings.get','company.settings.update','company.join.list','company.join.review')
    OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>8192 THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT u.id INTO actor FROM app.web_session s JOIN app.app_user u ON u.id=s.user_id
    WHERE s.token_hash=p_hash AND u.status='active' AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      AND s.verified_email=lower(u.email);
  IF actor IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;

  IF p_action='context' THEN
    RETURN jsonb_build_object('platformAdministrator',EXISTS(
      SELECT FROM app.platform_administrator a WHERE a.user_id=actor AND a.status='active'));
  ELSIF p_action='directory.search' THEN
    label:=lower(btrim(coalesce(p_input->>'query','')));
    IF length(label)>80 OR label~'[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
    SELECT coalesce(jsonb_agg(item ORDER BY item->>'name'),'[]'::jsonb) INTO result FROM (
      SELECT jsonb_build_object('id',w.id,'name',w.name,'summary',o.directory_summary) item
      FROM app.organization o JOIN app.workspace w ON w.id=o.workspace_id
      WHERE w.status='active' AND o.join_policy='request'
        AND (label='' OR lower(w.name) LIKE '%'||label||'%' OR lower(o.directory_summary) LIKE '%'||label||'%')
        AND NOT EXISTS (SELECT FROM app.membership m WHERE m.workspace_id=w.id AND m.user_id=actor)
        AND NOT EXISTS (SELECT FROM app.organization_join_request r
          WHERE r.workspace_id=w.id AND r.requester_user_id=actor AND r.status='pending')
      ORDER BY w.name,w.id LIMIT 25
    ) q;
    RETURN result;
  ELSIF p_action='join.mine' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'workspaceId',r.workspace_id,'companyName',w.name,
      'status',r.status,'requestedRole',r.requested_role,'requestedAt',r.requested_at,'reviewedAt',r.reviewed_at)
      ORDER BY r.requested_at DESC),'[]'::jsonb) INTO result
      FROM (SELECT * FROM app.organization_join_request WHERE requester_user_id=actor
        ORDER BY requested_at DESC LIMIT 100) r JOIN app.workspace w ON w.id=r.workspace_id;
    RETURN result;
  ELSIF p_action='join.cancel' THEN
    target:=(p_input->>'requestId')::uuid;
    UPDATE app.organization_join_request SET status='cancelled',reviewed_at=statement_timestamp()
      WHERE id=target AND requester_user_id=actor AND status='pending' RETURNING workspace_id INTO p_workspace;
    IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
    INSERT INTO app.audit_event(workspace_id,id,action,target_type,target_id,outcome,correlation_id)
      VALUES(p_workspace,gen_random_uuid(),'join_request.cancelled','join_request',target,'success',gen_random_uuid());
    RETURN jsonb_build_object('cancelled',true);
  ELSIF p_action='join.create' THEN
    PERFORM 1 FROM app.workspace w JOIN app.organization o ON o.workspace_id=w.id
      WHERE w.id=p_workspace AND w.kind='organization' AND w.status='active' AND o.join_policy='request' FOR UPDATE OF w;
    IF NOT FOUND OR EXISTS (SELECT FROM app.membership m WHERE m.workspace_id=p_workspace AND m.user_id=actor) THEN
      RAISE EXCEPTION 'not available' USING ERRCODE='42501';
    END IF;
    IF EXISTS (SELECT FROM app.organization_join_request r WHERE r.workspace_id=p_workspace
      AND r.requester_user_id=actor AND r.status='pending') THEN
      RAISE EXCEPTION 'not available' USING ERRCODE='42501';
    END IF;
    IF (SELECT count(*) FROM app.organization_join_request WHERE requester_user_id=actor AND status='pending')>=25 THEN
      RAISE EXCEPTION 'limit reached' USING ERRCODE='54000';
    END IF;
    target:=gen_random_uuid();
    INSERT INTO app.organization_join_request(workspace_id,id,requester_user_id)
      VALUES(p_workspace,target,actor);
    INSERT INTO app.audit_event(workspace_id,id,action,target_type,target_id,outcome,correlation_id)
      VALUES(p_workspace,gen_random_uuid(),'join_request.created','join_request',target,'success',gen_random_uuid());
    RETURN jsonb_build_object('id',target,'workspaceId',p_workspace,'status','pending','requestedRole','engineer');
  END IF;

  -- Remaining actions are company-administrator operations.
  PERFORM 1 FROM app.workspace w WHERE w.id=p_workspace AND w.kind='organization' AND w.status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
  SELECT m.role_key INTO actor_role FROM app.membership m JOIN app.app_user u ON u.id=m.user_id
    WHERE m.workspace_id=p_workspace AND m.user_id=actor AND m.status='active' AND u.status='active'
      AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp());
  IF actor_role IS NULL OR actor_role NOT IN ('owner','administrator') THEN
    RAISE EXCEPTION 'not available' USING ERRCODE='42501';
  END IF;
  mfa_required:=p_action IN ('company.settings.update','company.join.list','company.join.review');
  IF mfa_required AND NOT app.auth_session_has_recent_mfa(p_hash) THEN
    RAISE EXCEPTION 'fresh MFA required' USING ERRCODE='PM001';
  END IF;

  IF p_action='company.settings.get' THEN
    SELECT jsonb_build_object('id',w.id,'name',w.name,'joinPolicy',o.join_policy,
      'directorySummary',o.directory_summary) INTO result
      FROM app.organization o JOIN app.workspace w ON w.id=o.workspace_id WHERE w.id=p_workspace;
    RETURN result;
  ELSIF p_action='company.settings.update' THEN
    policy:=p_input->>'joinPolicy'; label:=btrim(coalesce(p_input->>'directorySummary',''));
    IF policy NOT IN ('invite_only','request') OR length(label)>500 OR label~'[[:cntrl:]]' THEN
      RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
    END IF;
    UPDATE app.organization SET join_policy=policy,directory_summary=label WHERE workspace_id=p_workspace;
    INSERT INTO app.audit_event(workspace_id,id,actor_user_id,action,target_type,target_id,outcome,correlation_id,
      details) VALUES(p_workspace,gen_random_uuid(),actor,'organization.directory_changed','organization',p_workspace,
      'success',gen_random_uuid(),jsonb_build_object('joinPolicy',policy));
    RETURN jsonb_build_object('updated',true,'joinPolicy',policy,'directorySummary',label);
  ELSIF p_action='company.join.list' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'displayName',u.display_name,'email',u.email,
      'status',r.status,'requestedRole',r.requested_role,'requestedAt',r.requested_at,'reviewedAt',r.reviewed_at)
      ORDER BY r.requested_at DESC),'[]'::jsonb) INTO result
      FROM (SELECT * FROM app.organization_join_request WHERE workspace_id=p_workspace
        ORDER BY requested_at DESC LIMIT 100) r JOIN app.app_user u ON u.id=r.requester_user_id;
    RETURN result;
  ELSE
    target:=(p_input->>'requestId')::uuid; decision:=p_input->>'decision';
    IF decision NOT IN ('approved','declined') THEN RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
    SELECT * INTO request_row FROM app.organization_join_request
      WHERE workspace_id=p_workspace AND id=target AND status='pending' FOR UPDATE;
    IF NOT FOUND OR EXISTS (SELECT FROM app.membership m
      WHERE m.workspace_id=p_workspace AND m.user_id=request_row.requester_user_id) THEN
      RAISE EXCEPTION 'not available' USING ERRCODE='42501';
    END IF;
    IF decision='approved' THEN
      INSERT INTO app.membership(workspace_id,user_id,role_key,invited_by,joined_at)
        VALUES(p_workspace,request_row.requester_user_id,'engineer',actor,statement_timestamp());
    END IF;
    UPDATE app.organization_join_request SET status=decision,reviewed_by=actor,reviewed_at=statement_timestamp()
      WHERE workspace_id=p_workspace AND id=target;
    INSERT INTO app.audit_event(workspace_id,id,actor_user_id,action,target_type,target_id,outcome,correlation_id,
      details) VALUES(p_workspace,gen_random_uuid(),actor,'join_request.reviewed','join_request',target,'success',
      gen_random_uuid(),jsonb_build_object('decision',decision,'grantedRole',
        CASE WHEN decision='approved' THEN 'engineer' ELSE NULL END));
    RETURN jsonb_build_object('reviewed',true,'decision',decision,
      'grantedRole',CASE WHEN decision='approved' THEN 'engineer' ELSE NULL END);
  END IF;
END
$function$;

CREATE FUNCTION app.platform_help_command(p_hash text,p_action text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE actor uuid; slug_value text; title_value text; summary_value text; section_value text;
  body_value text; revision_id uuid; revision_no integer; result jsonb;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('list','get','save','publish','unpublish')
    OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>131072 THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT u.id INTO actor FROM app.web_session s JOIN app.app_user u ON u.id=s.user_id
    JOIN app.platform_administrator a ON a.user_id=u.id AND a.status='active'
    WHERE s.token_hash=p_hash AND u.status='active' AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      AND s.verified_email=lower(u.email);
  IF actor IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
  IF p_action IN ('save','publish','unpublish') AND NOT app.auth_session_has_recent_mfa(p_hash) THEN
    RAISE EXCEPTION 'fresh MFA required' USING ERRCODE='PM001';
  END IF;
  IF p_action='list' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('slug',p.slug,'section',p.section_key,'sortOrder',p.sort_order,
      'hasDraft',p.draft_revision_id IS NOT NULL,'published',p.published_revision_id IS NOT NULL,
      'title',coalesce(d.title,r.title,p.slug),'updatedAt',p.updated_at)
      ORDER BY p.section_key,p.sort_order,p.slug),'[]'::jsonb) INTO result
      FROM app.help_page p LEFT JOIN app.help_revision d ON d.id=p.draft_revision_id AND d.page_slug=p.slug
      LEFT JOIN app.help_revision r ON r.id=p.published_revision_id AND r.page_slug=p.slug;
    RETURN result;
  END IF;
  slug_value:=btrim(p_input->>'slug');
  IF slug_value IS NULL OR length(slug_value)>80 OR slug_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  IF p_action='get' THEN
    SELECT jsonb_build_object('slug',p.slug,'section',p.section_key,'sortOrder',p.sort_order,
      'title',d.title,'summary',d.summary,'bodyMarkdown',d.body_markdown,
      'revision',d.revision_number,'published',p.published_revision_id IS NOT NULL)
      INTO result FROM app.help_page p LEFT JOIN app.help_revision d
        ON d.page_slug=p.slug AND d.id=p.draft_revision_id WHERE p.slug=slug_value;
    RETURN result;
  ELSIF p_action='save' THEN
    title_value:=btrim(p_input->>'title'); summary_value:=btrim(coalesce(p_input->>'summary',''));
    section_value:=btrim(p_input->>'section'); body_value:=p_input->>'bodyMarkdown';
    IF title_value IS NULL OR length(title_value) NOT BETWEEN 1 AND 160 OR title_value~'[[:cntrl:]]'
      OR length(summary_value)>500 OR summary_value~'[[:cntrl:]]'
      OR section_value IS NULL OR length(section_value)>80 OR section_value !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      OR body_value IS NULL OR length(body_value) NOT BETWEEN 1 AND 100000
      OR coalesce((p_input->>'sortOrder')::integer,-1) NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
    END IF;
    PERFORM pg_advisory_xact_lock(7007,hashtext(slug_value));
    INSERT INTO app.help_page(slug,section_key,sort_order) VALUES(slug_value,section_value,(p_input->>'sortOrder')::integer)
      ON CONFLICT(slug) DO UPDATE SET section_key=excluded.section_key,sort_order=excluded.sort_order,
        updated_at=statement_timestamp();
    SELECT coalesce(max(revision_number),0)+1 INTO revision_no FROM app.help_revision WHERE page_slug=slug_value;
    revision_id:=gen_random_uuid();
    INSERT INTO app.help_revision(page_slug,id,revision_number,title,summary,body_markdown,created_by)
      VALUES(slug_value,revision_id,revision_no,title_value,summary_value,body_value,actor);
    UPDATE app.help_page SET draft_revision_id=revision_id,updated_at=statement_timestamp() WHERE slug=slug_value;
    INSERT INTO app.platform_audit_event(id,actor_user_id,action,target_slug,details)
      VALUES(gen_random_uuid(),actor,'help.revision_saved',slug_value,jsonb_build_object('revision',revision_no));
    RETURN jsonb_build_object('saved',true,'slug',slug_value,'revision',revision_no);
  END IF;
  PERFORM 1 FROM app.help_page WHERE slug=slug_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
  IF p_action='publish' THEN
    UPDATE app.help_page SET published_revision_id=draft_revision_id,updated_at=statement_timestamp()
      WHERE slug=slug_value AND draft_revision_id IS NOT NULL RETURNING published_revision_id INTO revision_id;
    IF revision_id IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
  ELSE
    UPDATE app.help_page SET published_revision_id=NULL,updated_at=statement_timestamp() WHERE slug=slug_value;
  END IF;
  INSERT INTO app.platform_audit_event(id,actor_user_id,action,target_slug)
    VALUES(gen_random_uuid(),actor,CASE WHEN p_action='publish' THEN 'help.published' ELSE 'help.unpublished' END,slug_value);
  RETURN jsonb_build_object('updated',true,'slug',slug_value,'published',p_action='publish');
END
$function$;

REVOKE ALL ON FUNCTION app.help_catalog() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.help_read(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.portal_command(text,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_help_command(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.help_catalog() TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.help_read(text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.portal_command(text,text,uuid,jsonb) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.platform_help_command(text,text,jsonb) TO wellsim_runtime;

INSERT INTO app.schema_migration(version) VALUES('0007_portals_help_and_join_requests');
COMMIT;
