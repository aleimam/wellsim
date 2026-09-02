# WellSim infrastructure audit — 2026-09-02

Status: audit and recovery gates completed; containment release
`6807e738f93119d8459a688ea92894f3831f2d9b` deployed at 00:14:57 UTC.

## Decision

The three P0 recovery/containment gates identified by the initial audit have
been completed: key-only administrative access was restored, a fresh encrypted
off-box data archive was recovery-tested, and the legacy web account/case store
was disabled in production. The v2 foundation remains a design and review
branch; PostgreSQL tenancy, CI, staging, provider recovery controls and a
scheduled off-box backup are still required before production becomes the
system of record for new company data.

No credential value was copied into the repository or audit output.

## Evidence captured

### Source and release controls

- GitHub repository: public `aleimam/wellsim`; default branch `main`.
- Production baseline in Git: `2d60c5e38d8a9ae715840c79240715afc63af7fd`.
- Containment and architecture branch: `codex/v2-foundation`, commit
  `6807e738f93119d8459a688ea92894f3831f2d9b` (contains security commit
  `27ea04eb419f883dd91c4b6d7dcfdde24177e4fe`).
- `main` has no branch protection.
- The repository has no GitHub Actions workflows, deployment environments,
  recorded GitHub deployments or webhooks.
- GitHub secret scanning and push protection are enabled. Dependabot security
  updates are disabled.
- The branch passed 251/251 Node tests, the 43/43 physics validation sweep,
  JavaScript syntax checks and `git diff --check` before push.

### DNS and public edge

- Cloudflare is authoritative for the active `wellsim.app` zone, but both apex
  and `www` A records point directly to `91.98.23.255` with proxying disabled.
  Caddy on the VPS therefore terminates public TLS.
- `http://wellsim.app/` returns 308 to HTTPS.
- `https://www.wellsim.app/` returns 301 to the apex domain.
- The apex home page, help page and versioned assets return 200.
- The Let's Encrypt certificate for `wellsim.app` was valid from 27 Aug 2026 to
  25 Nov 2026 at the time of the audit.
- Responses include `X-Content-Type-Options`, `X-Frame-Options` and
  `Referrer-Policy`. HSTS, Content Security Policy and Permissions Policy were
  not observed.
- TCP/80, TCP/443 and key-only TCP/22 are reachable. The application process
  listens on port 3355 on all interfaces, but UFW denies that port; binding it
  explicitly to loopback remains a defense-in-depth action.
- The Cloudflare token could read DNS but not zone security settings, so TLS
  minimums and other zone settings were not assumed from an API failure.

### Runtime hosting

- Hetzner reports one running `cx23` server named `wellsim`, created 27 Aug
  2026, at the documented address `91.98.23.255`.
- Hetzner provider backups are disabled (`backup_window` absent).
- No Hetzner snapshots, attached volumes, cloud networks or cloud firewalls are
  present.
- Delete and rebuild protection are disabled on the server.
- Render returns no services for the supplied account token. `render.yaml` is
  repository history/configuration, not evidence of a live staging system.

### Production release state

- The release archive was generated from exact commit `6807e738f93119d8459a688ea92894f3831f2d9b`;
  its local and server SHA-256 was
  `28850b2eee7fecb0c980bef06c352640eedd431234da325385560e8c1b034ba8`.
- `wellsim.service` restarted successfully and both it and `caddy.service`
  remained active.
- `GET /api/accounts/status` returns `enabled: false` and
  `registrationEnabled: false`; the service does not set the legacy-store
  compatibility switch.
- The public UI serves asset stamp `2026-09-02a`, and its Sign-in entry point is
  hidden by default.
- A public oil nodal smoke calculation completed with `opStatus: ok`, 12 IPR
  points and 13 VLP points. Queried root URLs return 200, and `thepwf.net`
  remained online.
- No account was registered and no case was saved or changed during audit or
  smoke testing.

### Access and backup state

- A new Ed25519 recovery identity is installed and key-only SSH succeeds.
  Effective SSH configuration reports public-key authentication enabled,
  password and keyboard-interactive authentication disabled, root login limited
  to non-password authentication, and strict mode enabled. Root, `.ssh`, and
  `authorized_keys` permissions are 0700, 0700, and 0600 respectively.
- `wellsim.service`, `caddy.service`, and `wellsim-backup.timer` are active and
  enabled. The timer targets 02:30 UTC. Same-disk daily archives exist in
  `/var/backups/wellsim`, and application rolling copies exist under
  `data-backups/`.
- The live `users.json` parsed successfully and the case store is non-empty.
  Contents were not printed.
- Fresh archive `wellsim-manual-20260902T001242Z.tar.gz` was copied off the VPS.
  Its plaintext SHA-256 was
  `e8df497408943d104b106e9c99fa0b18ef8a6726bcc89d7dfd940201d54c7ab8`.
  A scratch restore validated safe paths, 50 archive entries, JSON parsing and
  case-file presence.
- The off-box copy was converted to an authenticated AES-256-GCM archive. Its
  SHA-256 is `d27c04ed235b0a670ee5771485be78712d8c0362234cc9acd71802a908dcd234`;
  decryption reproduced the plaintext checksum exactly. The recovery key is in
  the excluded, access-restricted workstation secrets area and was not printed.
  Plaintext scratch material was removed after verification.
- A separate source/configuration rollback archive excludes application state.
  Its SHA-256 is
  `6b9fd8f93cae109584ba8f9aca7081ec3efd770e1266ad6b3eed06fc9cb45374`.

## Resolved P0 findings

| Initial finding | Resolution evidence |
|---|---|
| Controlled SSH/recovery access unavailable | New Ed25519 key installed; key-only root SSH and effective daemon controls verified |
| No off-box backup or restore test | Fresh encrypted archive copied off the VPS; authenticated decrypt, checksum, tar and scratch restore passed |
| Legacy Sign-in/server store exposed | Containment release deployed; public status reports the web store disabled and the Sign-in entry is hidden |

## Open risk register

| Priority | Finding | Consequence | Required control |
|---|---|---|---|
| P1 | Provider backups, snapshots and server deletion/rebuild protection are off | Recovery and operator-error resistance are weak | Enable protection and choose a paid provider-backup/snapshot policy after explicit cost authorization |
| P1 | Off-box backup is manual, not scheduled, and its archive/key still need a second durable medium | New changes can outpace the recovery point; workstation loss can remove both components | Automate encrypted off-box transfer and copy the archive and recovery secret to separately protected durable storage |
| P1 | `main` is unprotected and there is no CI | Untested or direct changes can become the release source | Add required test/validation workflow and protected pull-request merges |
| P1 | No staging environment exists | Production is the first realistic deployment target | Create isolated staging with no production data and an explicit staging domain |
| P2 | HSTS, CSP and Permissions Policy were absent | Browser hardening is incomplete | Add and test policies after inventorying current inline scripts and required resources |
| P2 | Node listens on all interfaces at port 3355 | A firewall regression could expose the application origin directly | Bind the application to `127.0.0.1` and retain the UFW deny-by-default policy |
| P2 | Cloudflare proxying is disabled | Origin address is public and Cloudflare edge controls do not protect traffic | Keep intentionally for simple Caddy TLS or proxy deliberately after testing Web/API behavior and origin restrictions |

## Recovery and deployment gate

The following ordered gate was executed on 2 Sep 2026. Steps 1–9 completed
successfully; production did not require rollback. Retain the sequence for
future releases rather than deploying merely because a feature branch is
green.

1. Restore key-only administrative access. Prefer recovering the documented
   passphrase-protected key. If it is lost, use the Hetzner console under a
   separately authorized maintenance window to install a new key. Keep password
   authentication disabled.
2. Verify `wellsim.service`, `caddy.service`, `wellsim-backup.timer`, disk space,
   firewall state and the latest backup timestamps. Read service environment
   names without printing their values.
3. Determine whether `/opt/wellsim/app/data` is empty using counts, sizes and
   checksums; do not print user or case contents.
4. Pull a fresh encrypted archive of `data/` off the VPS. Record its timestamp,
   byte size and SHA-256 checksum outside Git.
5. Restore the archive into a scratch directory, validate archive integrity and
   JSON parseability, and compare file counts/checksums. Do not restore over the
   live directory during the test.
6. Capture a rollback release archive for source/configuration separately from
   `data/`. The source rollback revision is
   `2d60c5e38d8a9ae715840c79240715afc63af7fd`.
7. Deploy commit `6807e738f93119d8459a688ea92894f3831f2d9b` first to staging,
   or to production only if the absence of staging is explicitly accepted. Do
   not set `WELLSIM_ENABLE_LEGACY_CASE_STORE=1`.
8. Verify public calculations, help/assets, hidden Sign-in UI, and
   `GET /api/accounts/status` reporting the disabled web store. Re-run the test
   and physics suites from the deployed revision.
9. Roll back the source artifact if the smoke tests fail. Preserve `data/`; do
   not overwrite it with the scratch restore unless a separate recovery decision
   is made.

## Platform work that may proceed locally

The PostgreSQL schema, organization/membership authorization model, module
contract, CI workflow and staging infrastructure-as-code can be developed and
tested locally without touching production. Persistent user or engineering data
must not be accepted by a new environment until its backup and restore path is
demonstrated.
