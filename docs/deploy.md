# Deploying WellSim

This documents the **live production setup**, not a hypothetical one. WellSim
is a Node app (calculation API plus an explicitly gated legacy case store), so a static host such as GitHub
Pages or Cloudflare Pages **cannot run it** — those serve files only.

```
GitHub aleimam/wellsim  →  Hetzner VPS (Node + Caddy)  →  Cloudflare DNS  →  wellsim.app
```

## Production facts

| | |
|---|---|
| Host | Hetzner VPS, **91.98.23.255**, Ubuntu 24.04 LTS |
| Runtime | Node **v22** at `/usr/bin/node` — no npm install, the app has zero dependencies |
| App path | `/opt/wellsim/app`, owned by the `wellsim` service user |
| Service | systemd `wellsim.service`, `PORT=3355`, `Restart=always` |
| TLS / proxy | **Caddy v2**, `/etc/caddy/Caddyfile` — automatic Let's Encrypt, renews itself |
| Firewall | ufw: OpenSSH, 80/tcp, 443/tcp only |
| DNS | Cloudflare (both domains) |
| Also on this box | **thepwf.net** — a static site served by the same Caddy from `/opt/thepwf` |
| Access | SSH key only, password auth disabled. Private key: `~/.ssh/wellsim_hetzner` |
| Host keys | ED25519 `SHA256:bkTKZB/FixF9hI99Mp+634XNa/3Ohud4AK9kdl6ntI0` · RSA `SHA256:tHM+HmqYYOUok++pJ+bx9WgAzsZZ6HAKWIesnhxc0hg` (recorded 31 Aug 2026 — compare on any first connection from a new machine) |
| Key backup | `F:\WellSim-Backup-2026-08-29\ssh-key\` — passphrase-protected; passphrase in the password manager |

## Isolated v2 comparison environment

Development from `codex/v2-foundation` is published separately at
`https://bldrz.net`. It must never reuse or overwrite the production app
directory, service, port, logs or case data.

| | `wellsim.app` production | `bldrz.net` comparison |
|---|---|---|
| Branch | `main` | `codex/v2-foundation` |
| App path | `/opt/wellsim/app` | `/opt/bldrz/app` |
| Service | `wellsim.service` | `bldrz.service` |
| Local port | 3355 | 3356 |
| Access log | `wellsim.access.log` | `bldrz.access.log` |
| Stateful data | `/opt/wellsim/app/data` | `/opt/bldrz/app/data` |

The checked-in service and Caddy definitions are
`deploy/bldrz.service` and `deploy/bldrz.Caddyfile`. The legacy JSON account
store is explicitly disabled. PostgreSQL migrations `0001` through `0003` are
applied to the separate `bldrz` comparison database, but the current web
service does not load its database credential or use PostgreSQL yet.

The comparison source tree is owned by root and is read-only to the `bldrz`
service user. Only `/opt/bldrz/app/data` and
`/opt/bldrz/app/data-backups` are writable by that process; neither path is
shared with `wellsim.app`.

### Local-only PostgreSQL staging service

PostgreSQL 16.15 was installed from Ubuntu 24.04's supported repository on
2 September 2026. Cluster `16/main` is online on port 5432 and the effective
`listen_addresses` setting is exactly `127.0.0.1`. It does not listen on IPv6,
the public interface or any wildcard address. UFW has no rule for 5432, and an
external TCP test confirms that the port is unreachable from the workstation.

The loopback host rule uses `scram-sha-256`; local administrative access uses
the package-default peer authentication. The bind override is held in
`/var/lib/postgresql/16/main/postgresql.auto.conf`. The package-generated file
from immediately before the change is preserved at
`/var/lib/postgresql/16/main/postgresql.auto.conf.before-local-only-20260902`.

The comparison environment has these separate identities:

| Identity | Login | Purpose |
|---|---:|---|
| `bldrz_migration_owner` | No | Owns the `bldrz` database, schema, tables, functions and policies |
| `bldrz_app` | Yes | Password-authenticated connection identity; has `CONNECT` and may only switch to `bldrz_runtime` |
| `bldrz_runtime` | No | Least-privilege grants and RLS policy target; no DDL, delete, ownership or bypass privileges |

`PUBLIC` has no database, application-schema or application-table grant. The
login is `NOINHERIT`, so it has no direct schema access before a trusted
transaction executes `SET LOCAL ROLE bldrz_runtime`. All three roles are
non-superuser, cannot create databases or roles, and cannot bypass RLS. The
login has a 40-connection safety limit; normal concurrency must be handled by a
bounded application pool rather than one database connection per user.

The credential is stored only in `/etc/bldrz/postgresql.env`, owned
`root:bldrz` with mode `0640`. It is not committed, printed in deployment
records or loaded by `bldrz.service` yet. Do not expose port 5432 or use the
`postgres` operating-system/database account from an application service.

The portable migration names `wellsim_runtime`, but PostgreSQL roles are
cluster-global and this server also hosts WellSim production. For bldrz,
cluster role management was performed separately by the PostgreSQL
administrator and the schema portion of migration `0002` was rendered with
the isolated `bldrz_runtime` identifier. All application objects are owned by
`bldrz_migration_owner`. `app.schema_migration` records `0001`, `0002` and
`0003`.

Native PostgreSQL verification used a disposable clone of `bldrz`. Company A
saw one own case and zero Company B cases, changed zero cross-company rows, and
cross-company project/well links and export/case references were rejected by
composite foreign keys. The clone was removed after the test. The persistent
`bldrz` database remains empty of user and customer data.

Verify the boundary with:

```bash
sudo -u postgres psql -Atc "SHOW server_version; SHOW listen_addresses; SHOW port;"
sudo -u postgres psql -d bldrz -Atc "TABLE app.schema_migration;"
ss -ltnp | grep ':5432 '
pg_isready -h 127.0.0.1 -p 5432
systemctl is-active postgresql bldrz wellsim caddy
ufw status numbered
```

Deploy only a committed branch revision using `git archive`; never copy the
working tree or secrets. Before switching DNS, verify the comparison service
locally through `127.0.0.1:3356`, validate the complete Caddy configuration,
and confirm `wellsim.service` remains active on port 3355.

Caddyfile (whole file — Caddy handles certificates unprompted):

```
wellsim.app {
    reverse_proxy 127.0.0.1:3355
}
www.wellsim.app {
    redir https://wellsim.app{uri} permanent
}
thepwf.net {
    root * /opt/thepwf
    file_server
}
www.thepwf.net {
    redir https://thepwf.net{uri} permanent
}
```

## Deploy a new version

From a clean working tree on `main`, after `node --test` passes:

```bash
git archive --format=tar.gz -o /tmp/wellsim-src.tar.gz HEAD
scp -i ~/.ssh/wellsim_hetzner /tmp/wellsim-src.tar.gz root@91.98.23.255:/root/
ssh -i ~/.ssh/wellsim_hetzner root@91.98.23.255 \
  'tar -xzf /root/wellsim-src.tar.gz -C /opt/wellsim/app \
   && chown -R wellsim:wellsim /opt/wellsim/app \
   && systemctl restart wellsim && systemctl is-active wellsim'
```

`git archive` ships **exactly the committed tree**, so gitignored material
(`data/`, the Excel workbooks, training slides) never leaves the machine.

**Bump the asset stamp whenever `app.js`, `style.css` or `index.html`
changes.** Both are versioned by a query string in `src/ui/index.html`
(`?v=YYYY-MM-DD<letter>`); browsers cache those assets for 5 minutes and will
otherwise serve a stale bundle. HTML itself is sent `no-cache` and always
revalidates, so `help.html` needs no stamp.

### Two caveats of the tar deploy

1. **It overwrites, it never deletes.** A file removed from the repo stays on
   the server forever. To prune, delete it on the server explicitly (or wipe
   `/opt/wellsim/app` and re-extract — but move `data/` aside first).
2. **`data/` survives only because of that.** The case database lives at
   `/opt/wellsim/app/data` and is gitignored, so the archive does not contain
   it and tar leaves it alone. It is the only stateful thing in the
   application — **back it up separately**:

```bash
ssh -i ~/.ssh/wellsim_hetzner root@91.98.23.255 'tar -czf - -C /opt/wellsim/app data' > wellsim-data-backup.tar.gz
```

**A nightly on-box snapshot was verified on 2 Sep 2026**: enabled systemd timer
`wellsim-backup.timer` runs at 02:30 UTC, writes
`/var/backups/wellsim/wellsim-data-<date>.tar.gz`, and keeps 30 days. It lives
OUTSIDE `/opt/wellsim/app`, so re-extracting or wiping the app directory should
not take the archives with it. It is still the SAME DISK: it can survive a bad
write, bad deploy or accidental app-directory delete, not a lost server. The
command above is still the off-box pull, and is the one that actually protects
you. Recovery and deployment evidence is recorded in
[infrastructure-audit-2026-09-02.md](architecture/infrastructure-audit-2026-09-02.md).

## Access logs

Caddy logs requests per site (added 1 Sep 2026 — before that the site kept NO
traffic record at all):

```
/var/log/caddy/wellsim.access.log   # 10 MB roll, 10 kept
/var/log/caddy/thepwf.access.log
```

JSON, one object per request. The files must be owned by `caddy:caddy` — if
they are pre-created as root the reload fails with `permission denied` and
the OLD config keeps serving (no outage, but no new logging either).
Within an hour of switching this on it caught a live HTTP 500 on any root URL
carrying a query string, which had been shipping unnoticed.

## Backing up `data/` off-box

The legacy JSON account/case store is disabled unless the service explicitly
sets `WELLSIM_ENABLE_LEGACY_CASE_STORE=1`. Do not set that flag on a public
deployment merely to restore the old Sign in link: company slugs do not prove
membership. If the store is temporarily enabled for controlled migration,
also set a strong non-empty `WELLSIM_INVITE` and install/test an off-box backup
first. Visitor calculations and Save as / Open do not require either setting.

`data/` is the only stateful thing in the application — `users.json` and the
company case store. The app writes a rolling daily copy into `data-backups/`
and the verified systemd timer writes another archive under `/var/backups`, but
**both sit on the same disk as the thing they protect**: they survive a bad
write or accidental app-directory delete, not a lost server. As of 2 Sep 2026,
off-box transfer is still manual rather than scheduled.

**Do this before real client cases go in.** Two options; pick one.

### Option A — pull from the workstation (no server changes)

Simplest and needs nothing installed on the VPS. Run it from a machine that
holds the key, on whatever schedule you keep (Task Scheduler on Windows):

```bash
ssh -i ~/.ssh/wellsim_hetzner root@91.98.23.255 \
  'tar -czf - -C /opt/wellsim/app data' > wellsim-data-$(date +%F).tar.gz
```

Keep the archives somewhere that is **not** the workstation alone — the F:
backup drive, or any cloud folder. Prune to a retention you are happy with
(30 daily copies is ~a few MB while the case store is small).

### Option B — nightly on the server, pushed off-box

Survives the workstation being off. Create `/root/wellsim-backup.sh`:

```bash
#!/bin/sh
set -eu
STAMP=$(date +%F)
DEST=/root/wellsim-backups
mkdir -p "$DEST"
tar -czf "$DEST/wellsim-data-$STAMP.tar.gz" -C /opt/wellsim/app data
# keep 30 days locally
find "$DEST" -name "wellsim-data-*.tar.gz" -mtime +30 -delete
# --- send it OFF the box (pick one and uncomment) ---
# rclone copy "$DEST/wellsim-data-$STAMP.tar.gz" remote:wellsim-backups/
# scp "$DEST/wellsim-data-$STAMP.tar.gz" user@elsewhere:/backups/
```

```bash
chmod +x /root/wellsim-backup.sh
systemctl edit --force --full wellsim-backup.timer   # or a root crontab line
```

A backup that never leaves the VPS is **not** a backup — the local `find`
prune plus an off-box copy is the whole point. If you use the crontab route:
`10 2 * * * /root/wellsim-backup.sh` runs it nightly at 02:10.

### Restoring

```bash
systemctl stop wellsim
mv /opt/wellsim/app/data /opt/wellsim/app/data.before-restore
tar -xzf wellsim-data-YYYY-MM-DD.tar.gz -C /opt/wellsim/app
chown -R wellsim:wellsim /opt/wellsim/app/data
systemctl start wellsim && systemctl is-active wellsim
```

**An untested backup is not a backup.** Restore one into a scratch directory
and confirm `users.json` parses and a case file opens, at least once — and
again after any change to the case-store format. Sessions are in-memory, so a
restore signs everyone out; that is expected.

### Before this is needed

Check whether the server store is still empty:

```bash
ssh -i ~/.ssh/wellsim_hetzner root@91.98.23.255 \
  'ls -la /opt/wellsim/app/data/cases/ 2>/dev/null; wc -c /opt/wellsim/app/data/users.json 2>/dev/null'
```

HANDOVER §5 accepts the no-off-box-backup risk **only** while that store is
empty. The moment a real company account and its cases exist, Option A or B
stops being optional.

---

## Routine operations

```bash
systemctl status wellsim          # is it up
journalctl -u wellsim -n 100      # app log
journalctl -u caddy -n 50         # TLS / proxy log
systemctl restart wellsim         # after a deploy
```

A restart signs users out — sessions are in-memory. The case database on disk
is unaffected.

## Credentials

API tokens and backup-recovery secrets live in the excluded, access-restricted
workstation secrets area and are **never** committed or printed. The server
takes SSH keys only. Rotate anything that has ever been pasted into a chat, a
terminal recording, or a shared document.

## Alternatives (not in use)

- **Docker** — the repo carries a `Dockerfile`:
  `docker run -d -p 3355:3355 -v wellsim-data:/app/data --restart=always wellsim`
- **Render** — `render.yaml` is still present and configures a 1 GB persistent
  disk on `data/`. It needs a paid plan (the free tier has no disk, so the case
  database would vanish on every deploy); this was the original target before
  the move to Hetzner.

## Production notes

- The app sends its own security headers (nosniff, frame-deny, no-referrer)
  and cache policy; TLS and HSTS terminate at Caddy.
- No account is needed for any calculation — accounts only gate the server
  case store, so an auth outage never blocks engineering work.
