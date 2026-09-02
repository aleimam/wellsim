#!/usr/bin/env bash
# Encrypted backup of the WellSim case store, built to LEAVE the machine.
#
# Deliberately separate from the bldrz backup: no bldrz paths, no PostgreSQL,
# no cluster-wide role dump. It also does not replace the plaintext on-box
# snapshot (/usr/local/bin/wellsim-backup, wellsim-backup.timer at 02:30 UTC),
# which stays useful for a fast local rollback. The difference that matters:
# that one is plaintext on the same disk, so it cannot go off-box. This one is
# encrypted to a recipient whose PRIVATE identity never touches this server, so
# the archive is safe to copy anywhere -- including somewhere the server itself
# could not be trusted to reach.
#
# Pair it with deploy/serve-wellsim-backup.sh, which is what a restricted SSH
# key is allowed to run to fetch the result. Neither half is useful alone: this
# script only writes to local disk, and every backup path on this box has
# terminated on local disk since the beginning.
set -euo pipefail
umask 077
test "$(id -u)" = 0

APP_DIR=${1:-/opt/wellsim/app}
DATA_DIR="$APP_DIR/data"
AGE=${WELLSIM_AGE:-/opt/wellsim/tools/age/age}
RECIPIENT=${WELLSIM_BACKUP_RECIPIENT:-/etc/wellsim/backup-recipient.txt}
BACKUP_ROOT=/var/backups/wellsim/encrypted

# Retention is conservative on purpose: age-based pruning alone can empty the
# directory if the backup starts failing silently, so a floor by COUNT wins
# over the age rule.
KEEP_DAYS=${WELLSIM_BACKUP_KEEP_DAYS:-30}
KEEP_MIN=${WELLSIM_BACKUP_KEEP_MIN:-7}

test -x "$AGE"
test -s "$RECIPIENT"
test -d "$DATA_DIR"
# A symlinked backup root would let anything that can write /var/backups
# redirect the archive somewhere world-readable.
test ! -L /var/backups/wellsim
test ! -L "$BACKUP_ROOT"
install -d -o root -g root -m 700 /var/backups/wellsim "$BACKUP_ROOT"

exec 9>/run/lock/wellsim-data-backup.lock
flock -n 9 || { echo 'Another WellSim data backup is running' >&2; exit 1; }

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d "$BACKUP_ROOT/.partial.XXXXXXXX")
cleanup() {
  # Only a directory allocated by this invocation can be removed here.
  case "$WORK" in "$BACKUP_ROOT"/.partial.*) rm -rf -- "$WORK" ;; esac
}
trap cleanup EXIT

# Encrypted as a stream: no plaintext copy of the case store is ever written
# outside the live data directory.
tar -cf - -C "$APP_DIR" data |
  "$AGE" --encrypt -R "$RECIPIENT" -o "$WORK/data.tar.age"

# Counts and sizes only -- never case or user content. These are what let you
# spot "the backup succeeded but the store is empty" without decrypting.
CASE_COUNT=$(find "$DATA_DIR" -type f -name '*.json' 2>/dev/null | wc -l)
DATA_BYTES=$(du -sb "$DATA_DIR" | cut -f1)
{
  printf 'format=wellsim-data-v1\ncreated_utc=%s\n' "$STAMP"
  printf 'source=%s\n' "$DATA_DIR"
  printf 'encryption=age\ncoverage=case-store-and-accounts\n'
  printf 'plaintext_json_files=%s\nplaintext_bytes=%s\n' "$CASE_COUNT" "$DATA_BYTES"
  printf 'host=%s\n' "$(hostname)"
  test -f "$APP_DIR/DEPLOYED_REVISION" && cat "$APP_DIR/DEPLOYED_REVISION" || true
} > "$WORK/manifest.txt"
(cd "$WORK" && sha256sum data.tar.age manifest.txt > SHA256SUMS)

# Publish only after every pipeline and checksum has succeeded, so a partial
# run can never be mistaken for a backup.
FINAL="$BACKUP_ROOT/wellsim-data-$STAMP"
test ! -e "$FINAL"
mv -- "$WORK" "$FINAL"
trap - EXIT

# Prune, floor-by-count first.
mapfile -t ALL < <(find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'wellsim-data-*' | sort)
if [ "${#ALL[@]}" -gt "$KEEP_MIN" ]; then
  for d in "${ALL[@]:0:${#ALL[@]}-KEEP_MIN}"; do
    if [ -n "$(find "$d" -maxdepth 0 -mtime "+$KEEP_DAYS")" ]; then rm -rf -- "$d"; fi
  done
fi

printf 'WELLSIM_BACKUP_CREATED=%s\n' "$FINAL"
printf 'WELLSIM_BACKUP_JSON_FILES=%s\n' "$CASE_COUNT"
printf 'OFFSITE_STATUS=not-confirmed; a successful pull must verify SHA256SUMS\n'
