\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_restore_security' THEN
    RAISE EXCEPTION 'portal recovery assertions require bldrz_restore_security';
  END IF;
  IF (SELECT count(*) FROM app.organization_join_request) <> 1 OR
    (SELECT count(*) FROM app.platform_administrator) <> 1 OR
    (SELECT count(*) FROM app.help_revision) <> 2 OR
    (SELECT count(*) FROM app.platform_audit_event) <> 3 THEN
    RAISE EXCEPTION 'nonempty portal records were not restored';
  END IF;
END
$guard$;
SET SESSION AUTHORIZATION bldrz_app;
BEGIN;
SET LOCAL ROLE bldrz_runtime;
DO $verify$
DECLARE request_id uuid; result jsonb;
BEGIN
  BEGIN
    PERFORM count(*) FROM app.platform_administrator;
    RAISE EXCEPTION 'restored platform table directly readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (app.help_read('recovery-guide')->>'revision')::integer <> 1 OR
    app.help_read('recovery-guide')->>'bodyMarkdown' IS DISTINCT FROM 'Published recovery instructions' OR
    jsonb_array_length(app.help_catalog()) <> 1 OR
    (app.platform_help_command(repeat('a',64),'get','{"slug":"recovery-guide"}')->>'revision')::integer <> 2 THEN
    RAISE EXCEPTION 'restored draft/public revision boundary failed';
  END IF;
  BEGIN
    PERFORM app.platform_help_command(repeat('b',64),'list','{}');
    RAISE EXCEPTION 'company owner became a platform administrator';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  result:=app.portal_command(repeat('b',64),'join.mine',NULL,'{}');
  IF jsonb_array_length(result)<>1 OR result->0->>'status' IS DISTINCT FROM 'pending' OR
    EXISTS (SELECT FROM app.auth_list_workspaces(repeat('b',64))
      WHERE id='10000000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'restored pending request changed authority';
  END IF;
  request_id:=(result->0->>'id')::uuid;
  BEGIN
    PERFORM app.portal_command(repeat('b',64),'company.join.review','20000000-0000-4000-8000-000000000020',
      jsonb_build_object('requestId',request_id,'decision','approved'));
    RAISE EXCEPTION 'restored cross-company review succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  result:=app.portal_command(repeat('a',64),'company.join.review','10000000-0000-4000-8000-000000000010',
    jsonb_build_object('requestId',request_id,'decision','approved'));
  IF result->>'grantedRole' IS DISTINCT FROM 'engineer' OR NOT EXISTS
    (SELECT FROM app.auth_list_workspaces(repeat('b',64))
      WHERE id='10000000-0000-4000-8000-000000000010' AND role_key='engineer') THEN
    RAISE EXCEPTION 'restored company approval failed';
  END IF;
  PERFORM app.platform_help_command(repeat('a',64),'publish','{"slug":"recovery-guide"}');
  IF (app.help_read('recovery-guide')->>'revision')::integer <> 2 THEN
    RAISE EXCEPTION 'restored help publishing failed';
  END IF;
  PERFORM app.auth_complete_login('https://recovery.example.test','a','pool-a@example.test',true,
    repeat('3',64),repeat('4',64),NULL,NULL,NULL,true);
  BEGIN
    PERFORM app.platform_help_command(repeat('3',64),'unpublish','{"slug":"recovery-guide"}');
    RAISE EXCEPTION 'restored ordinary session bypassed publisher MFA';
  EXCEPTION WHEN SQLSTATE 'PM001' THEN NULL;
  END;
END
$verify$;
ROLLBACK;
\echo RECOVERY_PORTAL_HELP_JOIN_OK
