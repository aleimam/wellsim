#!/usr/bin/env bash
# Restore only into a brand-new private, socket-only PostgreSQL 16 cluster.
# Input is a dump decrypted OFF-SERVER. Never copy the real recovery key here.
set -euo pipefail
umask 077
test "$(id -u)" = 0
APP_DIR=${1:?absolute qualified source directory required}
DUMP=${2:?absolute decrypted dump path required}
test -f "$DUMP"
PG_BIN=/usr/lib/postgresql/16/bin
AGE_DIR=/opt/bldrz/tools/age-v1.3.2/age
DRILL=$(mktemp -d /var/lib/postgresql/bldrz-restore-drill.XXXXXXXX)
test "$(realpath -- "$DRILL")" = "$DRILL"
chmod 700 "$DRILL"
chown postgres:postgres "$DRILL"
STARTED=false
cleanup() {
  if [ "$STARTED" = true ] && [ -f "$DRILL/cluster/postmaster.pid" ]; then
    runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$DRILL/cluster" -m fast -w stop || return 1
  fi
  case "$DRILL" in /var/lib/postgresql/bldrz-restore-drill.*)
    test "$(realpath -- "$DRILL")" = "$DRILL" && rm -rf -- "$DRILL" ;;
    *) echo 'Refusing unexpected cleanup target' >&2; return 1 ;;
  esac
}
trap cleanup EXIT
admin() {
  runuser -u postgres -- env -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER \
    -u PGPASSWORD -u DATABASE_URL "$@"
}
psql_drill() { admin "$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$DRILL" -p 55432 "$@"; }
new_database() {
  case "$1" in bldrz_restore_probe|bldrz_pool_probe|bldrz_restore_security) ;; *) exit 1 ;; esac
  admin "$PG_BIN/createdb" -h "$DRILL" -p 55432 --template=template0 --owner=bldrz_migration_owner "$1"
  psql_drill -d "$1" -c "REVOKE ALL ON DATABASE $1 FROM PUBLIC; GRANT CONNECT ON DATABASE $1 TO bldrz_app; REVOKE ALL ON SCHEMA public FROM PUBLIC;"
}
restore_dump() {
  admin "$PG_BIN/pg_restore" -h "$DRILL" -p 55432 --single-transaction --exit-on-error --dbname="$1"
}
fingerprint() {
  psql_drill -d "$1" < "$APP_DIR/db/ops/recovery-fingerprint.sql" | sha256sum | cut -d' ' -f1
}
admin "$PG_BIN/initdb" -D "$DRILL/cluster" --auth-local=trust --auth-host=reject --no-instructions > /dev/null
# Directory/socket mode 0700 restricts the trust-authenticated socket to
# postgres/root. listen_addresses='' means no TCP or public listener exists.
STARTED=true
admin "$PG_BIN/pg_ctl" -D "$DRILL/cluster" -l "$DRILL/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='$DRILL' -c unix_socket_permissions=0700 -p 55432" -w start
psql_drill -d postgres < "$APP_DIR/db/ops/bldrz-recovery-roles.sql"
new_database bldrz_restore_probe
restore_dump bldrz_restore_probe < "$DUMP"
psql_drill -d bldrz_restore_probe < "$APP_DIR/db/ops/verify-bldrz-catalog.sql"
printf 'RESTORED_SOURCE_DATA_SHA256=%s\n' "$(fingerprint bldrz_restore_probe)"

# Add no synthetic records to the live database or to its recovered copy.
# The second database contains only restored schema/reference definitions.
new_database bldrz_pool_probe
admin "$PG_BIN/pg_dump" -h "$DRILL" -p 55432 --schema-only bldrz_restore_probe |
  psql_drill -d bldrz_pool_probe
admin "$PG_BIN/pg_dump" -h "$DRILL" -p 55432 --data-only --table=app.schema_migration \
  --table=app.permission_definition --table=app.role_definition --table=app.role_permission bldrz_restore_probe |
  psql_drill -d bldrz_pool_probe
psql_drill -d bldrz_pool_probe < "$APP_DIR/db/fixtures/pool-probe.sql"
psql_drill -d bldrz_pool_probe < "$APP_DIR/db/fixtures/recovery-probe.sql"
BEFORE=$(fingerprint bldrz_pool_probe)
# This disposable key protects SYNTHETIC test data only, and is removed with
# the temporary cluster. It is unrelated to the off-server recovery identity.
"$AGE_DIR/age-keygen" -o "$DRILL/synthetic-identity.txt" 2>/dev/null
RECIPIENT=$("$AGE_DIR/age-keygen" -y "$DRILL/synthetic-identity.txt")
admin "$PG_BIN/pg_dump" -h "$DRILL" -p 55432 --format=custom bldrz_pool_probe |
  "$AGE_DIR/age" --encrypt -r "$RECIPIENT" -o "$DRILL/synthetic.dump.age"
new_database bldrz_restore_security
"$AGE_DIR/age" --decrypt -i "$DRILL/synthetic-identity.txt" "$DRILL/synthetic.dump.age" |
  restore_dump bldrz_restore_security
AFTER=$(fingerprint bldrz_restore_security)
test "$BEFORE" = "$AFTER"
printf 'RECOVERY_SYNTHETIC_DATA_MATCH_OK\n'
psql_drill -d bldrz_restore_security < "$APP_DIR/db/ops/verify-bldrz-catalog.sql"
psql_drill -d bldrz_restore_security < "$APP_DIR/db/ops/verify-bldrz-recovery.sql"
printf 'BLDRZ_RESTORE_DRILL_OK\n'
