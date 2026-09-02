# WellSim — handover

**Live:** https://wellsim.app · **Codex comparison:** https://bldrz.net ·
**Repo:** https://github.com/aleimam/wellsim · **Manual:** https://wellsim.app/help.html

**Live production revision:** 2 September 2026 — the containment release
`6807e73` from `codex/v2-foundation`, deployed 00:14:57 UTC. The legacy web
account/case store is DISABLED there: `/api/accounts/status` reports
`{"enabled":false,"registrationEnabled":false,"mode":"legacy-web"}` and the
Sign in entry is hidden. **Production does not track `main`** — check before
you deploy, or you will roll that containment back.

**Current working tree:** `main` merged into `codex/v2-foundation`,
309 tests passing and 43/43 validation sweep. The separate `bldrz`
database has migrations `0001`–`0003`, with least-privilege roles and an
opt-in, bounded PostgreSQL connection pool.

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
`nodal`, `reserve`, `solvers`), 36 test files.

## 2. Running it

```bash
npm ci
node src/server/server.js     # http://localhost:3355
```

The web server uses Node built-ins, `pg` for opt-in PostgreSQL, and
`openid-client` for gated sign-in. The UI is plain HTML/JS. Plotly is the single
external asset, from a CDN.

```bash
node --test                       # 309 unit, regression and security tests
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

See **[docs/deploy.md](docs/deploy.md)** — it documents the live Hetzner +
Caddy setup, the exact deploy command, and two caveats that will bite
otherwise (the tar deploy never deletes files; `data/` survives only because
of that).

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
src/server/api.js    every endpoint; the UI's only contract. TWO sensitivity
                     paths by design: oilSensitivity / gasSensitivity solve every
                     VLP set at the CURRENT Pr (all fluids, all lift types), and
                     oilEspSens solves an ESP FULLY at each future Pres
                     (0.9/0.8/0.7 x Pr) — the one place a pump is solved on a
                     depleted reservoir
src/server/server.js static file serving, security headers, case database, auth
src/ui/              index.html · app.js · style.css · help.html (the manual)
docs/                deploy.md · user-guide.md · equations.md
tests/               36 files — workbook cell pins, physics regressions, and
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
  `users.json` and the company case store, lives at `/opt/wellsim/app/data`,
  and is not in git. The deploy does not touch it and nothing else will
  recreate it.

  **A nightly backup runs, and the case store is NOT empty.** Both were the
  other way round until 1 Sep 2026, and this entry said so — it justified
  having no off-box copy on the grounds that there was nothing to lose.
  There is now: **4 accounts across 2 companies (bapetco, bap) and 8 saved
  client cases**, growing daily.

  What is installed on the box: `wellsim-backup.timer` (systemd, 02:30 UTC,
  30 days kept) running `/usr/local/bin/wellsim-backup`, which tars `data/`
  into **`/var/backups/wellsim/`** — deliberately outside `/opt/wellsim/app`
  so re-extracting or wiping the app directory cannot take the backups with
  it. The app also still writes its own rolling copy into `data-backups/`
  when a case is saved.

  **The 2 Sep infrastructure audit could not independently verify that
  timer** — the recovery SSH key and its documented `F:` backup were
  unavailable on the audit workstation and TCP/22 was closed or filtered
  from that network. It was verified on 1 Sep from the deploy workstation,
  so treat it as installed-and-once-verified rather than continuously
  monitored, and re-check it from the box when access allows.

  **Neither copy is off-box.** Both sit on the same disk as the thing they
  protect: they survive a bad write, a bad deploy or an accidental delete —
  NOT a lost server. The 2 Sep audit did pull one fresh encrypted archive
  off the VPS and recovery-tested it, but that was manual and is not
  scheduled. The off-box pull in **docs/deploy.md → “Backing up `data/`
  off-box”** is still the one that actually protects the client cases. A
  full manual snapshot was taken on 1 Sep 2026 into
  `D:WellSim-FullBackup-2026-09-01server-data`. See also
  **docs/architecture/infrastructure-audit-2026-09-02.md**.
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
- **OIDC authentication and controlled onboarding are implemented locally, not activated.**
  Migration `0004_verified_sessions`, server-side sessions and read-only
  company/private-workspace discovery are feature-gated. No provider has been
  selected/configured, no live migration applied, and public signup/invitations
  remain off. Migration `0005_controlled_onboarding` adds verified-email
  registration, private workspace bootstrap, explicit company creation,
  invitations and owner-controlled membership changes. `/workspace.html`
  provides the opt-in management UI. Direct runtime membership writes are
  revoked. Native multi-connection qualification of 0005 passed ten groups
  on PostgreSQL 16.15 against `d9a51f9`, including observed-lock invitation,
  demotion/revocation, first-sign-in and last-owner races. The disposable probe
  was removed; live bldrz remains at 0001–0003 with sign-in off. No live service
  was restarted. Real IdP setup, MFA policy and backup/restore gates remain. See
  **docs/architecture/identity-authentication.md** and
  **docs/architecture/company-onboarding.md** for boundaries and activation gates.
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
  takes the first free port from 3355. Current: **build 1.2, 30 Aug 2026**,
  from commit `ce63b3f`; it lives on the Transcend at `F:\petrosim\` and on
  the Desktop under `WellSim\`.

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
- **Secrets** are in `d:\github_token.txt`, `d:\hetzner_token.txt`,
  `d:\wellsim_token.txt` (Cloudflare). They are never committed and never
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

  **SUPERSEDED 2 Sep 2026: `wellsim-deploy` no longer works.** Key-only
  administrative access was restored through the Hetzner console that day and
  a new Ed25519 recovery identity was installed (`wellsim-ops-2026-09-02` in
  the Hetzner project). The server now answers `Permission denied (publickey)`
  to `wellsim_hetzner` — verified from this workstation on 2 Sep, with no
  `Server accepts key` line. The recovery key is NOT on this machine, so
  deploys cannot run from here. Everything below describes the retired key and
  is kept only because its lessons about ACLs, passphrases and F: paths still
  apply to whatever key replaces it.

  See **docs/architecture/infrastructure-audit-2026-09-02.md** for why.

  **The consequence to respect: this host is now reachable only with the
  private key `~/.ssh/wellsim_hetzner`.** Lose it and recovery is through the
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
3. Run `node --test` **and** `node scripts/validation-sweep.mjs`.
4. Verify in the browser — the app is the deliverable, not the API.
5. Only then deploy, and bump the asset stamp.

## 8. Contact

**M. El-Ashry — muhamad.elashry@gmail.com**
