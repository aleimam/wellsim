\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_restore_security' THEN
    RAISE EXCEPTION 'security drill requires bldrz_restore_security';
  END IF;
END
$guard$;
-- Demote the session itself, not just a superuser's effective role.
SET SESSION AUTHORIZATION bldrz_app;
DO $login$
BEGIN
  BEGIN
    PERFORM count(*) FROM app.engineering_case;
    RAISE EXCEPTION 'login unexpectedly has direct table access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'SET ROLE bldrz_migration_owner';
    RAISE EXCEPTION 'login unexpectedly can become migration owner';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$login$;
BEGIN;
SET LOCAL ROLE bldrz_runtime;
DO $no_context$
BEGIN
  IF EXISTS (SELECT FROM app.engineering_case) THEN
    RAISE EXCEPTION 'data visible without tenant context';
  END IF;
END
$no_context$;
SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true),
       set_config('app.workspace_id', '10000000-0000-4000-8000-000000000010', true);
DO $company_a$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM app.engineering_case) <> 1 OR
    (SELECT title FROM app.engineering_case) <> 'A Confidential' OR
    (SELECT count(*) FROM app.export_item) <> 1 OR
    (SELECT name FROM app.well) <> 'A Well' THEN
    RAISE EXCEPTION 'company A read/export scope not preserved';
  END IF;
  UPDATE app.engineering_case SET title = 'ILLEGAL'
    WHERE id = '20000000-0000-4000-8000-000000000240';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'cross-company update succeeded'; END IF;
  BEGIN
    INSERT INTO app.project_well (workspace_id, project_id, well_id, linked_by)
    VALUES ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000120',
      '20000000-0000-4000-8000-000000000260', '10000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'cross-company well link succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO app.export_item (workspace_id, id, export_job_id, case_id)
    VALUES ('10000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000190',
      '10000000-0000-4000-8000-000000000170', '20000000-0000-4000-8000-000000000240');
    RAISE EXCEPTION 'cross-company export link succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO app.engineering_case (workspace_id, id, project_id, module_id, title, created_by)
    VALUES ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000290',
      '20000000-0000-4000-8000-000000000230', 'recovery', 'ILLEGAL', '20000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'cross-company insertion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE app.engineering_case SET title = 'A revised'
    WHERE id = '10000000-0000-4000-8000-000000000130';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'authorized write failed'; END IF;
END
$company_a$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE bldrz_runtime;
DO $reset$
BEGIN
  IF EXISTS (SELECT FROM app.engineering_case) THEN
    RAISE EXCEPTION 'tenant context survived rollback';
  END IF;
END
$reset$;
SELECT set_config('app.user_id', '20000000-0000-4000-8000-000000000002', true),
       set_config('app.workspace_id', '20000000-0000-4000-8000-000000000020', true);
DO $company_b$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM app.engineering_case) <> 1 OR
    (SELECT title FROM app.engineering_case) <> 'B Confidential' OR
    (SELECT count(*) FROM app.export_item) <> 1 THEN
    RAISE EXCEPTION 'company B read/export scope not preserved';
  END IF;
  UPDATE app.engineering_case SET title = 'ILLEGAL'
    WHERE id = '10000000-0000-4000-8000-000000000130';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'reverse cross-company update succeeded'; END IF;
  BEGIN
    INSERT INTO app.project_well (workspace_id, project_id, well_id, linked_by)
    VALUES ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000230',
      '10000000-0000-4000-8000-000000000160', '20000000-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'reverse cross-company well link succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO app.export_item (workspace_id, id, export_job_id, case_id)
    VALUES ('20000000-0000-4000-8000-000000000020', '20000000-0000-4000-8000-000000000290',
      '20000000-0000-4000-8000-000000000270', '10000000-0000-4000-8000-000000000130');
    RAISE EXCEPTION 'reverse cross-company export link succeeded';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$company_b$;
SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
DO $mismatched_identity$
BEGIN
  IF EXISTS (SELECT FROM app.engineering_case) OR EXISTS (SELECT FROM app.export_item) THEN
    RAISE EXCEPTION 'user A can use workspace B context';
  END IF;
END
$mismatched_identity$;
ROLLBACK;
\echo RECOVERY_TWO_COMPANY_ISOLATION_OK
