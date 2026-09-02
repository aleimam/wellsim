#!/usr/bin/env bash
# Compatibility entry point: current identity code requires migration 0006.
# The combined probe qualifies authentication, onboarding and MFA together.
set -euo pipefail
APP_DIR=$(realpath -e "${1:?qualified source directory required}")
exec bash "$APP_DIR/deploy/verify-bldrz-onboarding.sh" "$APP_DIR"
