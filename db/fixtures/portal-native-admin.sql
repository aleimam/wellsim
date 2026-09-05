\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_portal_probe' THEN
    RAISE EXCEPTION 'synthetic administrator requires the isolated portal probe';
  END IF;
END
$guard$;
BEGIN;
SET LOCAL ROLE bldrz_migration_owner;
INSERT INTO app.platform_administrator(user_id)
SELECT app.auth_complete_login('https://portal-qualification.example.test','platform-admin',
  'platform-admin@example.test',true,repeat('7',64),repeat('8',64),NULL,
  floor(extract(epoch FROM clock_timestamp()))::bigint,NULL,true);
COMMIT;
