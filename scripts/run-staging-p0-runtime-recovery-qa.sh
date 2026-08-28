#!/bin/sh
set -eu

if [ -z "${CLICK360_QA_STAGING_EMAIL:-}" ] || [ -z "${CLICK360_QA_STAGING_PASSWORD:-}" ]; then
  echo "Missing CLICK360_QA_STAGING_EMAIL or CLICK360_QA_STAGING_PASSWORD" >&2
  exit 1
fi

reset_fixture() {
  node scripts/qa-staging-seed-shary-scale.mjs --confirm-click360-staging-fixture-reset
}

trap reset_fixture EXIT INT TERM
reset_fixture
node scripts/qa-staging-auth-fallback-load-failure-e2e.mjs 5
node scripts/qa-staging-critical-action-gate-load-failure-e2e.mjs 5
node scripts/qa-staging-authenticated-smoke.mjs
