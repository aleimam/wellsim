#!/usr/bin/env bash
# Render the exact 0005 -> 0007 upgrade as ONE guarded transaction.
set -euo pipefail
APP_DIR=${1:?qualified source directory required}
test -f "$APP_DIR/db/migrations/0006_administrator_mfa.sql"
test -f "$APP_DIR/db/migrations/0007_portals_help_and_join_requests.sql"
# Keep the MFA BEGIN and the portal COMMIT. Both baseline guards still run;
# a failure in either migration rolls back the entire upgrade.
bash "$APP_DIR/deploy/render-bldrz-mfa.sh" "$APP_DIR" | sed '/^COMMIT;$/d'
bash "$APP_DIR/deploy/render-bldrz-portals.sh" "$APP_DIR" | sed '/^BEGIN;$/d'
