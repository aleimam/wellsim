BEGIN;

-- Global identity-plane records. The runtime has NO direct table access or
-- RLS policy on these tables; only the narrow functions below are callable.
CREATE TABLE app.login_transaction (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state ~ '^[A-Za-z0-9_-]{43,128}$'),
  nonce text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43,128}$'),
  code_verifier text NOT NULL CHECK (code_verifier ~ '^[A-Za-z0-9_-]{43,128}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT statement_timestamp() + interval '10 minutes'
);
CREATE INDEX login_transaction_expiry_idx ON app.login_transaction(expires_at);

CREATE TABLE app.web_session (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES app.app_user(id),
  csrf_token text NOT NULL CHECK (csrf_token ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT statement_timestamp() + interval '8 hours',
  idle_expires_at timestamptz NOT NULL DEFAULT statement_timestamp() + interval '30 minutes',
  revoked_at timestamptz
);
CREATE INDEX web_session_user_idx ON app.web_session(user_id, issued_at DESC);
CREATE INDEX web_session_expiry_idx ON app.web_session(expires_at);

CREATE TABLE app.authentication_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.app_user(id),
  action text NOT NULL CHECK (action IN ('session.created', 'session.revoked')),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE app.login_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.web_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.authentication_event ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app.login_transaction, app.web_session, app.authentication_event
  FROM PUBLIC, wellsim_runtime;
CREATE TRIGGER authentication_event_immutable BEFORE UPDATE OR DELETE
  ON app.authentication_event FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_mutation();

CREATE FUNCTION app.auth_create_flow(p_hash text, p_state text, p_nonce text, p_verifier text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
BEGIN
  -- Bound both storage and concurrent admission. The short lock serializes
  -- only login starts, never engineering calculations or tenant tables.
  LOCK TABLE app.login_transaction IN SHARE ROW EXCLUSIVE MODE;
  DELETE FROM app.login_transaction WHERE expires_at <= statement_timestamp();
  IF (SELECT count(*) FROM app.login_transaction) >= 1000 THEN RETURN false; END IF;
  INSERT INTO app.login_transaction(token_hash, state, nonce, code_verifier)
    VALUES (p_hash, p_state, p_nonce, p_verifier);
  RETURN true;
END
$function$;

CREATE FUNCTION app.auth_consume_flow(p_hash text)
RETURNS TABLE(state text, nonce text, code_verifier text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  WITH consumed AS (
    DELETE FROM app.login_transaction WHERE token_hash = p_hash RETURNING *
  )
  SELECT c.state, c.nonce, c.code_verifier FROM consumed c
    WHERE c.expires_at > statement_timestamp();
$function$;

CREATE FUNCTION app.auth_revoke_session(p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE revoked_user uuid;
BEGIN
  UPDATE app.web_session SET revoked_at = statement_timestamp()
    WHERE token_hash = p_hash AND revoked_at IS NULL RETURNING user_id INTO revoked_user;
  IF FOUND THEN
    INSERT INTO app.authentication_event(user_id, action) VALUES (revoked_user, 'session.revoked');
  END IF;
END
$function$;

-- issuer+subject MUST be obtained from a verified OIDC response in trusted
-- server code. This is not a public registration/account-linking endpoint.
CREATE FUNCTION app.auth_create_session(
  p_issuer text, p_subject text, p_hash text, p_csrf text, p_previous_hash text
)
RETURNS TABLE(user_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE mapped_user uuid;
BEGIN
  SELECT u.id INTO mapped_user FROM app.auth_identity i
    JOIN app.app_user u ON u.id = i.user_id
    WHERE i.provider = p_issuer AND i.provider_subject = p_subject AND u.status = 'active'
    FOR UPDATE OF u;
  IF NOT FOUND THEN RETURN; END IF;
  -- No mapping by email, no domain-based admission and no automatic accounts.
  PERFORM app.auth_revoke_session(p_previous_hash);
  DELETE FROM app.web_session WHERE expires_at <= statement_timestamp()
    OR idle_expires_at <= statement_timestamp() OR revoked_at IS NOT NULL;
  -- Retain at most ten live sessions for this user. Serialized by the user
  -- lock above, so simultaneous callbacks cannot evade the bound.
  PERFORM app.auth_revoke_session(s.token_hash) FROM (
    SELECT w.token_hash FROM app.web_session w WHERE w.user_id = mapped_user
      AND w.revoked_at IS NULL ORDER BY w.issued_at DESC, w.token_hash OFFSET 9
  ) s;
  INSERT INTO app.web_session(token_hash, user_id, csrf_token)
    VALUES (p_hash, mapped_user, p_csrf);
  INSERT INTO app.authentication_event(user_id, action) VALUES (mapped_user, 'session.created');
  RETURN QUERY SELECT mapped_user;
END
$function$;

CREATE FUNCTION app.auth_read_session(p_hash text)
RETURNS TABLE(user_id uuid, display_name text, csrf_token text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  UPDATE app.web_session s
    SET idle_expires_at = LEAST(s.expires_at, statement_timestamp() + interval '30 minutes')
    FROM app.app_user u WHERE s.token_hash = p_hash AND s.user_id = u.id
      AND u.status = 'active' AND s.revoked_at IS NULL
      AND s.expires_at > statement_timestamp() AND s.idle_expires_at > statement_timestamp()
    RETURNING u.id, u.display_name, s.csrf_token;
$function$;

CREATE FUNCTION app.auth_list_workspaces(p_hash text)
RETURNS TABLE(id uuid, kind text, name text, role_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $function$
  SELECT w.id, w.kind, w.name, m.role_key
    FROM app.web_session s JOIN app.app_user u ON u.id = s.user_id
    JOIN app.membership m ON m.user_id = u.id
    JOIN app.workspace w ON w.id = m.workspace_id
    WHERE s.token_hash = p_hash AND s.revoked_at IS NULL
      AND s.expires_at > statement_timestamp() AND s.idle_expires_at > statement_timestamp()
      AND u.status = 'active' AND w.status = 'active' AND m.status = 'active'
      AND (m.expires_at IS NULL OR m.expires_at > statement_timestamp())
      AND EXISTS (SELECT FROM app.role_permission r
        WHERE r.role_key = m.role_key AND r.permission_key = 'workspace.read')
    ORDER BY w.name, w.id;
$function$;

REVOKE ALL ON FUNCTION app.auth_create_flow(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_consume_flow(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_revoke_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_create_session(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_read_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.auth_list_workspaces(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.auth_create_flow(text, text, text, text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_consume_flow(text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_revoke_session(text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_create_session(text, text, text, text, text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_read_session(text) TO wellsim_runtime;
GRANT EXECUTE ON FUNCTION app.auth_list_workspaces(text) TO wellsim_runtime;

INSERT INTO app.schema_migration(version) VALUES ('0004_verified_sessions');
COMMIT;
