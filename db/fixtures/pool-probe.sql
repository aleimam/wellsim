-- Apply only to a disposable clone, never the persistent bldrz database.
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_pool_probe' THEN
    RAISE EXCEPTION 'pool probe fixture requires bldrz_pool_probe';
  END IF;
END
$guard$;
SET ROLE bldrz_migration_owner;
BEGIN;
INSERT INTO app.app_user (id, email, display_name) VALUES
 ('10000000-0000-4000-8000-000000000001', 'pool-a@example.test', 'Pool A'),
 ('20000000-0000-4000-8000-000000000002', 'pool-b@example.test', 'Pool B');
INSERT INTO app.workspace (id, kind, name, slug) VALUES
 ('10000000-0000-4000-8000-000000000010', 'organization', 'Pool A', 'pool-a'),
 ('20000000-0000-4000-8000-000000000020', 'organization', 'Pool B', 'pool-b');
INSERT INTO app.membership (workspace_id, user_id, role_key) VALUES
 ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000001', 'owner'),
 ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000002', 'owner');
INSERT INTO app.project (workspace_id, id, name, created_by) VALUES
 ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000120', 'A project', '10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000230', 'B project', '20000000-0000-4000-8000-000000000002');
INSERT INTO app.engineering_case (workspace_id, id, project_id, module_id, title, created_by) VALUES
 ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000130', '10000000-0000-4000-8000-000000000120', 'pool.probe', 'A Confidential', '10000000-0000-4000-8000-000000000001'),
 ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000240', '20000000-0000-4000-8000-000000000230', 'pool.probe', 'B Confidential', '20000000-0000-4000-8000-000000000002');
COMMIT;
