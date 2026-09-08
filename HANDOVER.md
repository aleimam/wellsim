# WellSim — handover

**Live:** none — wellsim.app retired 8 Sep 2026; run locally or use the portable ·
**Codex comparison:** https://bldrz.net ·
**Repo:** https://github.com/aleimam/wellsim · **Manual:** `src/ui/help.html` (served at /help.html by a local run)

**WELLSIM.APP IS RETIRED.** On 8 September 2026 the owner retired the domain
outright and took WellSim off the Hetzner box. **There is no production site.**
The app runs **locally** (`npm start`, http://localhost:3355) and as the
portable exe until a new domain is chosen and stood up.

What was done to `91.98.23.255`, in order, each step verified:

1. Final `data/` pull taken and **read back**: 4 accounts, 8 cases, every one
   parsing as a WellSim case. Captured with the 30-day backup history, the
   configs and a server inventory to `WellSim-ServerRetirement-2026-09-08`
   on **D: and F:**, 11/11 checksums OK on both.
2. The two `wellsim.app` blocks removed from `/etc/caddy/Caddyfile`
   (backed up as `Caddyfile.bak-20260908`), `caddy validate` run **before**
   the reload, then reloaded.
3. `systemctl disable --now wellsim.service wellsim-backup.timer` —
   both inactive and disabled, port 3355 free on the box.
4. `/opt/wellsim` → `/opt/wellsim.retired-2026-09-08` and
   `/var/backups/wellsim` → `/var/backups/wellsim.retired-2026-09-08` —
   moved rather than deleted, so the irreversible step stayed the owner's.
5. **The owner then took that step, and it is verified:** `/opt/wellsim*` and
   `/var/backups/wellsim*` are gone from the box, port 3355 is free, the
   Caddyfile names only thepwf.net and bldrz.net (both HTTP 200) and its log
   carries no warnings. **WellSim's data is off that machine.** The only
   copies now are the capture on D: and F: and the workstation's own `data/`.
6. **The units went too**, also verified: `wellsim.service`,
   `wellsim-backup.service`, `wellsim-backup.timer` and
   `/usr/local/bin/wellsim-backup` are off the disk and systemd knows no
   wellsim unit at all. Caddy stayed active through it and thepwf.net and
   bldrz.net still answer 200, with no failed units on the box. All four
   files are committed verbatim under `deploy/`, so nothing was lost.

**The box lives on and still serves the other two sites**, which were never
touched: thepwf.net and bldrz.net both verified HTTP 200 after the Caddy
reload, their `www` names 301 as before. bldrz keeps its own PostgreSQL
database and runtime user.

Still outstanding:

- **DNS stays as it is — a decision, not an oversight (owner, 8 Sep 2026).**
  `wellsim.app` and `www.wellsim.app` still resolve to `91.98.23.255` through
  Cloudflare, and that is deliberate. **Do not "fix" it.** The end state is
  already the intended one, verified 8 Sep: HTTPS fails outright — no Caddy
  block claims the name, so no certificate is ever requested — while
  thepwf.net and bldrz.net on the same IP answer 200 from the same machine.
  The 308 on port 80 is Caddy's blanket HTTP→HTTPS redirect, returned
  identically for `Host: nosuchname.invalid`; it is the listener, not a
  WellSim site. **The name resolves and serves nothing.**

  What leaving the records in place does cost: they must be revisited before
  anything with a catch-all or on-demand TLS is ever added to that Caddy,
  since such a block would answer to a name WellSim no longer means to serve.
  Deleting the two A records turns the dead connection into a clean NXDOMAIN
  and removes that condition. **The registrar and Cloudflare remain the
  owner's alone** — no token for either is on this workstation.
- the `wellsim` service user (uid 996, `/usr/sbin/nologin`, home
  `/opt/wellsim` which no longer exists) is all that is left of the app on
  that box. It owns nothing and can log in nowhere; `userdel wellsim` closes
  it whenever it suits, and is the last thing to do there.
- when the new domain exists: `deploy/README-server-rebuild.md` has the whole
  rebuild order, and `deploy/Caddyfile.wellsim` is the site block to install.
  **Every published reference to wellsim.app then needs updating in one pass** —
  the manual, README, README-PORTABLE, this file, the brochure and the meeting
  invite in ALdocs.

The containment travels with the retirement: the account store was shut when
the site went down, and any new box must pass the same check before DNS points
at it — `/api/accounts/status` must report
`{"enabled":false,"registrationEnabled":false}`. `main` still lacks `27ea04e`
and must not be deployed anywhere.

**The containment held to the end, and it still binds the next box.** While
the site ran, `/api/accounts/status` reported
`{"enabled":false,"registrationEnabled":false,"mode":"legacy-web"}` and the
Sign in entry was hidden. It held two ways over — the gate commit `27ea04e` on
the deployed branch, AND `WELLSIM_ENABLE_LEGACY_CASE_STORE` absent from
`wellsim.service` (`Environment=PORT=3355 NODE_ENV=production`). Either alone
would keep registration closed. Both requirements carry forward verbatim to
whatever machine serves the new domain.

**`main` MUST NOT BE DEPLOYED ANYWHERE.** `27ea04e` is not on `main`, so a
fresh box built from `main` would reopen public registration on a machine
nobody is watching yet. The check in `deploy/README-server-rebuild.md` has to
pass before any DNS points at anything.

**Current working tree:** `main` merged into `codex/v2-foundation`,
344 tests passing and 43/43 validation sweep. The separate `bldrz`
database has migrations `0001`–`0003`, with least-privilege roles and an
opt-in, bounded PostgreSQL connection pool.

**Where the work sits, 8 September 2026 (evening):** branch
`merge/gas-forecast-into-v2` at `b0581d4` (176 commits), pushed to origin and
in sync. It is ahead of both `origin/main` (`de2393c`, by 97 commits) and
`origin/codex/v2-foundation` (`b087a24`) and **has not been merged into
either** — no PR exists yet. **This branch is the only place the current work
lives**, and with no site to hold a copy, that matters more than it did: the
backups on D: and F: and the pushed remote are the redundancy.

**The newest portable release is 2.5** (`D:\WellSim_2.5`, also on F:), built
from `9025968` and signed `CN=M. El-Ashry`. It carries everything the retired
site carried, so **the portable is now the delivery vehicle** — demos and
daily work need no domain at all.

The two-device branch/site contract below records the branch discipline. Its
site half is dormant: there is no site to deploy to, and a green test run was
never authorisation to release in any case.

---

## 1. What this is

A Node.js web app for oil, gas and water well engineering:
nodal analysis, minimum connected reserves from early production, and
production forecasting. It is a **faithful port of the M. El-Ashry Excel
toolset** — the author's tuned correlations and workflows are preserved
exactly; the spreadsheet macros are replaced by deterministic solvers.

The governing rule of the project: **the tested Excel workbooks are the
specification.** Where the port departs from a workbook it is a deliberate,
documented decision, not an improvement of the engineering. The two standing
deviations are an explicit Brill & Beggs Z-factor and Brent root-finding in
place of GoalSeek loops. Both are recorded in the manual under *Workbook
deviations*.

~8,900 lines of JavaScript across 6 core domains (`pvt`, `vlp`, `ipr`,
`nodal`, `reserve`, `solvers`), 35 test files.

## 2. Running it

```bash
npm ci
node src/server/server.js     # http://localhost:3355
```

The web server uses Node built-ins plus `pg` for opt-in PostgreSQL. The UI is
plain HTML/JS. Plotly is the single external asset, from a CDN.

```bash
npm test                          # 343 unit, regression and security tests
node scripts/validation-sweep.mjs # 43 physics checks against analytic answers
```

**Both must pass before any deploy.** The tests are not decoration: many pin
individual workbook cells to 15 digits, and they are the only thing standing
between a refactor and a silently wrong reservoir answer.

One development trap worth knowing: **Node caches modules**, so the dev
server must be restarted after editing anything under `src/server/` or
`src/core/`. A stale server returning old numbers looks exactly like a
physics bug.

## 3. Deploying

**There is nowhere to deploy to.** wellsim.app is retired and WellSim no
longer runs on the Hetzner box; see the retirement record at the top. The
deliverables are a local run and the portable exe.

When a new domain is stood up, **[deploy/README-server-rebuild.md](deploy/README-server-rebuild.md)**
is the rebuild order — captured from the live box before it left, including
the containment check that must pass before DNS points anywhere.
**[docs/deploy.md](docs/deploy.md)** still describes the deploy METHOD
accurately (the tar deploy never deletes files; `data/` survives only because
of that); only its host is gone.

The one rule that is easy to forget: **bump the asset stamp in
`src/ui/index.html` whenever `app.js`, `style.css` or `index.html` changes**,
or returning users get a cached bundle.

## 4. Where things live

```
src/core/pvt/        oil & gas PVT correlations (sour pseudo-criticals, Brill & Beggs Z)
src/core/vlp/        wellbore marches — oil/water (modified Griffith), gas (Gray),
                     water injector (downward march, Ramey temperature), ESP stack
src/core/ipr/        Darcy / Vogel / Jones / C&n inflow, oil-gas-water
src/core/nodal/      operating point (Brent), sensitivity families
src/core/reserve/    oil-reserve (Havlena-Odeh, static MB, reservoir limit)
                     gas-reserve (p/Z solver, SITHP march, gauge p/Z, reservoir limit, forecast)
                     tarner.js, walsh.js (the two oil forecast methods)
src/core/solvers/    Brent, bracketing
src/core/allift/     artificial-lift SELECTION (not design): limits.js is the
                     global, version-stamped 5-method x 8-parameter screening
                     matrix, screen.js the life-of-well envelope screen plus the
                     well-condition gates, economics.js the UDC screen. No
                     physics of its own — Qgross reuses the composite Vogel
src/server/api.js    every endpoint; the UI's only contract. TWO sensitivity
                     paths by design: oilSensitivity / gasSensitivity solve every
                     VLP set at the CURRENT Pr (all fluids, all lift types), and
                     oilEspSens solves an ESP FULLY at each future Pres
                     (0.9/0.8/0.7 x Pr) — the one place a pump is solved on a
                     depleted reservoir
src/server/server.js static file serving, security headers, case database, auth
src/ui/              index.html · app.js · style.css · help.html (the manual)
docs/                deploy.md · user-guide.md · equations.md
tests/               35 files — workbook cell pins, physics regressions, and
                     docs.test.js, which fails when documentation drifts from
                     the code (stale counts, removed endpoints, an unversioned
                     service worker)
scripts/             validation-sweep.mjs · make-icons.mjs
```

**Not in git, and deliberately so** (see `.gitignore`): `data/`,
`data-backups/`, `oil excel/`, `gas excel/`, `training slids/`, `*.xls*`,
`*.pptx`. The workbooks are the source material and the client cases are
private; neither belongs in a repository. They **are** in the F: backup.

## 5. Operational knowledge that is not in the code

- **The legacy company case store is disabled by default.** Its registration
  flow accepted a company slug typed by the registrant, which cannot establish
  company membership. `WELLSIM_ENABLE_LEGACY_CASE_STORE=1` is an explicit
  compatibility switch only; even then registration also requires a non-empty
  `WELLSIM_INVITE`. Do not enable it publicly as a substitute for the v2
  organization/membership model. Visitor calculations and Save as / Open are
  unaffected, and the portable build continues to use its local case folder.
- **`data/` is the only stateful thing in the entire application.** It holds
  `users.json` and the company case store, and is not in git. The deploy does
  not touch it and nothing else will recreate it.

  **THE NIGHTLY SERVER BACKUP NO LONGER RUNS.** It ran on the Hetzner box until
  8 September 2026 — `wellsim-backup.timer` (systemd, 02:30 UTC, 30 days kept)
  running `/usr/local/bin/wellsim-backup`, which tarred `/opt/wellsim/app/data`
  into `/var/backups/wellsim/`, deliberately outside the app directory so
  re-extracting or wiping it could not take the backups with it. That timer was
  disabled with the retirement. **Nothing is backing up automatically now.**

  What that store held is captured and safe: the final pull and the whole
  30-day history are in `WellSim-ServerRetirement-2026-09-08` on **D: and F:**,
  11/11 checksums OK on both — **4 accounts across 2 companies (bapetco, bap)
  and 8 saved client cases**, every one read back and confirmed to parse. The
  workstation's own `data/` is AHEAD of that capture (gas-lift-oil and gas-test
  were re-saved locally on 2 Sep with newer fields), so restoring the archive
  over it would roll those back.

  **The protection now is manual and yours.** Local `data/` and `data-backups/`
  sit on the same disk as the thing they protect — they survive a bad write,
  not a lost machine. The full-project backups to D: and F: are the off-machine
  copy, and they only exist when someone takes one. The script and units are
  preserved in `deploy/` so the timer can be reinstated verbatim on a new box.
  See also **docs/architecture/infrastructure-audit-2026-09-02.md**.
- **Sessions are in-memory.** Any restart signs users out. Cases on disk are
  unaffected. This is fine and expected; do not treat it as a bug report.
- **PostgreSQL 16.15 is installed for the `bldrz.net` comparison environment.**
  It listens only on `127.0.0.1:5432`; IPv6, wildcard/public listeners and a
  UFW rule for 5432 are absent. The separate `bldrz` database has migrations
  `0001` through `0003`, non-login owner `bldrz_migration_owner`, login
  `bldrz_app`, and non-login least-privilege role `bldrz_runtime`. Native tests
  proved cross-company read, modify, link and export isolation. The credential
  is only in `/etc/bldrz/postgresql.env` (`root:bldrz`, `0640`). The bldrz service
  loads it into a maximum-10 connection pool, with a 50-request admission cap,
  5-second acquisition timeout and 15-second statement timeout. Startup checks
  fail closed on unsafe role privileges. No authenticated v2 data route is
  exposed yet. A manual encrypted off-server PostgreSQL backup and fresh-
  cluster restore drill passed, including data equality, ownership, ACLs and
  two-company isolation after recovery. Identity integration and automated
  off-server retention/alerts/key redundancy remain gates. The new bldrz
  backup timer is deliberately not enabled yet. See
  **docs/architecture/bldrz-recovery.md**.
- **Charts are drawn by Plotly at their container's width**, and that width is
  often wrong at draw time — the container is hidden, or its flex layout has
  not settled, or the web font has not loaded. This caused a long tail of
  "overlapping chart" reports. Every chart therefore goes through `plot()` in
  `app.js`, which applies three **measure-after-draw** corrections in order,
  each a no-op when nothing is wrong:

  1. `fitChartWidth` — canvas vs its container (a chart drawn wider than its
     box laps the results table beside it),
  2. `fitChartTitle` — title vs canvas (shrink, then wrap at the em dash),
  3. `fitChartLegend` — legend vs the x-axis title (grow the bottom margin).

  `refitCharts()` re-runs all three over every visible chart and is wired to
  fonts-ready, window load, resize and orientationchange. **It was dead code
  until 30 Aug 2026** — defined but never called — which is why reloads used
  to show a size jump a second or two in. If charts ever look wrong, start
  with these four functions rather than the physics.
- **Chart ROWS are a pure function of state, not a side effect.**
  `applyOilRows()` derives every oil chart row from (module, lift, pump mode,
  ESP view); the module/lift/ESP-view switches all call it. It replaced
  visibility being set independently in four places, which repeatedly left
  rows stranded — most visibly, leaving the ESP Sensitivity view hid the
  nodal and wellhead charts for every other lift. Add new rows there, not in
  a switch.
- **The UI autosaves to localStorage** (`wellsim.session.v1`) using the same
  collectCase()/applyCase() serialisation as Save as / Open, and restores
  BEFORE the first solve so the startup run uses the restored case. Every
  storage access is guarded — private mode and blocked site data must degrade
  to "start from defaults", never to a broken app. Header **Reset** clears it.
- **The service worker is version-pinned to the asset stamp.** `sw.js` caches
  HTML network-first and never touches `/api/`, so a deploy is picked up
  immediately and no calculation is ever served from cache. A worker whose
  cache key did not move with the stamp would pin users to an old bundle —
  docs.test.js asserts the two match. Note app.js runs at the end of body, so
  registration checks `document.readyState` rather than waiting on `load`,
  which has usually already fired.
- **There is a second deliverable: `WellSim.exe`**, a single-file desktop
  build of the same app (Node SEA). `npm install && .\build.ps1` produces it
  from committed source; the outputs (`WellSim.exe`, `build/`) are gitignored
  because they are ~200 MB per build. It serves the identical UI and physics,
  stores cases in a `cases/` folder **beside the exe**, has no accounts, and
  takes the first free port from 3355. Current: **build 2.5, 8 Sep 2026**,
  from commit `9025968`, signed `CN=M. El-Ashry`; it lives at
  `D:\WellSim_2.5\` and `F:\WellSim_2.5\`, with 2.0–2.4 kept beside it.
  **With wellsim.app retired this is the shipping product**, not a sidecar. Builds 1.3–2.0 carry the ThePWF signature; that
  certificate and its private key were destroyed on 5 Sep and can never sign
  again — README-PORTABLE.md records what that does and does not change.

  Two things about it are easy to get wrong, and both were wrong until
  30 Aug 2026:

  1. **The web app loads Plotly from a CDN; the portable must not.** That
     swap used to be a hand edit to `src/ui/index.html` that existed only in
     the build folder and was never committed, so builds 1.0 and 1.1 were
     offline-capable *by accident* and the next clean-checkout rebuild would
     have shipped an exe with the whole UI and no charts. It is now done at
     serve time in `portable/main.js`, and docs.test.js asserts both the
     rewrite and that the vendored Plotly version equals the version
     index.html asks the CDN for.
  2. **The portable must not register the service worker.** It takes the
     first free port, so consecutive runs can be different origins, and a
     worker would strand itself and a cache on every port ever used.
     Registration is neutered in the served index.html.

  Both fixes live in the portable alone — the website's CDN tag and service
  worker are correct for the website and are untouched. Verify a build by
  running the exe and checking the page loads `/vendor/plotly.min.js`, not
  the CDN.
- **Secrets**, verified 8 Sep 2026: `d:\hetzner_token.txt` (64 bytes) and
  `d:\wellsim_token.txt` (Cloudflare, 53 bytes) are both present, as this
  file has always said. **`d:\github_token.txt` is not there** — that one
  path is stale, and `git push` works from the credential helper rather than
  a token file, so nothing depends on it.

  **A tooling trap worth knowing, because it produced a false alarm on 8 Sep:**
  an agent's sandboxed shell refuses to see or read files whose names look
  like secrets. `ls` reported *No such file or directory* for
  `d:\wellsim_token.txt` and a recursive search returned nothing, which was
  read as "the tokens are gone" and briefly written into this file. It was
  wrong — the deny looks exactly like an absence. **Confirm from an ordinary
  shell before concluding a secret has been lost**, and never work around the
  refusal by pasting a token into a chat or a terminal recording; anything
  that has been pasted must be rotated. They are never committed and never
  printed. The server accepts SSH keys only; the private key is
  `~/.ssh/wellsim_hetzner`. The root password file `d:\ssh pass` written
  during setup was **deleted on 29 Aug 2026**, and no rotation was needed:
  on the server `root` carries no password hash at all (`!*` in
  `/etc/shadow`) and `wellsim` is locked, so **no account on the box can be
  logged into with a password**. `PermitRootLogin without-password` enforces
  the same for root at the sshd level.

  Password authentication was **switched off on 29 Aug 2026**. The auth log
  had accumulated ~39,500 failed password attempts from internet background
  scanning; none could ever have succeeded, but sshd was processing them.
  `sshd_config` only had the directive commented out, so `yes` was sshd's
  compiled-in default rather than a deliberate setting. The fix is a drop-in
  rather than an edit to the shipped file, so a future `openssh-server`
  upgrade cannot quietly revert it:

  ```
  /etc/ssh/sshd_config.d/99-hardening.conf
      PasswordAuthentication no
      KbdInteractiveAuthentication no
  ```

  Drop-ins win because `Include /etc/ssh/sshd_config.d/*.conf` sits at line
  12 of `sshd_config` and sshd takes the **first** occurrence of a keyword.
  Applied with `sshd -t` validated first and `systemctl reload ssh` (not
  restart, so live sessions survive); verified afterwards by a fresh key
  login and by confirming the server now answers
  `Permission denied (publickey)` to a password-only attempt. The original
  file is backed up at `/root/sshd_config.bak-2026-08-29`.

  **2 Sep 2026, SINCE REVERSED: `wellsim_hetzner` was unauthorised for three
  days.** Key-only administrative access was restored through the Hetzner
  console that day and a new Ed25519 recovery identity was installed
  (`wellsim-ops-2026-09-02` in the Hetzner project). With `wellsim_hetzner`
  out of `authorized_keys` the server answered `Permission denied (publickey)`
  to it — verified from this workstation on 2 Sep, with no `Server accepts
  key` line — and deploys could not run from here.

  **It was re-added through the Hetzner console on 5 Sep 2026 and works
  again.** Same key, same fingerprint `SHA256:/3IAf9gT…`; it was never
  "retired", only unauthorised. Verified from this workstation on 5 Sep:
  `Server accepts key` followed by `Authenticated to 91.98.23.255 using
  "publickey"`. Three keys now open root — `wellsim-deploy`,
  `wellsim-ops-2026-09-02`, `wellsim-other-device-2026-09-03` — and none are
  to be removed. docs/deploy.md carries the same account plus the Windows
  gotcha that costs the most time: Git Bash's `ssh` cannot see the Windows
  ssh-agent, so use `C:\Windows\System32\OpenSSH\ssh.exe`. Everything below
  therefore describes the key still in use.

  See **docs/architecture/infrastructure-audit-2026-09-02.md** for why.

  **The consequence to respect: this host accepts no passwords — from this
  workstation it is reachable only with the private key
  `~/.ssh/wellsim_hetzner`.** Lose it and recovery is through the
  Hetzner console, not SSH. A passphrase-protected copy is kept on the F:
  backup drive at **`F:\WellSim-Backup-2026-08-29\ssh-key\`** (the key is
  `wellsim_hetzner` + `.pub`); the passphrase is in the password manager and
  deliberately NOT on that drive.

  **Recovered once, on 31 Aug 2026** — a new Windows account had no `~/.ssh`
  at all and the `d:\*.txt` token files had been deleted. What that taught:

  - This entry used to say the copy was at a bare `F:\ssh-key`. It is not;
    it is inside the dated backup folder above. A wrong path in a recovery
    procedure costs an hour exactly when you have none.
  - The restored key is **encrypted (`aes256-ctr`)**, so it prompts for the
    passphrase on every use. The "working copy stays passphrase-free" state
    this file used to describe is something you have to RE-CREATE after a
    restore: `ssh-keygen -p -f ~/.ssh/wellsim_hetzner` on the LOCAL copy
    only (leave the F: copy protected), or `ssh-add` it per session.
  - Windows needs the ACL tightened or OpenSSH refuses the key:
    `icacls %USERPROFILE%\.ssh\wellsim_hetzner /inheritance:r /grant:r "%USERNAME%:(R)"`
  - Verify without logging in: `ssh -v -o BatchMode=yes -i <key> root@<ip> true`
    prints **`Server accepts key`** when the key is still in `authorized_keys`.
    The `Permission denied (publickey)` that follows is only the unsupplied
    passphrase — not a rejected key. That one line is the whole test.
  - The two API tokens survived ONLY as WhatsApp transfer-cache copies, i.e.
    they had been sent through a chat. They were restored to keep work
    moving and are due for rotation (see Credentials in docs/deploy.md).
- **The code-signing PFX** and its password are for the desktop distributable.
  The PFX must not ship inside any distributed zip, and the password belongs
  in a password manager, not a file.

## 6. Known gaps — accepted, not oversights

These were each raised, discussed and consciously deferred. They are listed
so nobody rediscovers them as surprises.

**Water injector** (all four acknowledged by the author):
1. ~~No fracture / formation-parting limit~~ — **closed 30 Aug 2026**: a
   fracture-gradient input gives the parting pressure and the THP that lands
   on it. The gradient is an INPUT because it belongs to the rock (step-rate
   or leak-off test); no correlation here can predict it.
2. Injected-water temperature affects the bottom-hole temperature only; it
   does not feed back into viscosity along the march.
3. Skin is static — no fall-off-derived or time-dependent skin.
4. No surface-pressure ceiling — no pump or wellhead rating is enforced.

**Gas reserve, memory-gauge method:** ~~datum correction descoped~~ —
**closed 30 Aug 2026.** A *Gauge TVD* column corrects the reading through the
static gas column between gauge and perforations (`gaugeToDatum()`, reusing
the SITHP average-T&Z correlation), reporting the correction in its own
column. A blank depth keeps the previous behaviour of trusting the entered
value, so existing cases are unaffected.

**Oil forecast:** the material balance has no water-production term, so the
Forecast W.C affects lift only, never the balance. On a high-water-cut well
that is a real modelling limit, not a rounding issue.

**Demo data self-consistency:** the demo oil well carries a measured GOR of
5000 scf/stb against an Rsi of 700 at a pressure above the bubble point. The
material balance cannot reproduce that, so MB-derived and measured GOR
diverge sharply on the demo case. Real, consistent data does not show this.
Worth remembering before chasing it as a bug.

## 7. If you change the physics

1. Find the workbook cell it comes from. The workbooks are in `oil excel/`
   and `gas excel/` in the backup.
2. Pin it with a test at 15 digits, the way the existing tests do.
3. Run `npm test` **and** `node scripts/validation-sweep.mjs`.
4. Verify in the browser — the app is the deliverable, not the API.
5. Only then deploy, and bump the asset stamp.

## 8. Contact

**M. El-Ashry — muhamad.elashry@gmail.com**
