#!/usr/bin/env bash
# Native qualification only: synthetic records in a new, fixed-name probe.
set -euo pipefail
test "$(id -u)" = 0
APP_DIR=$(realpath -e "${1:?qualified source directory required}")
PROBE_DB=bldrz_portal_probe
test -f "$APP_DIR/scripts/verify-postgres-portals.mjs"
admin() {
  runuser -u postgres -- env -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER \
    -u PGPASSWORD -u DATABASE_URL -u PGSERVICE -u PGOPTIONS "$@"
}
exec 9>/run/lock/bldrz-portal-probe.lock
flock -n 9 || { echo 'Portal qualification already running' >&2; exit 1; }
existing=$(admin psql -X -Atqc "SELECT 1 FROM pg_database WHERE datname='$PROBE_DB'")
test -z "$existing" || { echo 'Probe already exists; refusing overwrite' >&2; exit 1; }
expected='0001_platform_foundation,0002_tenant_isolation,0003_personal_workspace_integrity,0004_verified_sessions,0005_controlled_onboarding'
live_versions=$(admin psql -X -At -d bldrz -c "SELECT string_agg(version,',' ORDER BY version) FROM app.schema_migration")
test "$live_versions" = "$expected" || { echo 'Live baseline changed; review qualification' >&2; exit 1; }
admin createdb --owner=bldrz_migration_owner --template=template0 "$PROBE_DB"
cleanup() {
  admin dropdb "$PROBE_DB"
  echo 'PORTAL_PROBE_REMOVED'
}
trap cleanup EXIT
admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB" -c \
  'REVOKE ALL ON DATABASE bldrz_portal_probe FROM PUBLIC; GRANT CONNECT ON DATABASE bldrz_portal_probe TO bldrz_app; REVOKE ALL ON SCHEMA public FROM PUBLIC;'
admin pg_dump --schema-only --lock-wait-timeout=5s bldrz |
  admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
admin pg_dump --data-only --lock-wait-timeout=5s --table=app.schema_migration \
  --table=app.permission_definition --table=app.role_definition --table=app.role_permission bldrz |
  admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
bash "$APP_DIR/deploy/render-bldrz-portal-upgrade.sh" "$APP_DIR" | admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB" < "$APP_DIR/db/ops/verify-bldrz-catalog.sql"
admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB" < "$APP_DIR/db/fixtures/portal-native-admin.sql"
runuser -u bldrz -- bash -c '
  set -euo pipefail
  set -a; . /etc/bldrz/postgresql.env; set +a
  case "$DATABASE_URL" in
    */bldrz) export DATABASE_URL="${DATABASE_URL%/bldrz}/bldrz_portal_probe" ;;
    *) echo "Unexpected database URL" >&2; exit 1 ;;
  esac
  node "$1/scripts/verify-postgres-portals.mjs"
' bash "$APP_DIR"
after_versions=$(admin psql -X -At -d bldrz -c "SELECT string_agg(version,',' ORDER BY version) FROM app.schema_migration")
test "$after_versions" = "$live_versions"
echo 'LIVE_MIGRATION_BASELINE_UNCHANGED'
