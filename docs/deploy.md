# Deploying WellSim to thepwf.net

WellSim is a Node app (API + company case database), so **GitHub Pages cannot
host it** — Pages serves static files only. The production architecture is:

```
GitHub repo (source of truth)  →  Node host (runs the server, auto-TLS)  →  thepwf.net (DNS)
```

The case database (`data/`) holds **user credentials and client cases** — it
is gitignored and must live on a **persistent disk** on the host.

## 1. Push the repo to GitHub

The repo is already initialized and committed locally. On GitHub, create an
empty **private** repo (e.g. `wellsim`), then:

```bash
git remote add origin https://github.com/<your-user>/wellsim.git
git push -u origin main
```

(Or install GitHub CLI and run `gh repo create wellsim --private --source . --push`.)

## 2. Host — Render (recommended, simplest with TLS + disk)

1. render.com → New → **Blueprint** → pick the GitHub repo. The included
   `render.yaml` configures everything: zero build step,
   `node src/server/server.js`, and a **1 GB persistent disk mounted on
   `data/`** (Starter plan — the free plan has no disk, so the case database
   would vanish on every deploy).
2. After the first deploy the app is live at `https://wellsim-XXXX.onrender.com`.
3. Service → **Settings → Custom Domains** → add `thepwf.net` and
   `www.thepwf.net`. Render provisions Let's Encrypt TLS automatically and
   renews it forever.

**DNS at your registrar for thepwf.net:**

| Type  | Name | Value |
|-------|------|-------|
| A     | @    | `216.24.57.1` (Render's apex IP — confirm in the Custom Domains screen) |
| CNAME | www  | `<your-service>.onrender.com` |

Propagation takes minutes to a few hours; Render shows a green check per
domain when TLS is issued.

## 3. Alternative — your own VPS (nginx + certbot)

For full control (any provider: Hetzner, DigitalOcean, Lightsail…):

```bash
# on the server (Ubuntu)
sudo apt install -y nginx certbot python3-certbot-nginx nodejs git
git clone https://github.com/<your-user>/wellsim.git /opt/wellsim
```

systemd unit `/etc/systemd/system/wellsim.service`:

```ini
[Unit]
Description=WellSim
After=network.target
[Service]
WorkingDirectory=/opt/wellsim
ExecStart=/usr/bin/node src/server/server.js
Environment=PORT=3355
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```

nginx site `/etc/nginx/sites-available/thepwf.net` (best-practice reverse
proxy: TLS termination, HSTS, gzip, proxy headers):

```nginx
server {
  server_name thepwf.net www.thepwf.net;
  location / {
    proxy_pass http://127.0.0.1:3355;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
  }
  gzip on;
  gzip_types text/html text/css application/javascript application/json;
  add_header Strict-Transport-Security "max-age=31536000" always;
}
```

```bash
sudo ln -s /etc/nginx/sites-available/thepwf.net /etc/nginx/sites-enabled/
sudo systemctl enable --now wellsim nginx
sudo certbot --nginx -d thepwf.net -d www.thepwf.net   # TLS + auto-renew
```

DNS: A records for `@` and `www` → the VPS IP.

## 4. Docker (any container host)

```bash
docker build -t wellsim .
docker run -d -p 3355:3355 -v wellsim-data:/app/data --restart=always wellsim
```

## Production notes

- The app already sends security headers (nosniff, frame-deny, no-referrer)
  and sane cache-control; **TLS/HSTS terminate at the platform or nginx**.
- Sessions are in-memory: a deploy/restart signs users out (they sign in
  again; the case database itself is on the persistent disk).
- Back up `data/` — it is the only stateful thing in the whole app.
- The free version stays free: no account is needed for any calculation;
  accounts only gate the server case store.
