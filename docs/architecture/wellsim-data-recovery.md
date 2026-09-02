# WellSim case-store recovery — closing the off-box gap

The case store (`/opt/wellsim/app/data`: `users.json` and the company cases) is
the only stateful thing in the application. Everything else is rebuildable from
Git in minutes.

## The gap this closes

Three backups already run, and **all three write to the same disk as the thing
they protect**:

| What | Where | Leaves the machine? |
|---|---|---|
| App rolling copy, on save | `data-backups/` | no |
| `wellsim-backup.timer`, 02:30 UTC | `/var/backups/wellsim/` | no |
| `bldrz-db-backup` (PostgreSQL, encrypted) | `/var/backups/bldrz/` | no — its timer says so in its own header |

They survive a bad write, a bad deploy, or an accidental delete. **They do not
survive a lost server.** The only hop that has ever left the machine is a human
copying to a USB drive, which is why the `F:` kit went four days stale without
anyone noticing, and why the key in it had been retired for a day.

So the missing piece was never "a backup". It was a *scheduled* hop off the
box, and something that makes staleness visible when it stops happening.

## Design

```
VPS                                        workstation
───                                        ───────────
backup-wellsim-data.sh   (01:45 UTC)
  tar data/ | age --encrypt -R recipient
  → /var/backups/wellsim/encrypted/wellsim-data-<stamp>/
        data.tar.age · manifest.txt · SHA256SUMS
                                    ↑
                    pull-wellsim-backup.ps1  (04:30 local)
                    ssh -i wellsim_pull  →  forced command
                      serve-wellsim-backup.sh  →  tar stream
                    verify SHA256SUMS → D:\WellSim-Backups\
                    opportunistic copy → F:\WellSim-RecoveryKit\
```

Two properties do the real work:

**The server cannot decrypt its own backups.** `age` encrypts to a recipient
public key; the private identity lives only on the recovery workstation and in
the password manager. Root on the VPS can make backups and cannot read old
ones. That is what makes it safe to copy the archive anywhere at all.

**The pull key cannot do anything except pull.** It is a forced command
(`restrict,command="…"`), so it opens no shell, reads no other path, and writes
nothing. An unattended scheduled job must not hold root, and this one does not.

## Install (server)

`age` first — reuse the bldrz copy or install its own:

```bash
install -d -m 755 /opt/wellsim/tools
ln -s /opt/bldrz/tools/age-v1.3.2/age/age /opt/wellsim/tools/age
```

Generate the recipient **on the recovery workstation, not the server** — the
private half must never be on the box it protects:

```bash
age-keygen -o wellsim-backup-identity.txt     # keep OFF the server
```

Put only the public line on the VPS:

```bash
install -d -m 700 /etc/wellsim
printf 'age1...\n' > /etc/wellsim/backup-recipient.txt
chmod 600 /etc/wellsim/backup-recipient.txt
```

Then the unit. Both scripts arrive with the deploy tar at
`/opt/wellsim/app/deploy/` and `git archive` carries their mode bits, so
nothing needs copying — but check the forced-command one is executable, because
sshd runs it directly rather than through `bash`:

```bash
test -x /opt/wellsim/app/deploy/serve-wellsim-backup.sh || \
  chmod 755 /opt/wellsim/app/deploy/serve-wellsim-backup.sh
install -m 644 /opt/wellsim/app/deploy/wellsim-data-backup.service \
               /opt/wellsim/app/deploy/wellsim-data-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start wellsim-data-backup.service   # run once by hand FIRST
systemctl status wellsim-data-backup.service  # confirm it wrote a backup
systemctl enable --now wellsim-data-backup.timer
```

Run it by hand before enabling the timer. A first run that fails at 01:45 is a
failure nobody sees until the pull is also stale.

## Install (pull key)

On the workstation:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/wellsim_pull -C wellsim-backup-pull -N ""
```

On the server, one line in `/root/.ssh/authorized_keys`:

```
restrict,command="/opt/wellsim/app/deploy/serve-wellsim-backup.sh" ssh-ed25519 AAAA... wellsim-backup-pull
```

Prove it before scheduling anything:

```bash
powershell -File deploy\pull-wellsim-backup.ps1 -WhatIfList
```

That lists the backups and fetches nothing. If it fails, the key, the forced
command, or host-key trust is not in place — fix that before the timer exists.

## Verify a backup is actually restorable

A backup nobody has restored is a hypothesis. On the recovery workstation,
where the identity lives:

```bash
age --decrypt -i wellsim-backup-identity.txt -o data.tar data.tar.age
tar -tf data.tar | head
mkdir scratch && tar -xf data.tar -C scratch
node -e "JSON.parse(require('fs').readFileSync('scratch/data/users.json'))" && echo "users.json parses"
ls scratch/data/cases | wc -l
```

Compare the case count against `plaintext_json_files` in `manifest.txt`. The
manifest carries counts and sizes only — never case or user content — so this
check works without anyone reading a client's data.

## Two rules that decide whether any of this works

**Never store the identity beside the archives.** `READ-ME-FIRST.txt` on the
`F:` kit already says it about the SSH passphrase, and it applies unchanged
here: if `wellsim-backup-identity.txt` sits on `F:` next to the `.age` files,
the encryption buys nothing against losing the drive. Archives on `F:`,
identity in the password manager and on one separately protected medium.

**Both halves of a recovery kit must be current.** A fresh key with a stale
archive is no more useful than a stale archive with a fresh key. `LAST-PULL.txt`
is written only after checksum verification passes, so its date is a true
freshness signal — if it is old, the pull has been failing.

## Still open

- The `F:` copy is opportunistic: a scheduled job cannot rely on removable
  media being mounted. Treat it as the periodic cold copy, not the target.
- No failure alerting. A silent pull failure shows up only as a stale
  `LAST-PULL.txt`. The audit's P1 register calls for alerts; this does not
  provide them.
- `BitLocker` on `F:` — it holds a code-signing PFX in three places today and
  is intended to hold recovery material.
