#!/usr/bin/env bash
# No live migration: clone schema/reference definitions into an isolated probe.
set -euo pipefail
test "$(id -u)" = 0
APP_DIR=${1:?qualified source directory required}
PROBE_DB=bldrz_auth_probe
test -f "$APP_DIR/db/migrations/0004_verified_sessions.sql"
admin() {
  runuser -u postgres -- env -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER \
    -u PGPASSWORD -u DATABASE_URL "$@"
}
existing=$(admin psql -X -Atqc "SELECT 1 FROM pg_database WHERE datname='$PROBE_DB'")
if [ -n "$existing" ]; then echo 'Auth probe already exists; refusing overwrite' >&2; exit 1; fi
admin createdb --owner=bldrz_migration_owner --template=template0 "$PROBE_DB"
trap 'admin dropdb --if-exists "$PROBE_DB"' EXIT
admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB" -c \
  'REVOKE ALL ON DATABASE bldrz_auth_probe FROM PUBLIC; GRANT CONNECT ON DATABASE bldrz_auth_probe TO bldrz_app; REVOKE ALL ON SCHEMA public FROM PUBLIC;'
admin pg_dump --schema-only bldrz | admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
admin pg_dump --data-only --table=app.schema_migration --table=app.permission_definition \
  --table=app.role_definition --table=app.role_permission bldrz |
  admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
applied=$(admin psql -X -At -d "$PROBE_DB" -c "SELECT count(*) FROM app.schema_migration WHERE version='0004_verified_sessions'")
if [ "$applied" = 0 ]; then
  { printf 'SET ROLE bldrz_migration_owner;\n';
    sed 's/\<wellsim_runtime\>/bldrz_runtime/g' "$APP_DIR/db/migrations/0004_verified_sessions.sql";
  } | admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
fi
# These files have an exact database-name guard. Render that guard only for
# this explicitly named disposable clone, never for bldrz or a supplied name.
for fixture in pool-probe recovery-probe; do
  sed 's/bldrz_pool_probe/bldrz_auth_probe/g' "$APP_DIR/db/fixtures/$fixture.sql" |
    admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB"
done
admin psql -X -q -v ON_ERROR_STOP=1 -d "$PROBE_DB" < "$APP_DIR/db/fixtures/auth-probe.sql"
runuser -u bldrz -- bash -c '
  set -euo pipefail
  set -a; . /etc/bldrz/postgresql.env; set +a
  case "$DATABASE_URL" in
    */bldrz) export DATABASE_URL="${DATABASE_URL%/bldrz}/bldrz_auth_probe" ;;
    *) echo "Unexpected database URL" >&2; exit 1 ;;
  esac
  node "$1/scripts/verify-postgres-auth.mjs"
' bash "$APP_DIR"
