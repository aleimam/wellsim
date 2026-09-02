#!/usr/bin/env bash
# Emit a single guarded transaction; does not connect to or change a database.
# Only the portable runtime identifier and outer transaction markers change.
set -euo pipefail
APP_DIR=${1:?qualified source directory required}
for name in 0004_verified_sessions 0005_controlled_onboarding; do
  test "$(grep -cx 'BEGIN;' "$APP_DIR/db/migrations/$name.sql")" = 1
  test "$(grep -cx 'COMMIT;' "$APP_DIR/db/migrations/$name.sql")" = 1
done
cat <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE bldrz_migration_owner;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
  IF current_database() NOT IN ('bldrz','bldrz_pool_probe') OR
    (SELECT array_agg(version ORDER BY version) FROM app.schema_migration) IS DISTINCT FROM
      ARRAY['0001_platform_foundation','0002_tenant_isolation','0003_personal_workspace_integrity']::text[] THEN
    RAISE EXCEPTION 'onboarding migration requires the exact qualified database and 0001-0003 baseline';
  END IF;
END
$guard$;
SQL
for name in 0004_verified_sessions 0005_controlled_onboarding; do
  sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' -e 's/\bwellsim_runtime\b/bldrz_runtime/g' \
    "$APP_DIR/db/migrations/$name.sql"
done
printf '\nCOMMIT;\n'
