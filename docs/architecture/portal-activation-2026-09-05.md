# bldrz portal preparation — 5 September 2026

## Completed release

- Branch: `codex/v2-foundation`.
- Deployed commit: `e396487e60b0688d79253ce9d903c03b635e8b06`.
- Source archive SHA-256: `250efd87a16b0df7c8a893f690270a9a061157de533c59f10b52b8d756252f69`.
- Destination: `bldrz.net`, `/opt/bldrz/app`, `bldrz.service`, database `bldrz`.
- Service startup: 2026-09-05 13:00:54 UTC, PID 6424 at verification.
- Database upgraded atomically from 0001–0005 to 0001–0007.
- Authentication, onboarding, portals and the legacy case store remain disabled.
- Live user and engineering-case counts remained zero. No synthetic identity
  or portal data was inserted into the live database.

The initial native portal run reproduced an authorization race: a join request
queued behind a company lock could commit after its session had been revoked.
Before migration 0007 was first applied live, the code was corrected to recheck
and lock the session after resource locks. Help edits/publishing also recheck
platform authority and fresh MFA after advisory and page-row locks. The app's
scientific calculation code and public UI were not changed.

## Qualification

- 325/325 automated checks and 43/43 engineering validation checks passed.
- 14 native onboarding/MFA groups passed using two restricted PostgreSQL pools.
- Nine native portal groups passed, including observed lock waits for concurrent
  approvals, cancellation, logout, help edits and MFA expiry.
- The exact committed archive passed native portal qualification and an
  encrypted recovery round trip on a new socket-only PostgreSQL cluster.
- All app-table fingerprints matched after synthetic restoration, including
  pending join requests, platform administrators, help revisions and audit data.
- Post-restore company isolation, identity, MFA, join approval and published/draft
  boundaries passed. These do not substitute for a real Auth0 browser pilot.
- The post-release 0007 backup also passed a fresh-cluster `restored-schema`
  drill, including exact source-data equality and the same restored security
  boundaries (`BLDRZ_RESTORE_DRILL_OK`).

Native probes and restore clusters are disposable and removed by their runners.
`verify-bldrz-portals.sh` intentionally accepts only the pre-upgrade 0005 live
baseline; do not rerun it against the new 0007 live baseline without updating
the qualification procedure. Current backup restore tests use `restored-schema`.

## Recovery material

Fresh pre-release encrypted bundle:
`bldrz-20260905T125420.852058017Z`.

Fresh post-release encrypted bundle:
`bldrz-20260905T130127.728873653Z`.

Both are retained under `/var/backups/bldrz/postgresql/` and copied to the
restricted off-server `C:\Claude\WellSim\backups\bldrz\` directory.
The four checksums in each bundle were verified. The recovery identity stays
off-server; confidential contents are never committed or printed.
After successful qualification, the four temporary local plaintext dump/config
files and two staged server dump files created for these drills were removed.
Both encrypted bundles remain available for recovery.

Previous app target:
`/opt/bldrz/releases/85befc18ef87f3cd18398eaf83fca866dc5ac77b`.
App/unit/marker rollback record:
`/opt/bldrz/rollbacks/portal-20260905-e396487`.
The prior release and both `data` directories were preserved. App rollback
must keep identity flags disabled and retain the upgraded schema; do not
automatically downgrade or restore over the live database.

## Live verification and boundaries

The PostgreSQL startup check reported ready. Public help and the public API
responded successfully. Legacy account/registration status stayed false;
`/auth/session`, `/api/v2/portal/context` and `/api/help/catalog` returned 404.
Only bldrz was restarted. WellSim's PID and the hashes of its server source and
service unit matched immediately before/after this release. No Caddy, SSH,
firewall, shared database roles, PostgreSQL service or DNS change was made.

## Next activation work

1. Sign into the dedicated Auth0 tenant and verify/attach the deployed bldrz
   Post Login Action. The dashboard is currently signed out.
2. Save the bldrz confidential Client Secret in the restricted local file
   `C:\Claude\WellSim\secrets\auth0\bldrz-client-secret.txt`, then install the
   bldrz-only OIDC environment. Neither file existed at the last check.
3. Confirm the provider's password/MFA entitlement and policy. Complete the
   real account's verified email, authenticator enrollment and recovery handling.
4. Qualify actual callbacks and a controlled two-company browser pilot; provision
   the chosen initial platform administrator after verified login and MFA.
5. Configure independent scheduled backups, retention, alerts and a second
   recovery-key copy before accepting real customer persistence.

The user has resumed the agreed bldrz work. Missing provider credentials and
human enrollment are the remaining dependencies, not an SSH write restriction.
