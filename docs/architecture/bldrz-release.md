# Comparison release: bldrz.net only

## Shared repository boundary

The full handoff for both devices is
[Two-device workflow](two-device-workflow.md). The agreed mapping is:

| Development line | Branch | Deployment target |
| --- | --- | --- |
| Other Windows device/developer | `main` | `wellsim.app`, `/opt/wellsim/app`, `wellsim.service` |
| This comparison task | `codex/v2-foundation` | `bldrz.net`, `/opt/bldrz/app`, `bldrz.service` |

Keep this comparison line on `codex/v2-foundation`. The other developer's
subsequent `main` work is not automatically merged into it. Fetch before each
push, inspect remote movement, and use a normal fast-forward push: no force
push, branch reset or automatic merge. A separate repository is not required.
Coordinate branch ownership and use reviewed PRs/cherry-picks for features
chosen for the eventual combined version. Branch separation is not a security
boundary against administrators who have access to both deployments.
In particular, the other-device SSH key currently grants root access to the
whole shared server. Separate app runtime users already exist, but per-app SSH
deployment-account restrictions and branch-enforced deployments are not yet
configured. The owner will forward the handoff; it has not been independently
communicated to or acknowledged by the other device/developer.

The release target is exclusively `bldrz.net`, `/opt/bldrz`, `bldrz.service`
and database `bldrz`. Never use the old WellSim deploy script or restart
`wellsim.service` for this comparison. No DNS change is required. PostgreSQL
stays at `127.0.0.1:5432`. No cluster-role, PostgreSQL or Caddy restart is needed.
Keep secrets, user data, backups and generated dependencies out of Git.

## Qualification and rollout

1. Confirm a clean worktree and fetch the remote. Run all 325 tests and the
   43-check engineering sweep. Inspect the exact branch/commit to be released.
2. Take a fresh encrypted bldrz-only backup, copy it off-server and verify all
   checksums and local decryption. Keep the recovery identity off the VPS.
3. Use a checksum-verified `git archive` of the candidate in a separate staging
   directory and `npm ci --omit=dev --ignore-scripts --no-audit --no-fund`.
4. Before upgrading the original 0001–0003 database, run native onboarding
   qualification and the socket-only restore drill with `qualify-onboarding`.
   The renderer emits a single transaction guarded by exact database name,
   exact prior migration history, lock timeout and statement timeout. It adds
   0004+0005 under `bldrz_migration_owner`; it never alters cluster roles.
5. Push the exact release commit to the comparison branch without force.
   Preserve the previous app directory, service unit and deployed marker.
   Prepare a root-owned versioned release with fresh locked dependencies.
6. Stop only bldrz, apply the guarded migration transaction to bldrz, and run
   `db/ops/verify-bldrz-catalog.sql`. Preserve its data/data-backups directories.
   Switch `/opt/bldrz/app` to the qualified release and install the bldrz unit.
   Keep `WELLSIM_AUTH_ENABLED=0`, `WELLSIM_ONBOARDING_ENABLED=0` and the legacy
   store off. Start only bldrz; write the exact deployed revision and gates.
7. Check startup role/pool validation, public HTTPS/static assets, engineering
   API, legacy-disabled status and 404s on auth/private APIs. Verify the updated
   browser UI, PostgreSQL loopback binding, zero synthetic live records and
   unchanged WellSim PID/source. Take and copy an encrypted post-release backup.

The initial upgrade is additive with respect to the gated web process. If
web startup fails while sign-in remains off, restore the prior app path/unit
and start only bldrz. Do not automatically downgrade or restore over the
database. Retain the completed schema, verify catalog/role integrity, and
diagnose before retrying. Once customer writes are enabled, rollback and
schema compatibility require a separate reviewed plan.

## What deployment does not enable

The last deployed release is `d5187b4` with schema 0001–0005. The local
administrator-MFA candidate is not deployed. Its 0005 → 0006 qualification and
activation procedure is in [Auth0 administrator MFA](auth0-administrator-mfa.md);
do not rerun the original 0003 → 0005 procedure on the current database.

The release includes company/private-workspace UI and the secure backend, but
deploying them does not authorize a public identity service or signup. Choose
a dedicated OIDC provider/client, verified email policy, owner/admin MFA,
callback log redaction, throttling and a two-company browser pilot first.
Scheduled independent backups, agreed retention, failure/staleness alerts and
a second durable recovery-key copy also remain gates for customer persistence.

Next product work is one complete well → case → calculate → immutable revision
→ reopen → export workflow. Then expand module/data-specific exports and run
representative 50/100/200-user capacity tests. Existing security tests are not
proof of throughput, high availability or the safety of future modules.
