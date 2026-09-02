#!/usr/bin/env bash
# Root-only native verification. Copies schema/reference definitions, never
# customer rows, into a disposable database; production connections can stay up.
set -euo pipefail
test "$(id -u)" = 0
APP_DIR=${1:-/opt/bldrz/app}
PROBE_DB=bldrz_pool_probe
test -f "$APP_DIR/scripts/verify-postgres-pool.mjs"
test -f "$APP_DIR/db/fixtures/pool-probe.sql"

admin() {
  runuser -u postgres -- env -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER \
    -u PGPASSWORD -u DATABASE_URL "$@"
}
existing=$(admin psql -X -Atqc "SELECT 1 FROM pg_database WHERE datname='$PROBE_DB'")
if [ -n "$existing" ]; then
  echo 'Probe database already exists; refusing to overwrite it.' >&2
  exit 1
fi
admin createdb --owner=bldrz_migration_owner --template=template0 "$PROBE_DB"
trap 'admin dropdb --if-exists "$PROBE_DB"' EXIT
admin psql -X -v ON_ERROR_STOP=1 -d "$PROBE_DB" -c \
  'REVOKE ALL ON DATABASE bldrz_pool_probe FROM PUBLIC; GRANT CONNECT ON DATABASE bldrz_pool_probe TO bldrz_app; REVOKE ALL ON SCHEMA public FROM PUBLIC;'
admin pg_dump --schema-only bldrz | admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
admin pg_dump --data-only --table=app.schema_migration \
  --table=app.permission_definition --table=app.role_definition \
  --table=app.role_permission bldrz | admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB" < "$APP_DIR/db/fixtures/pool-probe.sql"

runuser -u bldrz -- bash -c '
  set -euo pipefail
  set -a
  . /etc/bldrz/postgresql.env
  set +a
  case "$DATABASE_URL" in
    */bldrz) export DATABASE_URL="${DATABASE_URL%/bldrz}/bldrz_pool_probe" ;;
    *) echo "Unexpected source database URL" >&2; exit 1 ;;
  esac
  node "$1/scripts/verify-postgres-pool.mjs"
' bash "$APP_DIR"
