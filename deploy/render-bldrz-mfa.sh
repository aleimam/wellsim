#!/usr/bin/env bash
# Render only. Applying to a live database requires separate release approval.
set -euo pipefail
APP_DIR=${1:?qualified source directory required}
FILE="$APP_DIR/db/migrations/0006_administrator_mfa.sql"
test "$(grep -cx 'BEGIN;' "$FILE")" = 1
test "$(grep -cx 'COMMIT;' "$FILE")" = 1
cat <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE bldrz_migration_owner;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
  IF current_database() NOT IN ('bldrz','bldrz_pool_probe','bldrz_onboarding_probe') OR
    (SELECT array_agg(version ORDER BY version) FROM app.schema_migration) IS DISTINCT FROM
      ARRAY['0001_platform_foundation','0002_tenant_isolation','0003_personal_workspace_integrity',
        '0004_verified_sessions','0005_controlled_onboarding']::text[] THEN
    RAISE EXCEPTION 'MFA migration requires an approved bldrz database and exact 0001-0005 baseline';
  END IF;
END
$guard$;
SQL
sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' -e 's/\bwellsim_runtime\b/bldrz_runtime/g' "$FILE"
printf '\nCOMMIT;\n'
