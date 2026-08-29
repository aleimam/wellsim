# WellSim — handover

**Live:** https://wellsim.app · **Repo:** https://github.com/aleimam/wellsim ·
**Manual:** https://wellsim.app/help.html
**As of:** 30 August 2026 — commit `65c86aa`, asset stamp `2026-08-30h`,
201 tests passing, 43/43 validation sweep.

---

## 1. What this is

A zero-dependency Node.js web app for oil, gas and water well engineering:
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
`nodal`, `reserve`, `solvers`), 23 test files, 61 commits.

## 2. Running it

```bash
node src/server/server.js     # http://localhost:3355
```

No `npm install` — the server uses only Node built-ins, and the UI is plain
HTML/JS. Plotly is the single external asset, from a CDN.

```bash
node --test                       # 201 unit + regression tests
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
tests/               23 files — workbook cell pins and physics regressions
scripts/             validation-sweep.mjs · make-icons.mjs
```

**Not in git, and deliberately so** (see `.gitignore`): `data/`,
`data-backups/`, `oil excel/`, `gas excel/`, `training slids/`, `*.xls*`,
`*.pptx`. The workbooks are the source material and the client cases are
private; neither belongs in a repository. They **are** in the F: backup.

## 5. Operational knowledge that is not in the code

- **`data/` is the only stateful thing in the entire application.** It holds
  `users.json` and the company case store, lives at `/opt/wellsim/app/data`,
  and is not in git. Back it up on its own schedule — the deploy does not
  touch it, and nothing else will recreate it.
- **Sessions are in-memory.** Any restart signs users out. Cases on disk are
  unaffected. This is fine and expected; do not treat it as a bug report.
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

  **The consequence to respect: this host is now reachable only with the
  private key `~/.ssh/wellsim_hetzner`.** Lose it and recovery is through the
  Hetzner console, not SSH. A passphrase-protected copy is kept on the F:
  backup drive under `ssh-key` with its own README; the passphrase is in the
  password manager and deliberately NOT on that drive. The working copy on
  the workstation stays passphrase-free so deploys run unattended.
- **The code-signing PFX** and its password are for the desktop distributable.
  The PFX must not ship inside any distributed zip, and the password belongs
  in a password manager, not a file.

## 6. Known gaps — accepted, not oversights

These were each raised, discussed and consciously deferred. They are listed
so nobody rediscovers them as surprises.

**Water injector** (all four acknowledged by the author):
1. No fracture / formation-parting pressure limit — the model will happily
   report an injection rate above what would fracture the formation.
2. Injected-water temperature affects the bottom-hole temperature only; it
   does not feed back into viscosity along the march.
3. Skin is static — no fall-off-derived or time-dependent skin.
4. No surface-pressure ceiling — no pump or wellhead rating is enforced.

**Gas reserve, memory-gauge method:** the entered Pr is taken as already
corrected to datum. A gauge sitting off-datum needs its own gas-column
correction first. This was explicitly descoped; the machinery to do it
already exists in the SITHP static march if it is ever wanted.

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
