# Deploying WellSim

This documents the **live production setup**, not a hypothetical one. WellSim
is a Node app (API + company case database), so a static host such as GitHub
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

API tokens live in files on the workstation and are **never** committed or
printed: `d:\github_token.txt`, `d:\hetzner_token.txt`,
`d:\wellsim_token.txt` (Cloudflare), `d:\render_token.txt` (unused). The
server takes SSH keys only. Rotate anything that has ever been pasted into a
chat, a terminal recording, or a shared document.

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
