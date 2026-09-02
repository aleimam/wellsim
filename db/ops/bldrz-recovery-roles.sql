-- Fresh recovery cluster only. Never alter existing shared-cluster roles.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN
    ('bldrz_app', 'bldrz_runtime', 'bldrz_migration_owner')) THEN
    RAISE EXCEPTION 'bldrz roles already exist: refusing recovery bootstrap';
  END IF;
END
$guard$;
CREATE ROLE bldrz_migration_owner NOLOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE bldrz_runtime NOLOGIN NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
-- No password is embedded in SQL. Restore it from the encrypted recovery
-- configuration or rotate it before enabling the recovered web application.
CREATE ROLE bldrz_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
GRANT bldrz_runtime TO bldrz_app WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
COMMIT;
