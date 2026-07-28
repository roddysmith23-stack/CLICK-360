#!/usr/bin/env bash
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ORIGINAL_HOME=${HOME:-"/tmp"}
export CODEX_HOME=${CODEX_HOME:-"$ORIGINAL_HOME/.codex"}
export PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-"$ORIGINAL_HOME/Library/Caches/ms-playwright"}

if [ ! -d "$ROOT/functions/node_modules" ]; then echo "Run npm ci --prefix functions before browser emulator QA." >&2; exit 1; fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  for java_bin in /opt/homebrew/opt/openjdk@21/bin/java /usr/local/opt/openjdk@21/bin/java; do [ -x "$java_bin" ] && export PATH="$(dirname "$java_bin"):$PATH" && break; done
fi
if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then echo "Java is required for emulator QA." >&2; exit 1; fi

isolated_home="$(mktemp -d)"
trap 'rm -rf "$isolated_home"' EXIT
export HOME="$isolated_home"
export CLOUDSDK_CONFIG="$isolated_home/gcloud"
unset GOOGLE_APPLICATION_CREDENTIALS
unset CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE
unset GOOGLE_CLOUD_QUOTA_PROJECT

cd "$ROOT"
./node_modules/.bin/firebase emulators:exec --only auth,firestore,functions --config firebase.p2-emulator.json --project demo-click360-p2-staging "bash qa/run-p2-cloud-multiuser-browser-inner.sh"
