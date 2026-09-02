BEGIN;

-- Assurance comes only from trusted server verification of the signed Auth0
-- ID token. Neither browser fields nor company membership imply MFA.
ALTER TABLE app.web_session ADD COLUMN mfa_authenticated_at timestamptz;
ALTER TABLE app.login_transaction ADD COLUMN require_mfa boolean NOT NULL DEFAULT false;
ALTER TABLE app.login_transaction ADD COLUMN expected_user_id uuid REFERENCES app.app_user(id);
ALTER TABLE app.login_transaction ADD CONSTRAINT login_mfa_binding CHECK
  ((require_mfa AND expected_user_id IS NOT NULL) OR (NOT require_mfa AND expected_user_id IS NULL));

CREATE FUNCTION app.auth_create_flow(p_hash text,p_state text,p_nonce text,p_verifier text,
  p_require_mfa boolean,p_expected_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  IF p_require_mfa IS NULL OR p_require_mfa <> (p_expected_user IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid flow' USING ERRCODE='22023';
  END IF;
  IF NOT app.auth_create_flow(p_hash,p_state,p_nonce,p_verifier) THEN RETURN false; END IF;
  UPDATE app.login_transaction SET require_mfa=p_require_mfa,expected_user_id=p_expected_user WHERE token_hash=p_hash;
  RETURN true;
END
$function$;

DROP FUNCTION app.auth_consume_flow(text);
CREATE FUNCTION app.auth_consume_flow(p_hash text)
RETURNS TABLE(state text,nonce text,code_verifier text,require_mfa boolean,expected_user_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
  WITH consumed AS (DELETE FROM app.login_transaction WHERE token_hash=p_hash RETURNING *)
  SELECT c.state,c.nonce,c.code_verifier,c.require_mfa,c.expected_user_id FROM consumed c
    WHERE c.expires_at>statement_timestamp();
$function$;

CREATE FUNCTION app.auth_complete_login(p_issuer text,p_subject text,p_email text,p_email_verified boolean,
  p_hash text,p_csrf text,p_previous_hash text,p_mfa_time bigint,p_expected_user uuid,p_signup boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE actor uuid; checked_time timestamptz;
BEGIN
  IF p_signup IS NULL THEN RAISE EXCEPTION 'invalid login' USING ERRCODE='22023'; END IF;
  IF p_expected_user IS NOT NULL THEN
    -- A step-up must complete for the SAME account. No silent switching or
    -- bootstrap of a different identity from an existing browser session.
    IF p_mfa_time IS NULL OR NOT EXISTS (SELECT FROM app.auth_identity i
        WHERE i.provider=p_issuer AND i.provider_subject=p_subject AND i.user_id=p_expected_user) THEN
      RETURN NULL;
    END IF;
    -- Match bootstrap's lock order, then serialize with logout/rotation. A
    -- session revoked while this callback waits cannot be resurrected by MFA.
    IF p_signup THEN PERFORM pg_advisory_xact_lock(5005,1); END IF;
    PERFORM 1 FROM app.app_user WHERE id=p_expected_user AND status='active' FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM 1 FROM app.web_session s WHERE s.token_hash=p_previous_hash AND s.user_id=p_expected_user
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;
  IF p_mfa_time IS NOT NULL THEN
    IF p_mfa_time<extract(epoch FROM clock_timestamp())-900 OR
      p_mfa_time>extract(epoch FROM clock_timestamp())+60 THEN
      RAISE EXCEPTION 'fresh MFA required' USING ERRCODE='PM001';
    END IF;
    checked_time:=least(to_timestamp(p_mfa_time),clock_timestamp());
  END IF;
  IF p_signup THEN
    actor:=app.onboarding_sign_in(p_issuer,p_subject,p_email,p_email_verified,p_hash,p_csrf,p_previous_hash);
  ELSE
    SELECT user_id INTO actor FROM app.auth_create_session(p_issuer,p_subject,p_hash,p_csrf,p_previous_hash);
  END IF;
  IF actor IS NULL THEN RETURN NULL; END IF;
  IF p_expected_user IS NOT NULL AND actor<>p_expected_user THEN
    RAISE EXCEPTION 'identity changed' USING ERRCODE='42501';
  END IF;
  UPDATE app.web_session SET mfa_authenticated_at=checked_time WHERE token_hash=p_hash AND user_id=actor;
  RETURN actor;
END
$function$;

CREATE FUNCTION app.auth_session_has_recent_mfa(p_hash text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
  SELECT EXISTS (SELECT FROM app.web_session s JOIN app.app_user u ON u.id=s.user_id
    WHERE s.token_hash=p_hash AND u.status='active' AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      AND s.mfa_authenticated_at<=clock_timestamp()
      AND s.mfa_authenticated_at>clock_timestamp()-interval '15 minutes');
$function$;

DROP FUNCTION app.auth_read_session(text);
CREATE FUNCTION app.auth_read_session(p_hash text)
RETURNS TABLE(user_id uuid,display_name text,csrf_token text,mfa_expires_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
  UPDATE app.web_session s SET idle_expires_at=least(s.expires_at,statement_timestamp()+interval '30 minutes')
    FROM app.app_user u WHERE s.token_hash=p_hash AND s.user_id=u.id AND u.status='active'
      AND s.revoked_at IS NULL AND s.expires_at>statement_timestamp() AND s.idle_expires_at>statement_timestamp()
    RETURNING u.id,u.display_name,s.csrf_token,s.mfa_authenticated_at+interval '15 minutes';
$function$;

-- Retain the already-qualified transactional membership implementation behind
-- an inaccessible helper. The public wrapper adds fresh assurance AFTER the
-- same company/user locks; waiting cannot extend an expired MFA window.
ALTER FUNCTION app.onboarding_command(text,text,uuid,jsonb) RENAME TO onboarding_command_v5;
REVOKE ALL ON FUNCTION app.onboarding_command_v5(text,text,uuid,jsonb) FROM PUBLIC,wellsim_runtime;
CREATE FUNCTION app.onboarding_command(p_hash text,p_action text,p_workspace uuid,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE actor uuid; actor_email text; actor_role text; invited_role text; required boolean:=false;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('profile','company.create','members.list','invitations.list',
      'invitation.create','invitation.revoke','invitation.accept','member.change','member.leave') OR
    p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR octet_length(p_input::text)>8192 THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT u.id,lower(u.email) INTO actor,actor_email FROM app.web_session s JOIN app.app_user u ON u.id=s.user_id
    WHERE s.token_hash=p_hash AND u.status='active' AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
      AND s.verified_email=lower(u.email);
  IF actor IS NULL THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
  IF p_action='company.create' THEN
    PERFORM 1 FROM app.app_user WHERE id=actor FOR UPDATE;
    required:=true;
  ELSIF p_action<>'profile' THEN
    IF p_action='invitation.accept' THEN
      SELECT i.workspace_id,i.role_key INTO p_workspace,invited_role FROM app.workspace_invitation i
        WHERE i.token_hash=p_input->>'tokenHash' AND lower(i.email)=actor_email AND i.status='pending'
          AND i.expires_at>clock_timestamp();
    END IF;
    PERFORM 1 FROM app.workspace WHERE id=p_workspace AND kind='organization' AND status='active' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
    SELECT m.role_key INTO actor_role FROM app.membership m WHERE m.workspace_id=p_workspace AND m.user_id=actor
      AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp());
    required:=coalesce(actor_role IN ('owner','administrator'),false) OR
      (p_action='invitation.accept' AND coalesce(invited_role='administrator',false));
  END IF;
  IF required AND NOT app.auth_session_has_recent_mfa(p_hash) THEN
    -- Expired/revoked sessions are rejected before distinguishing assurance.
    IF NOT EXISTS (SELECT FROM app.web_session s JOIN app.app_user u ON u.id=s.user_id
      WHERE s.token_hash=p_hash AND s.user_id=actor AND u.status='active' AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp() AND s.idle_expires_at>clock_timestamp()
        AND s.verified_email=lower(u.email)) THEN
      RAISE EXCEPTION 'not available' USING ERRCODE='42501';
    END IF;
    RAISE EXCEPTION 'fresh MFA required' USING ERRCODE='PM001';
  END IF;
  RETURN app.onboarding_command_v5(p_hash,p_action,p_workspace,p_input);
END
$function$;

REVOKE ALL ON FUNCTION app.auth_create_flow(text,text,text,text,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_consume_flow(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_read_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_complete_login(text,text,text,boolean,text,text,text,bigint,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_session_has_recent_mfa(text) FROM PUBLIC,wellsim_runtime;
REVOKE ALL ON FUNCTION app.onboarding_command(text,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_create_flow(text,text,text,text,boolean,uuid) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_consume_flow(text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_read_session(text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_complete_login(text,text,text,boolean,text,text,text,bigint,uuid,boolean) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.onboarding_command(text,text,uuid,jsonb) TO wellsim_runtime;
INSERT INTO app.schema_migration(version) VALUES('0006_administrator_mfa');
COMMIT;
