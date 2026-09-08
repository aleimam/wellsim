# Rebuilding the WellSim server from scratch

Captured from the live Hetzner box (`91.98.23.255`) on **8 September 2026**,
ahead of the planned move to a new server. Everything in this directory that
is named below was pulled **verbatim** from the running machine and verified
byte-for-byte against it, so a new box can be built from version control
rather than from memory.

Until this capture, four things that the site depends on existed **only on
that one disk**. If the box had been lost, they would have been reconstructed
from recollection — including the half of the account containment that is
invisible by design.

## Scope: WellSim moves, the other two stay (owner decision, 8 Sep 2026)

Only **wellsim.app** relocates. `thepwf.net` and `bldrz.net` stay on the old
box, untouched — which removes most of the risk this migration would otherwise
carry:

- **No PostgreSQL on the new server.** The `bldrz` database is the only one on
  the old box, and it stays there. WellSim's own database boundary is disabled
  (`WELLSIM_DATABASE_ENABLED` is not set, and the service logs *"PostgreSQL
  boundary: disabled"* at startup), so the new machine needs **Node and Caddy
  only**. `pg` is still required in `node_modules` — the server imports it
  unconditionally — but no database server process.
- **No coordination with the bldrz owner**, and no `pg_dump` to move.
- **One DNS change**, not three: `wellsim.app` and its `www`. The A records
  for `thepwf.net` and `bldrz.net` never move.
- **Install `Caddyfile.wellsim`, not `Caddyfile`.** The full capture is kept
  here as the record of what the old box served; the wellsim-only file is what
  the new box gets.

After cutover there is one small edit on the OLD box, and it touches nothing
belonging to the other two sites: remove the `wellsim.app` and
`www.wellsim.app` blocks from its `/etc/caddy/Caddyfile`, `systemctl reload
caddy`, then `systemctl disable --now wellsim wellsim-backup.timer`. Left in
place, that box keeps trying to renew a certificate for a name it no longer
serves and fills its log with the failures.

## What is captured here, and where it belongs

| File | Goes to | Notes |
|---|---|---|
| `wellsim.service` | `/etc/systemd/system/` | **Read the containment note below before editing.** |
| `Caddyfile` | *(record only)* | The **whole live file** from the old box — three sites, six names. Kept as evidence of what was there, not for installation. |
| `Caddyfile.wellsim` | `/etc/caddy/Caddyfile` | **This is what the new box gets**: the two wellsim blocks, verbatim, with thepwf and bldrz removed. |
| `wellsim-backup` | `/usr/local/bin/` (mode 755) | The plaintext nightly snapshot the timer actually runs. |
| `wellsim-backup.service` | `/etc/systemd/system/` | oneshot, calls the script above. |
| `wellsim-backup.timer` | `/etc/systemd/system/` | 02:30 UTC daily, `Persistent=true`. |

Already in this directory from earlier work, and **not** installed on the old
box: `wellsim-data-backup.service` / `.timer` and `backup-wellsim-data.sh` —
the *encrypted, off-box-destined* backup design. It is a different mechanism
from `wellsim-backup` above and does not replace it. The old box ran only the
plaintext one.

## The containment: the thing most easily lost in a migration

The legacy web account/case store is **shut on production**, and it is shut
**two independent ways**:

1. the code gate `27ea04e`, which is on the deployed branch; **and**
2. `WELLSIM_ENABLE_LEGACY_CASE_STORE` being **absent** from `wellsim.service`.

The second one is invisible — it is the *absence* of a line. A new box built
by someone who adds "helpful" environment variables, or who deploys a branch
without `27ea04e`, reopens public registration silently.

`main` **still does not contain `27ea04e`** (95 commits behind as of this
capture). Deploying `main` to a fresh box would reopen the store on a machine
nobody is watching yet.

**Verify after every rebuild, before DNS points anywhere:**

```bash
curl -s -X POST http://<new-ip>:3355/api/accounts/status \
  -H 'content-type: application/json' -d '{}'
# must be: {"enabled":false,"registrationEnabled":false,"mode":"legacy-web"}
```

## The old box hosted three sites, not one

The `Caddyfile` here is the live file and terminates TLS for six names:

- `wellsim.app` + `www` → `reverse_proxy 127.0.0.1:3355` (this app)
- `thepwf.net` + `www` → static, `root * /opt/thepwf`
- `bldrz.net` + `www` → `reverse_proxy 127.0.0.1:3356` — **the second
  machine's comparison app**, with its own `bldrz` PostgreSQL database and its
  own runtime user

**`bldrz.net` and `thepwf.net` are staying put.** The split above is the
chosen path: no `pg_dump`, no app directory to move, no owner sign-off needed,
and this full `Caddyfile` is trimmed to `Caddyfile.wellsim` for the new box.

`/opt/thepwf` stays on the old box and is not captured here: it is another
site's content, it is not moving, and it is not WellSim source.

## Rebuild order

1. **Ubuntu 24.04 LTS.** The old box ran 24.04.4 with Node **v22.23.2** at
   `/usr/bin/node` and a 38 GB disk (2.7 GB used).
2. Record the new host keys **from the Hetzner console**, not from the first
   SSH connection — that is the only way to know the first connection is not
   being intercepted.
3. Install the SSH keys, disable password authentication, and set `ufw` to
   allow **OpenSSH, 80/tcp, 443/tcp** and nothing else. No PostgreSQL is
   installed on this machine at all — see the scope note above.
4. Create the `wellsim` service user and `/opt/wellsim/app`, owned by it.
5. Install Caddy v2 and **`Caddyfile.wellsim`** as `/etc/caddy/Caddyfile`;
   create `/var/log/caddy`, writable by the caddy user.
6. Copy in `wellsim.service`, `wellsim-backup`, `wellsim-backup.service`,
   `wellsim-backup.timer`; `systemctl daemon-reload`; enable the timer.
7. Deploy the app **from a branch containing `27ea04e`** — see `deploy.md` for
   the `git archive` / `scp` / `tar` sequence.
8. `npm install --omit=dev` in `/opt/wellsim/app`. **Not optional**: since
   `713ce46` the server imports `pg` unconditionally and will crash-loop
   without it.
9. Restore `data/` from the most recent pull. `chown -R wellsim:wellsim`.
10. Start the service and run the verification below.

## Verify before moving DNS

```bash
systemctl is-active wellsim                      # active
systemctl show wellsim -p NRestarts              # NRestarts=0
# containment, as above — enabled:false
node scripts/module-smoke.mjs --base http://<new-ip>:3355   # 38/38
```

Then lower the Cloudflare TTL a day ahead, move the A records, watch
`journalctl -u caddy` until Let's Encrypt issues, and re-run the same checks
against the live names.

## Retiring WellSim from the old box (the box itself lives on)

The old server is **not** destroyed — it still serves thepwf.net and
bldrz.net. Once the new machine has served a full nightly backup cycle:

1. Take a final `data/` pull from the old box and confirm it restores.
2. Remove the two wellsim blocks from its `/etc/caddy/Caddyfile`;
   `systemctl reload caddy`.
3. `systemctl disable --now wellsim wellsim-backup.timer`.
4. Keep `/opt/wellsim` and `/var/backups/wellsim` for a while as a fallback,
   then remove them once the new box has a backup history of its own.
5. Update `docs/deploy.md` with the new IP, and add the new host keys to
   `~/.ssh/known_hosts` — recorded from the Hetzner console, not trusted from
   the first connection.
