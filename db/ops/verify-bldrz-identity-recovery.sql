\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_restore_security' THEN
    RAISE EXCEPTION 'identity security drill requires bldrz_restore_security';
  END IF;
  IF (SELECT count(*) FROM app.authentication_event) <> 2 OR
    (SELECT count(*) FROM app.web_session) <> 2 OR
    (SELECT count(*) FROM app.login_transaction) <> 1 THEN
    RAISE EXCEPTION 'nonempty identity data not restored';
  END IF;
END
$guard$;
SET SESSION AUTHORIZATION bldrz_app;
BEGIN;
SET LOCAL ROLE bldrz_runtime;
DO $verify$
DECLARE result jsonb;
BEGIN
  BEGIN
    PERFORM count(*) FROM app.web_session;
    RAISE EXCEPTION 'direct session read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT user_id FROM app.auth_read_session(repeat('a',64))) IS DISTINCT FROM
      '10000000-0000-4000-8000-000000000001'::uuid OR
    (SELECT count(*) FROM app.auth_list_workspaces(repeat('a',64))) <> 2 OR
    EXISTS (SELECT FROM app.auth_list_workspaces(repeat('a',64)) WHERE id='20000000-0000-4000-8000-000000000020') OR
    EXISTS (SELECT FROM app.auth_list_workspaces(repeat('b',64)) WHERE id='10000000-0000-4000-8000-000000000010') THEN
    RAISE EXCEPTION 'restored identity/workspace scope failed';
  END IF;
  BEGIN
    PERFORM app.onboarding_command(repeat('a',64),'members.list','20000000-0000-4000-8000-000000000020','{}');
    RAISE EXCEPTION 'cross-company management succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.onboarding_command(repeat('b',64),'members.list','10000000-0000-4000-8000-000000000010','{}');
    RAISE EXCEPTION 'reverse cross-company management succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM app.onboarding_command(repeat('a',64),'member.leave','10000000-0000-4000-8000-000000000010','{}');
    RAISE EXCEPTION 'restored last-owner protection failed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM app.onboarding_command(repeat('a',64),'invitation.accept',NULL,jsonb_build_object('tokenHash',repeat('f',64)));
    RAISE EXCEPTION 'wrong-email acceptance succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  result := app.onboarding_command(repeat('b',64),'invitation.accept',NULL,jsonb_build_object('tokenHash',repeat('f',64)));
  IF result->>'workspaceId' IS DISTINCT FROM '10000000-0000-4000-8000-000000000010' OR
    NOT EXISTS (SELECT FROM app.auth_list_workspaces(repeat('b',64))
      WHERE id='10000000-0000-4000-8000-000000000010' AND role_key='viewer') THEN
    RAISE EXCEPTION 'authorized restored invitation acceptance failed';
  END IF;
  BEGIN
    PERFORM app.onboarding_command(repeat('b',64),'invitation.accept',NULL,jsonb_build_object('tokenHash',repeat('f',64)));
    RAISE EXCEPTION 'restored invitation replay succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT count(*) FROM app.auth_consume_flow(repeat('e',64))) <> 1 OR
    (SELECT count(*) FROM app.auth_consume_flow(repeat('e',64))) <> 0 THEN
    RAISE EXCEPTION 'restored login flow is not single-use';
  END IF;
  PERFORM app.auth_revoke_session(repeat('a',64));
  IF to_regprocedure('app.auth_complete_login(text,text,text,boolean,text,text,text,bigint,uuid,boolean)') IS NOT NULL THEN
    IF (SELECT mfa_expires_at FROM app.auth_read_session(repeat('b',64))) IS NULL OR
      (SELECT mfa_expires_at FROM app.auth_read_session(repeat('b',64)))<=clock_timestamp() THEN
      RAISE EXCEPTION 'restored MFA assurance missing or expired';
    END IF;
    PERFORM app.auth_complete_login('https://recovery.example.test','b','pool-b@example.test',true,
      repeat('1',64),repeat('2',64),NULL,NULL,NULL,true);
    BEGIN
      PERFORM app.onboarding_command(repeat('1',64),'company.create',NULL,'{"name":"MFA bypass"}');
      RAISE EXCEPTION 'restored basic session bypassed MFA';
    EXCEPTION WHEN SQLSTATE 'PM001' THEN NULL;
    END;
    BEGIN
      PERFORM app.onboarding_command_v5(repeat('1',64),'company.create',NULL,'{"name":"Helper bypass"}');
      RAISE EXCEPTION 'restored private helper accessible';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    PERFORM app.onboarding_command(repeat('b',64),'members.list','20000000-0000-4000-8000-000000000020','{}');
  END IF;
  IF EXISTS (SELECT FROM app.auth_read_session(repeat('a',64))) OR
    EXISTS (SELECT FROM app.auth_list_workspaces(repeat('a',64))) THEN
    RAISE EXCEPTION 'restored session revocation failed';
  END IF;
END
$verify$;
ROLLBACK;
\echo RECOVERY_IDENTITY_ONBOARDING_OK
