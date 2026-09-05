\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'bldrz_pool_probe' THEN
    RAISE EXCEPTION 'portal recovery fixture requires bldrz_pool_probe';
  END IF;
END
$guard$;
BEGIN;
SET LOCAL ROLE bldrz_migration_owner;
-- The older engineering recovery fixture creates workspaces directly; the
-- portal directory additionally requires their organization records.
INSERT INTO app.organization(workspace_id,legal_name) VALUES
 ('10000000-0000-4000-8000-000000000010','Recovery company A'),
 ('20000000-0000-4000-8000-000000000020','Recovery company B');
INSERT INTO app.platform_administrator(user_id)
VALUES('10000000-0000-4000-8000-000000000001');
DO $fixture$
BEGIN
  PERFORM app.portal_command(repeat('a',64),'company.settings.update',
    '10000000-0000-4000-8000-000000000010','{"joinPolicy":"request","directorySummary":"Synthetic recovery company"}');
  PERFORM app.portal_command(repeat('b',64),'join.create',
    '10000000-0000-4000-8000-000000000010','{}');
  PERFORM app.platform_help_command(repeat('a',64),'save',
    '{"slug":"recovery-guide","section":"security","sortOrder":10,"title":"Recovery guide","summary":"Synthetic","bodyMarkdown":"Published recovery instructions"}');
  PERFORM app.platform_help_command(repeat('a',64),'publish','{"slug":"recovery-guide"}');
  PERFORM app.platform_help_command(repeat('a',64),'save',
    '{"slug":"recovery-guide","section":"security","sortOrder":10,"title":"Recovery draft","summary":"Private draft","bodyMarkdown":"Unpublished recovery instructions"}');
END
$fixture$;
COMMIT;
