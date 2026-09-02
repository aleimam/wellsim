#!/usr/bin/env bash
# Dedicated bldrz backup. No wellsim paths, services or cluster-wide role dump.
set -euo pipefail
umask 077
test "$(id -u)" = 0
APP_DIR=${1:-/opt/bldrz/app}
AGE=/opt/bldrz/tools/age-v1.3.2/age/age
RECIPIENT=/etc/bldrz/backup-recipient.txt
BACKUP_ROOT=/var/backups/bldrz/postgresql
test -x "$AGE"
test -s "$RECIPIENT"
test -f "$APP_DIR/db/ops/bldrz-recovery-roles.sql"
test -f "$APP_DIR/db/ops/verify-bldrz-catalog.sql"
test ! -L /var/backups/bldrz
test ! -L "$BACKUP_ROOT"
install -d -o root -g root -m 700 /var/backups/bldrz "$BACKUP_ROOT"
exec 9>/run/lock/bldrz-db-backup.lock
flock -n 9 || { echo 'Another bldrz backup is running' >&2; exit 1; }

admin() {
  runuser -u postgres -- env -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER \
    -u PGPASSWORD -u DATABASE_URL "$@"
}
admin psql -X -q -v ON_ERROR_STOP=1 -d bldrz < "$APP_DIR/db/ops/verify-bldrz-catalog.sql"
STAMP=$(date -u +%Y%m%dT%H%M%S.%NZ)
WORK=$(mktemp -d "$BACKUP_ROOT/.partial.XXXXXXXX")
cleanup() {
  # Only a directory allocated by this invocation can be removed here.
  case "$WORK" in "$BACKUP_ROOT"/.partial.*) rm -rf -- "$WORK" ;; esac
}
trap cleanup EXIT

# pg_dump's consistent snapshot is encrypted as a stream: no plaintext
# database dump is written on the source server.
admin pg_dump --format=custom --compress=6 --dbname=bldrz |
  "$AGE" --encrypt -R "$RECIPIENT" -o "$WORK/database.dump.age"
tar -cf - -C / etc/bldrz/postgresql.env etc/bldrz/backup-recipient.txt \
  etc/systemd/system/bldrz.service opt/bldrz/DEPLOYED_REVISION |
  "$AGE" --encrypt -R "$RECIPIENT" -o "$WORK/recovery-config.tar.age"
install -m 600 "$APP_DIR/db/ops/bldrz-recovery-roles.sql" "$WORK/roles.sql"
{
  printf 'format=bldrz-postgresql-v1\ncreated_utc=%s\ndatabase=bldrz\n' "$STAMP"
  printf 'postgresql_version=%s\n' "$(admin psql -X -Atqc 'SHOW server_version')"
  printf 'encryption=age-v1.3.2\ncoverage=database-and-bldrz-runtime-config\n'
  printf 'file_blobs_covered=false\npoint_in_time_recovery=false\n'
  cat /opt/bldrz/DEPLOYED_REVISION
} > "$WORK/manifest.txt"
(cd "$WORK" && sha256sum database.dump.age recovery-config.tar.age roles.sql manifest.txt > SHA256SUMS)
# Publication only after every pipeline and checksum succeeds. No pruning
# until the independent destination and its retention policy are configured.
FINAL="$BACKUP_ROOT/bldrz-$STAMP"
test ! -e "$FINAL"
mv -- "$WORK" "$FINAL"
trap - EXIT
printf 'BLDRZ_BACKUP_CREATED=%s\n' "$FINAL"
printf 'OFFSITE_STATUS=not-confirmed; transfer and verification required\n'
