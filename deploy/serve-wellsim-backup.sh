#!/usr/bin/env bash
# The ONLY thing the backup-pull SSH key is permitted to run.
#
# Installed as a forced command, so whatever the client asks for is discarded
# and this runs instead. That is what lets an unattended job on a workstation
# fetch backups without holding root on this server: the key cannot open a
# shell, cannot read any other path, and cannot write anything at all.
#
# authorized_keys line (one line, in /root/.ssh/authorized_keys):
#
#   restrict,command="/opt/wellsim/app/deploy/serve-wellsim-backup.sh" ssh-ed25519 AAAA...  wellsim-backup-pull
#
# "restrict" switches off port, agent and X11 forwarding and pty allocation.
# Keep it: without it, a stolen pull key is a foothold on the network rather
# than a read of one directory.
set -euo pipefail
umask 077

BACKUP_ROOT=/var/backups/wellsim/encrypted

# The client's command is advisory only -- an exact-match allowlist, never a
# path, a glob or anything that reaches the shell.
VERB=${SSH_ORIGINAL_COMMAND:-latest}
case "$VERB" in
  latest|list) ;;
  *) echo 'Permitted: "latest" or "list"' >&2; exit 64 ;;
esac

test -d "$BACKUP_ROOT" || { echo 'No backup directory' >&2; exit 69; }

# Newest by name: the stamp is UTC and zero-padded, so lexical order IS
# chronological order. No mtime, which a restore or a copy could rewrite.
NEWEST=$(find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'wellsim-data-*' -printf '%f\n' | sort | tail -1)
test -n "$NEWEST" || { echo 'No backup found' >&2; exit 69; }

if [ "$VERB" = list ]; then
  find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'wellsim-data-*' -printf '%f\n' | sort
  exit 0
fi

# One tar stream of the newest backup directory: the age-encrypted archive, its
# manifest and its SHA256SUMS. Everything in it is already encrypted to a
# recipient this server has no private key for, so the stream carries no
# plaintext even if the transport were compromised.
exec tar -cf - -C "$BACKUP_ROOT" -- "$NEWEST"
