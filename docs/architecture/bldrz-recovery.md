# bldrz PostgreSQL recovery

## Status — 2 September 2026

Manual encrypted off-server backup and an isolated native PostgreSQL 16 restore
drill passed. **Scheduled off-server transfer, retention enforcement, failure
alerts and a second durable copy of the recovery key remain unconfigured.**
Do not enable customer persistence or claim disaster recovery is complete.
The next decision is an always-available backup destination. No storage service
has been purchased or provisioned. Authentication and the end-to-end case
workflow remain subsequent steps, followed by measured 50/100/200-user tests.

The original recovery tools were qualified separately from web revision
`9c35c04`. The comparison release now includes these tools plus schema-0005
recovery qualification; use `/opt/bldrz/DEPLOYED_REVISION` for active revision
tracking. `wellsim.app` and its existing backup timer are outside this workflow.

### Onboarding-schema release qualification

Fresh pre-deployment bundle `bldrz-20260902T163434.994067160Z` was copied to
the restricted workstation backup folder. All four checksums and both age
decryptions passed. Its recovered full-data fingerprint matched the source:
`51ff76c2aed12f7bdd7e98e8ab2c1af8e2bb0b83410920c668777e7f358a297f`.

Candidate `9c4964b` passed a native PostgreSQL 16.15 restore drill. The source
copy remained at 0001–0003; migrations 0004+0005 were applied together only to
its empty synthetic clone. Nonempty identities, sessions, login flows,
personal workspaces, invitations and authentication events were added before
an encrypted dump/restore round trip. All app-table fingerprints matched.
Both-direction company isolation, identity-table access denial, workspace
discovery, management boundaries, last-owner protection, email-bound single-use
invitations, single-use login flows and session revocation passed after restore.
The catalog now strictly recognizes either the original three-migration
history or the complete five-migration history, not unknown/partial versions.
Schema 0005 requires 25 RLS-bearing tables, 54 policies, eight restricted
identity/onboarding functions and revoked direct membership writes.

Use the optional third argument `qualify-onboarding` with the restore runner
only for a 0001–0003 source dump when qualifying the upgrade before deployment.
Omit it for a dump already at 0005. Synthetic fixtures and the private socket-
only cluster are always isolated from the live database.

## What the backup contains

`deploy/backup-bldrz-db.sh` is root-only, takes a consistent `pg_dump` custom
archive of **bldrz only**, and streams it directly into age encryption. A
second encrypted archive contains the bldrz database credential, bldrz unit,
public backup recipient and deployed revision. No plaintext dump is written
by the source backup job. Cluster-wide roles, other applications' credentials
and other databases are excluded.

Each timestamped bundle contains:

- `database.dump.age`: schema, full data, ownership, functions, RLS and grants;
- `recovery-config.tar.age`: bldrz-only runtime recovery material;
- `roles.sql`: password-free bootstrap for the three bldrz roles on a fresh
  cluster; it refuses to alter existing roles;
- `manifest.txt`: environment/version/coverage metadata; and
- `SHA256SUMS`: transfer-integrity checks for those four files.

Private spool directories are root-only. `flock` prevents overlapping jobs;
partial output is not published, and failure cleans only its own temporary
directory. A catalog preflight rejects unexpected privilege or migration
drift. Update that assertion deliberately when adding migrations.

This is a logical database backup, **not point-in-time recovery**. It does not
cover future photos, uploaded Excel files, rendered PDFs or other object
blobs. Before enabling those features, choose object storage and add
versioning/backup plus a coordinated database/object restore test. Database
metadata alone cannot recover the underlying files.

## Encryption and key custody

age v1.3.2 portable binaries were obtained from its official GitHub release
and checked against release asset SHA-256 digests:

| Platform | SHA-256 |
|---|---|
| Linux amd64 | `cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10` |
| Windows amd64 | `f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7` |

The server binary is `/opt/bldrz/tools/age-v1.3.2/age/age` and the workstation
binary is `C:\Claude\WellSim\tools\age-v1.3.2\age\age.exe`. This is portable
tooling, not an application dependency or a system package upgrade.

The private recovery identity is outside the repository at
`C:\Claude\WellSim\secrets\bldrz-recovery\identity.txt`. Windows ACLs permit
only the current owner and SYSTEM. It is never sent to the server, logged or
included with an archive. The server has only
`/etc/bldrz/backup-recipient.txt`. Keep an additional recovery-key copy in a
password manager or separate offline medium before relying on this setup.
The archive and its only key currently share the workstation failure domain.

SHA-256 detects transfer errors; it is not a signature. age detects ciphertext
tampering and requires the recovery identity for decryption. Restrict storage
credentials, preserve version history/immutability where available, and use
authenticated transfers; public-key encryption alone does not establish who
created an archive.

## Verified evidence

Bundle: `bldrz-20260902T143848.882634680Z`.

- Server: `/var/backups/bldrz/postgresql/`.
- Off-server: `C:\Claude\WellSim\backups\bldrz\` (restricted owner/SYSTEM ACL).
- All four transferred checksums matched; both encrypted archives decrypted
  locally, and recovery config member names were checked without printing
  credentials.
- The actual dump restored into a fresh, private PostgreSQL 16 cluster with
  **no TCP listener**. The existing database/cluster was never restored over.
- The three least-privilege roles were recreated without copied password
  hashes. Database/object ownership, schema/table ACLs, immutable columns,
  migration records, 22 RLS-bearing tables and all 54 policies passed checks.
- A second, synthetic two-company database was encrypted and restored with
  an unrelated disposable test key. Sorted content hashes of **every app
  table** matched before/after restoration. This covers nonempty cases,
  memberships, wells and export scopes, not just an empty schema.
- Restored application-role tests denied cross-company reads, updates, well
  links and export references in both directions. Direct login access,
  migration-owner escalation, missing context and mismatched membership were
  denied; a permitted own-company write succeeded and rolled back.
- `scripts/check-backup-encryption.mjs` confirmed wrong-key and altered-
  ciphertext decryption fail.
- Disposable clusters, test keys and server-side plaintext drill input were
  removed after verification. Encrypted backups and the real off-server key
  are retained. The workstation's two plaintext drill files remain under
  `C:\Claude\WellSim\backups\bldrz\restore-drill-20260902\` because the local
  execution policy blocked cleanup: `database.dump` and `recovery-config.tar`.
  They inherit the owner/SYSTEM-only ACL. Remove these two specific files
  after inspection; preserve the encrypted bundle and recovery identity.

## Repeat a manual backup and drill

Use the active qualified comparison release (the original operations copy
only recognizes 0001–0003 and must not back up the upgraded schema):

```bash
sudo bash /opt/bldrz/app/deploy/backup-bldrz-db.sh /opt/bldrz/app
```

Copy the resulting whole bundle over verified SSH/SFTP to the approved
off-server destination. Verify every `SHA256SUMS` entry. Decrypt the database
**on the recovery workstation** using age with `--decrypt -i <identity>
-o <new-private-dump-path> <database.dump.age>`. Refuse existing output paths;
age otherwise overwrites them. Do not put the real recovery key on the VPS.

Transfer only the decrypted dump into a root-only temporary input directory
on the recovery host. Then run:

```bash
sudo bash /opt/bldrz/app/deploy/verify-bldrz-restore.sh \
  /opt/bldrz/app /absolute/private/path/database.dump
```

The runner creates and removes its own `bldrz-restore-drill.*` cluster. It uses
private Unix sockets on logical port 55432, not a network listener. Trust
authentication is restricted by a mode-0700 directory to postgres/root and is
used only for this disposable cluster. Live PostgreSQL authentication is not
changed. Delete the explicitly named plaintext input after the drill; the
runner intentionally does not delete a caller-supplied input file.

For a real recovery onto a new host, preserve the failed environment first,
review the dump's provenance, bootstrap the scoped roles, create a fresh
database owned by `bldrz_migration_owner`, revoke PUBLIC database/schema
privileges and grant only CONNECT to `bldrz_app`. Restore with `pg_restore
--single-transaction --exit-on-error` without `--no-owner`, `--no-acl`,
`--clean` or `--create`. Restore/rotate the application credential via a
private administrative channel, reapply loopback-only SCRAM configuration,
then run catalog, login/pool and tenant-isolation tests before switching the
application. The drill deliberately does not restore credentials or switch
live services automatically.

## Remaining automation gate

`deploy/bldrz-db-backup.service` and `.timer` are templates only; neither is
installed/enabled. The proposed schedule is daily at 03:15 UTC with jitter,
separate from WellSim's 02:30 timer. Before activation:

1. Select an always-available off-server destination and approve any cost.
2. Use a dedicated restricted backup credential, not a broad infrastructure
   administration token. Configure upload plus remote checksum verification.
3. Enforce an agreed retention policy (initial proposal: 30 daily recovery
   points), with no pruning based on an unverified upload. No archives are
   currently pruned.
4. Configure failed-job and stale-backup alerts through an approved channel.
5. Store a second durable recovery-key copy separately from backups.
6. Retrieve a backup from the chosen destination and repeat this restore test.

A daily schedule would have an up-to-24-hour data-loss window when healthy.
Restore time and a supported recovery objective must be measured again with
representative data volume; this small foundation drill is not that benchmark.

## Primary references

- [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)
  documents consistent logical backups and the separation of global roles.
- [PostgreSQL 16 pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)
  documents owner/ACL restoration and transactional error handling.
- [age usage](https://github.com/FiloSottile/age#readme) and
  [v1.3.2 release](https://github.com/FiloSottile/age/releases/tag/v1.3.2)
  describe the encryption tool and its official distribution.
