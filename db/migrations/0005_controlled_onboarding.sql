BEGIN;

-- Only a trusted, signature-verified OIDC callback may supply this claim.
-- Existing sessions have no verified email and cannot perform onboarding.
ALTER TABLE app.web_session ADD COLUMN verified_email text;

-- Membership writes must pass the serialized management boundary below.
-- Column grants must be revoked separately from table-level privileges.
REVOKE INSERT ON app.membership, app.workspace_invitation FROM wellsim_runtime;
REVOKE UPDATE (role_key, status, joined_at, expires_at, updated_at)
  ON app.membership FROM wellsim_runtime;
REVOKE UPDATE (status, accepted_by) ON app.workspace_invitation FROM wellsim_runtime;

CREATE FUNCTION app.onboarding_sign_in(
  p_issuer text, p_subject text, p_email text, p_verified boolean,
  p_hash text, p_csrf text, p_previous_hash text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  actor uuid;
  personal uuid;
  normalized text := lower(btrim(p_email));
BEGIN
  IF p_verified IS DISTINCT FROM true OR normalized IS NULL
    OR length(normalized) > 254 OR normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR p_issuer IS NULL OR length(p_issuer) > 2048 OR p_issuer !~ '^https://'
    OR p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 255 THEN
    RETURN NULL;
  END IF;
  -- Serialize account bootstrap only. Existing sessions/engineering work do
  -- not acquire this lock. Concurrent first callbacks cannot create duplicates.
  PERFORM pg_advisory_xact_lock(5005, 1);
  SELECT i.user_id INTO actor FROM app.auth_identity i
    WHERE i.provider=p_issuer AND i.provider_subject=p_subject;
  IF actor IS NULL THEN
    -- A matching email never links a second identity to an existing account.
    IF EXISTS (SELECT FROM app.app_user u WHERE lower(u.email)=normalized) THEN RETURN NULL; END IF;
    actor := gen_random_uuid();
    INSERT INTO app.app_user(id,email,display_name) VALUES(actor,normalized,'New user');
    INSERT INTO app.auth_identity(id,user_id,provider,provider_subject)
      VALUES(gen_random_uuid(),actor,p_issuer,p_subject);
  END IF;
  PERFORM 1 FROM app.app_user u WHERE u.id=actor AND u.status='active'
    AND lower(u.email)=normalized FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT w.id INTO personal FROM app.workspace w WHERE w.kind='personal' AND w.owner_user_id=actor;
  IF personal IS NULL THEN
    personal := gen_random_uuid();
    INSERT INTO app.workspace(id,kind,name,slug,owner_user_id)
      VALUES(personal,'personal','My private workspace',personal::text,actor);
    INSERT INTO app.membership(workspace_id,user_id,role_key,joined_at)
      VALUES(personal,actor,'owner',statement_timestamp());
    INSERT INTO app.audit_event(workspace_id,id,actor_user_id,action,target_type,target_id,outcome,correlation_id)
      VALUES(personal,gen_random_uuid(),actor,'workspace.created','workspace',personal,'success',gen_random_uuid());
  END IF;
  PERFORM app.auth_create_session(p_issuer,p_subject,p_hash,p_csrf,p_previous_hash);
  UPDATE app.web_session SET verified_email=normalized WHERE token_hash=p_hash AND user_id=actor;
  RETURN actor;
END
$function$;

-- Fixed operations, never dynamic SQL. This is a session-authenticated
-- boundary, not a generic table gateway. Workspace IDs are selections only.
CREATE FUNCTION app.onboarding_command(p_hash text, p_action text, p_workspace uuid, p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  actor uuid;
  actor_email text;
  actor_role text;
  target_role text;
  desired_role text;
  desired_status text;
  target uuid;
  invitation app.workspace_invitation%ROWTYPE;
  company uuid;
  label text;
  result jsonb;
  audit_action text;
  audit_details jsonb := '{}'::jsonb;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('profile','company.create','members.list','invitations.list',
    'invitation.create','invitation.revoke','invitation.accept','member.change','member.leave')
    OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>8192 THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT u.id, lower(u.email) INTO actor, actor_email
    FROM app.web_session s JOIN app.app_user u ON u.id=s.user_id
    WHERE s.token_hash=p_hash AND s.revoked_at IS NULL AND u.status='active'
      AND s.expires_at>statement_timestamp() AND s.idle_expires_at>statement_timestamp()
      AND s.verified_email=lower(u.email);
  IF actor IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;

  IF p_action='profile' THEN
    label := btrim(p_input->>'displayName');
    IF label IS NULL OR length(label) NOT BETWEEN 1 AND 100 OR label ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
    END IF;
    UPDATE app.app_user SET display_name=label, updated_at=statement_timestamp() WHERE id=actor;
    RETURN jsonb_build_object('displayName',label);
  END IF;

  IF p_action='company.create' THEN
    label := btrim(p_input->>'name');
    IF label IS NULL OR length(label) NOT BETWEEN 1 AND 160 OR label ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
    END IF;
    -- Bound self-service company creation; this is not a billing entitlement.
    PERFORM 1 FROM app.app_user WHERE id=actor FOR UPDATE;
    IF (SELECT count(*) FROM app.membership m JOIN app.workspace w ON w.id=m.workspace_id
      WHERE m.user_id=actor AND m.role_key='owner' AND w.kind='organization')>=10 THEN
      RAISE EXCEPTION 'limit reached' USING ERRCODE='54000';
    END IF;
    company := gen_random_uuid();
    INSERT INTO app.workspace(id,kind,name,slug) VALUES(company,'organization',label,company::text);
    INSERT INTO app.organization(workspace_id,legal_name) VALUES(company,label);
    INSERT INTO app.membership(workspace_id,user_id,role_key,joined_at)
      VALUES(company,actor,'owner',statement_timestamp());
    INSERT INTO app.audit_event(workspace_id,id,actor_user_id,action,target_type,target_id,outcome,correlation_id)
      VALUES(company,gen_random_uuid(),actor,'workspace.created','workspace',company,'success',gen_random_uuid());
    RETURN jsonb_build_object('id',company,'name',label,'kind','organization','role_key','owner');
  END IF;

  IF p_action='invitation.accept' THEN
    -- No GET preview leaks a company or recipient. Possession alone is not
    -- sufficient: the signed-in verified email must match the invitation.
    SELECT i.workspace_id INTO p_workspace FROM app.workspace_invitation i
      WHERE i.token_hash=p_input->>'tokenHash';
  END IF;
  -- Serialize all management/acceptance in one company. Re-read authority
  -- AFTER this lock: revocation and simultaneous last-owner changes are safe.
  PERFORM 1 FROM app.workspace w WHERE w.id=p_workspace AND w.kind='organization'
    AND w.status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT FROM app.web_session s JOIN app.app_user u ON u.id=s.user_id
    WHERE s.token_hash=p_hash AND s.user_id=actor AND u.status='active' AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      AND s.verified_email=lower(u.email)) THEN
    RAISE EXCEPTION 'not available' USING ERRCODE='42501';
  END IF;

  IF p_action='invitation.accept' THEN
    SELECT i.* INTO invitation FROM app.workspace_invitation i
      WHERE i.workspace_id=p_workspace AND i.token_hash=p_input->>'tokenHash'
        AND i.status='pending' AND i.expires_at>clock_timestamp() AND lower(i.email)=actor_email;
    IF NOT FOUND OR EXISTS (SELECT FROM app.membership m WHERE m.workspace_id=p_workspace AND m.user_id=actor) THEN
      RAISE EXCEPTION 'not available' USING ERRCODE='42501';
    END IF;
    SELECT m.role_key INTO actor_role FROM app.membership m JOIN app.app_user u ON u.id=m.user_id
      WHERE m.workspace_id=p_workspace AND m.user_id=invitation.invited_by
        AND m.status='active' AND u.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp());
    IF actor_role IS NULL OR actor_role NOT IN ('owner','administrator')
      OR invitation.role_key NOT IN ('administrator','engineering_manager','engineer','reviewer','viewer')
      OR (invitation.role_key='administrator' AND actor_role<>'owner') THEN
      RAISE EXCEPTION 'not available' USING ERRCODE='42501';
    END IF;
    INSERT INTO app.membership(workspace_id,user_id,role_key,invited_by,joined_at)
      VALUES(p_workspace,actor,invitation.role_key,invitation.invited_by,statement_timestamp());
    UPDATE app.workspace_invitation SET status='accepted',accepted_by=actor
      WHERE workspace_id=p_workspace AND id=invitation.id;
    target := invitation.id;
    audit_action := 'invitation.accepted';
    result := jsonb_build_object('workspaceId',p_workspace);
  ELSE
    SELECT m.role_key INTO actor_role FROM app.membership m
      WHERE m.workspace_id=p_workspace AND m.user_id=actor AND m.status='active'
        AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp());
    IF actor_role IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
    IF p_action<>'member.leave' AND actor_role NOT IN ('owner','administrator') THEN
      RAISE EXCEPTION 'not available' USING ERRCODE='42501';
    END IF;

    IF p_action='members.list' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('userId',u.id,'displayName',u.display_name,
        'role',m.role_key,'status',m.status) ORDER BY u.display_name,u.id),'[]'::jsonb) INTO result
        FROM app.membership m JOIN app.app_user u ON u.id=m.user_id WHERE m.workspace_id=p_workspace;
      RETURN result;
    ELSIF p_action='invitations.list' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'role',i.role_key,
        'status',CASE WHEN i.status='pending' AND i.expires_at<=statement_timestamp() THEN 'expired' ELSE i.status END,
        'expiresAt',i.expires_at) ORDER BY i.created_at DESC),'[]'::jsonb) INTO result
        FROM (SELECT * FROM app.workspace_invitation WHERE workspace_id=p_workspace
          ORDER BY created_at DESC LIMIT 100) i;
      RETURN result;
    ELSIF p_action='invitation.create' THEN
      desired_role := p_input->>'role';
      label := lower(btrim(p_input->>'email'));
      IF desired_role IS NULL OR desired_role NOT IN ('administrator','engineering_manager','engineer','reviewer','viewer')
        OR label IS NULL OR length(label)>254 OR label !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR coalesce(p_input->>'tokenHash','') !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
      END IF;
      IF desired_role='administrator' AND actor_role<>'owner' THEN
        RAISE EXCEPTION 'not available' USING ERRCODE='42501';
      END IF;
      -- Do not look up recipient accounts or disclose whether they exist.
      UPDATE app.workspace_invitation SET status='revoked'
        WHERE workspace_id=p_workspace AND lower(email)=label AND status='pending';
      IF (SELECT count(*) FROM app.workspace_invitation WHERE workspace_id=p_workspace
        AND status='pending' AND expires_at>statement_timestamp())>=100 THEN
        RAISE EXCEPTION 'limit reached' USING ERRCODE='54000';
      END IF;
      target := gen_random_uuid();
      INSERT INTO app.workspace_invitation(workspace_id,id,email,role_key,token_hash,invited_by,expires_at)
        VALUES(p_workspace,target,label,desired_role,p_input->>'tokenHash',actor,statement_timestamp()+interval '48 hours');
      audit_action := 'invitation.created';
      audit_details := jsonb_build_object('role',desired_role);
      result := jsonb_build_object('id',target,'expiresInSeconds',172800);
    ELSIF p_action='invitation.revoke' THEN
      target := (p_input->>'invitationId')::uuid;
      UPDATE app.workspace_invitation SET status='revoked' WHERE workspace_id=p_workspace
        AND id=target AND status='pending' AND (actor_role='owner' OR role_key<>'administrator');
      IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
      audit_action := 'invitation.revoked'; result := jsonb_build_object('revoked',true);
    ELSE
      target := CASE WHEN p_action='member.leave' THEN actor ELSE (p_input->>'userId')::uuid END;
      SELECT m.role_key INTO target_role FROM app.membership m WHERE m.workspace_id=p_workspace AND m.user_id=target;
      IF target_role IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
      desired_role := CASE WHEN p_action='member.leave' THEN target_role ELSE p_input->>'role' END;
      desired_status := CASE WHEN p_action='member.leave' THEN 'removed' ELSE p_input->>'status' END;
      IF desired_role IS NULL OR desired_role NOT IN ('owner','administrator','engineering_manager','engineer','reviewer','viewer')
        OR desired_status IS NULL OR desired_status NOT IN ('active','suspended','removed') THEN
        RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
      END IF;
      IF p_action<>'member.leave' AND actor_role<>'owner'
        AND (target_role IN ('owner','administrator') OR desired_role IN ('owner','administrator')) THEN
        RAISE EXCEPTION 'not available' USING ERRCODE='42501';
      END IF;
      IF target_role='owner' AND (desired_role<>'owner' OR desired_status<>'active')
        AND NOT EXISTS (SELECT FROM app.membership m JOIN app.app_user u ON u.id=m.user_id
          WHERE m.workspace_id=p_workspace AND m.user_id<>target AND m.role_key='owner' AND m.status='active'
            AND u.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())) THEN
        RAISE EXCEPTION 'last owner required' USING ERRCODE='23514';
      END IF;
      UPDATE app.membership SET role_key=desired_role,status=desired_status,updated_at=statement_timestamp()
        WHERE workspace_id=p_workspace AND user_id=target;
      -- Issued invitations never survive a member's change of authority.
      UPDATE app.workspace_invitation SET status='revoked'
        WHERE workspace_id=p_workspace AND invited_by=target AND status='pending';
      audit_action := 'membership.changed';
      audit_details := jsonb_build_object('role',desired_role,'status',desired_status);
      result := jsonb_build_object('updated',true);
    END IF;
  END IF;
  INSERT INTO app.audit_event(workspace_id,id,actor_user_id,action,target_type,target_id,outcome,correlation_id,details)
    VALUES(p_workspace,gen_random_uuid(),actor,audit_action,
      CASE WHEN audit_action='membership.changed' THEN 'membership' ELSE 'invitation' END,
      target,'success',gen_random_uuid(),audit_details);
  RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION app.onboarding_sign_in(text,text,text,boolean,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.onboarding_command(text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.onboarding_sign_in(text,text,text,boolean,text,text,text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.onboarding_command(text,text,uuid,jsonb) TO wellsim_runtime;
INSERT INTO app.schema_migration(version) VALUES('0005_controlled_onboarding');
COMMIT;
