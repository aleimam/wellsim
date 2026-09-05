# READ FIRST: two-device development and deployment agreement

Updated: 3 September 2026. This records the owner's agreed workflow; it does not
create automatic deployments, enforce permissions, or authorize a deployment by
itself. The owner will send this document to the other device/developer. No
direct communication with that device or acknowledgement from it has occurred.

**For the receiving Windows device/developer/agent: your assignment is the
`main` development line and wellsim.app.** The original device/agent that
prepared this handoff owns the separate bldrz comparison work.

## One repository, two independent development lines

Repository: https://github.com/aleimam/wellsim

| Responsibility | Receiving Windows device / other developer | Original device / bldrz comparison agent |
| --- | --- | --- |
| Integration/release branch | `main` | `codex/v2-foundation` |
| Website | `https://wellsim.app` | `https://bldrz.net` |
| Server app directory | `/opt/wellsim/app` | `/opt/bldrz/app` |
| Application service | `wellsim.service` | `bldrz.service` |
| Application runtime user | `wellsim` | `bldrz` |
| Data boundary | Existing WellSim data/configuration only | Separate `bldrz` database, data and configuration only |

Both websites currently share the Hetzner server at `91.98.23.255`. Separate
folders and service names were checked on the server. The branch-to-site mapping
above is the intended release contract, not a claim that CI/CD enforces it or
that the live WellSim checkout's branch/revision has been independently verified.

The other device works on the main development line and publishes only to
**wellsim.app**. The original bldrz comparison agent works on
**codex/v2-foundation** and publishes only to **bldrz.net**. Neither party should
deploy its branch to the other website.
A separate GitHub repository is not required for this comparison.

## Rules for both developers and their coding agents

1. Use a separate local clone or worktree for each development line. Before
   editing or deploying, inspect `git remote -v`, `git branch --show-current`,
   `git status --short`, and the exact commit being released. Stop if the
   repository, branch or target does not match your assigned column above.
2. Fetch and review remote changes before pushing. Preserve the other person's
   changes. Do not force-push, reset their branch, overwrite an existing checkout,
   or automatically merge the two development lines. Feature branches and PRs
   are fine, but their release destination must stay in the assigned column.
3. Inspect every deployment script before using it. A script's filename or the
   fact that it is in this shared repository does not prove it targets the right
   website. Confirm its source commit, destination paths, service, database,
   environment files, backup/restore targets and health-check hostname.
4. Back up and qualify the intended application's changes before deploying.
   Restart only that application's service. Do not delete, replace or restart
   the other app, change its symlink, run its migrations, or alter its secrets,
   backups, users, data, login configuration or DNS.
5. Do not copy production data or credentials between the two applications.
   Keep private SSH keys, passphrases, API tokens, database credentials, user
   data and backups out of Git and frontend assets. A shared source repository
   is not a shared database or shared identity configuration.
6. Coordinate with the owner before any shared-host change: operating-system
   upgrade/reboot, firewall/SSH changes, Caddy/reverse-proxy or certificate
   changes, PostgreSQL service/cluster settings, or host-wide resource/load
   tests. Such actions can affect both sites even from one application's folder.
7. After a deployment, check the intended site's health and verify the other
   service has not been unintentionally changed. Report the exact branch,
   commit, target site, migrations, test results and rollback information.

## SSH access: capability is broader than the agreed work scope

The new other-device SSH key signs in as **root** on the shared server. It can
technically change **both** applications and the entire host. It is not limited
to `main`, wellsim.app, or `/opt/wellsim`. The app processes already run under
separate runtime users, but restricted per-app SSH deployment accounts have
**not** been set up. The existing administrative key is also still valid.

Treat the branch/site restrictions as an operational agreement, not an enforced
security boundary. Recommended follow-up: separately approved non-root
deployment accounts with narrow file/service permissions, and branch-specific
deployment controls. Do not remove the working administrative access until its
replacement has been tested and the owner approves the change.

Use the Windows SSH instructions supplied with this document. The encrypted
private key and its passphrase must be handled separately and kept private.
Possession of root credentials does not authorize work outside the assigned app.

## Selecting features after comparison

Keep both versions independent until the owner chooses features or a final
version. Port selected changes with reviewed pull requests or cherry-picks.
Review dependencies, configuration, security policy and database migrations as
part of each transfer; do not blindly merge a whole branch or copy a live
database. A successful test on one website is not evidence that deployment to
the other is compatible or authorized.

## Current bldrz context — snapshot, not a rollout instruction

The last verified bldrz release is `e396487`, deployed 5 September 2026 with
database migrations 0001–0007 and public authentication/onboarding/portals
disabled. Administrator-MFA and portal storage are installed and qualified;
Auth0 configuration, browser acceptance testing and activation gates remain
unfinished. See the [release receipt](portal-activation-2026-09-05.md).
Do not activate or deploy that work from the other device as part of WellSim
development. Refresh the current state before making any future release decision.

## Acknowledgement requested from the receiving developer/agent

Before making changes, confirm to the owner:

> I will work on the `main` development line of `aleimam/wellsim` and publish
> only to `wellsim.app`, using `/opt/wellsim/app` and `wellsim.service`. I will
> not modify `codex/v2-foundation`, bldrz.net, `/opt/bldrz`, `bldrz.service`, or
> the bldrz database/configuration. I understand the SSH key is unrestricted
> root access, so shared-host changes require coordination with the owner.
