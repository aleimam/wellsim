\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_pool_probe' THEN
    RAISE EXCEPTION 'identity recovery fixture requires bldrz_pool_probe';
  END IF;
END
$guard$;
SET ROLE bldrz_migration_owner;
BEGIN;
INSERT INTO app.auth_identity(id,user_id,provider,provider_subject) VALUES
 ('10000000-0000-4000-8000-000000000301','10000000-0000-4000-8000-000000000001','https://recovery.example.test','a'),
 ('20000000-0000-4000-8000-000000000302','20000000-0000-4000-8000-000000000002','https://recovery.example.test','b');
-- Known tokens exist only in the disposable synthetic database. Never copy
-- these records into a real environment. Calls exercise normal bootstrapping.
DO $fixture$
BEGIN
  IF to_regprocedure('app.auth_complete_login(text,text,text,boolean,text,text,text,bigint,uuid,boolean)') IS NOT NULL THEN
    PERFORM app.auth_complete_login('https://recovery.example.test','a','pool-a@example.test',true,
      repeat('a',64),repeat('c',64),NULL,floor(extract(epoch FROM clock_timestamp()))::bigint,NULL,true);
    PERFORM app.auth_complete_login('https://recovery.example.test','b','pool-b@example.test',true,
      repeat('b',64),repeat('d',64),NULL,floor(extract(epoch FROM clock_timestamp()))::bigint,NULL,true);
  ELSE
    PERFORM app.onboarding_sign_in('https://recovery.example.test','a','pool-a@example.test',true,repeat('a',64),repeat('c',64),NULL);
    PERFORM app.onboarding_sign_in('https://recovery.example.test','b','pool-b@example.test',true,repeat('b',64),repeat('d',64),NULL);
  END IF;
  PERFORM app.auth_create_flow(repeat('e',64),repeat('S',43),repeat('N',43),repeat('V',43));
  PERFORM app.onboarding_command(repeat('a',64),'invitation.create','10000000-0000-4000-8000-000000000010',
    jsonb_build_object('email','pool-b@example.test','role','viewer','tokenHash',repeat('f',64)));
END
$fixture$;
COMMIT;
