# WellSim infrastructure audit — 2026-09-02

Status: read-only audit completed; production mutation not authorized or
performed.

## Decision

The v2 foundation branch is safe to review, but production is not ready for a
data-bearing deployment. Controlled server access, an off-box backup, and a
demonstrated scratch restore are deployment gates. The current legacy account
and server case-store UI remains visible in production, so the containment
commit should be deployed promptly after those gates are met or after an
authorized operator independently confirms that the store is empty and accepts
the rollback risk.

No credential value was copied into the repository or audit output.

## Evidence captured

### Source and release controls

- GitHub repository: public `aleimam/wellsim`; default branch `main`.
- Production baseline in Git: `2d60c5e38d8a9ae715840c79240715afc63af7fd`.
- Containment and architecture branch: `codex/v2-foundation`, commit
  `27ea04eb419f883dd91c4b6d7dcfdde24177e4fe`.
- `main` has no branch protection.
- The repository has no GitHub Actions workflows, deployment environments,
  recorded GitHub deployments or webhooks.
- GitHub secret scanning and push protection are enabled. Dependabot security
  updates are disabled.
- The branch passed 246/246 Node tests, the 43/43 physics validation sweep,
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
- TCP/80 and TCP/443 were reachable. The application port 3355 was not exposed,
  which is correct. TCP/22 was closed or filtered from the audit network.
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

- The public home page still contains the Sign-in entry point.
- `GET /api/accounts/status` returns 404.
- The new asset stamp `2026-09-02a` is absent.

These three independent markers show that containment commit `27ea04e` is not
deployed. The audit did not register an account, save a case or make any other
application-data mutation.

### Access and backup state

- The expected private key `%USERPROFILE%/.ssh/wellsim_hetzner` is absent on
  the audit workstation.
- The documented backup-key folder
  `F:/WellSim-Backup-2026-08-29/ssh-key/` is unavailable because `F:` is not
  mounted on the workstation.
- No SSH agent identity is loaded, and no known-host entry for the server is
  present.
- The password credential was not tried: the runbook says server password
  authentication is disabled, and weakening that control is outside a
  read-only audit.
- `docs/deploy.md` records a same-disk `wellsim-backup.timer` installed on
  1 Sep. It could not be verified through SSH in this audit.
- No current off-box application-data archive, provider backup, snapshot or
  successful restore test was demonstrated.

## Risk register

| Priority | Finding | Consequence | Required control |
|---|---|---|---|
| P0 | Controlled SSH/recovery access is not available from the current workstation | Operators cannot verify backup state, deploy safely or roll back through the documented path | Recover the protected key or use the Hetzner console to install a new key; verify the TCP/22 policy without enabling passwords |
| P0 | No off-box backup or restore test is evidenced | A server/disk loss can remove all users and cases | Create an encrypted off-box archive, checksum it, restore to scratch, and record the result |
| P0 | Legacy Sign-in/server store remains exposed | Registrants can claim a company slug without authoritative membership | Deploy containment commit `27ea04e` after backup/access gates; do not enable the compatibility switch publicly |
| P1 | Provider backups, snapshots and server deletion/rebuild protection are off | Recovery and operator-error resistance are weak | Enable protection and choose a paid provider-backup/snapshot policy after explicit cost authorization |
| P1 | `main` is unprotected and there is no CI | Untested or direct changes can become the release source | Add required test/validation workflow and protected pull-request merges |
| P1 | No staging environment exists | Production is the first realistic deployment target | Create isolated staging with no production data and an explicit staging domain |
| P2 | HSTS, CSP and Permissions Policy were absent | Browser hardening is incomplete | Add and test policies after inventorying current inline scripts and required resources |
| P2 | Cloudflare proxying is disabled | Origin address is public and Cloudflare edge controls do not protect traffic | Keep intentionally for simple Caddy TLS or proxy deliberately after testing Web/API behavior and origin restrictions |

## Recovery and deployment gate

Perform the following in order; do not merge or deploy merely because the
feature branch is green.

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
7. Deploy commit `27ea04eb419f883dd91c4b6d7dcfdde24177e4fe` first to
   staging, or to production only if the absence of staging is explicitly
   accepted. Do not set `WELLSIM_ENABLE_LEGACY_CASE_STORE=1`.
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
