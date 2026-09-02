-- Extend the two-company pool fixture only in the named auth probe.
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_auth_probe' THEN
    RAISE EXCEPTION 'auth fixture requires bldrz_auth_probe';
  END IF;
END
$guard$;
SET ROLE bldrz_migration_owner;
BEGIN;
INSERT INTO app.auth_identity(id, user_id, provider, provider_subject) VALUES
 ('10000000-0000-4000-8000-000000000101', '10000000-0000-4000-8000-000000000001', 'https://issuer.example.test', 'subject-A'),
 ('20000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000002', 'https://issuer.example.test', 'subject-B');
INSERT INTO app.app_user(id, email, display_name) VALUES
 ('30000000-0000-4000-8000-000000000003', 'personal@example.test', 'Personal');
INSERT INTO app.auth_identity(id, user_id, provider, provider_subject) VALUES
 ('30000000-0000-4000-8000-000000000303', '30000000-0000-4000-8000-000000000003', 'https://issuer.example.test', 'subject-P');
INSERT INTO app.workspace(id, kind, name, slug, owner_user_id) VALUES
 ('30000000-0000-4000-8000-000000000030', 'personal', 'Private', 'auth-private', '30000000-0000-4000-8000-000000000003');
INSERT INTO app.membership(workspace_id, user_id, role_key) VALUES
 ('30000000-0000-4000-8000-000000000030', '30000000-0000-4000-8000-000000000003', 'owner');
COMMIT;
