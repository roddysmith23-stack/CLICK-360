#!/usr/bin/env sh
set -euo pipefail

if [ ! -d functions/node_modules ]; then
  echo "Run npm ci --prefix functions before P2 Cloud multiuser emulator QA." >&2
  exit 1
fi

if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  for java_bin in /opt/homebrew/opt/openjdk@21/bin/java /usr/local/opt/openjdk@21/bin/java; do
    if [ -x "$java_bin" ]; then
      export PATH="$(dirname "$java_bin"):$PATH"
      break
    fi
  done
fi

if ! command -v java >/dev/null 2>&1 || ! java -version >/dev/null 2>&1; then
  echo "Java is required for emulator QA." >&2
  exit 1
fi

isolated_home="$(mktemp -d)"
trap 'rm -rf "$isolated_home"' EXIT
export HOME="$isolated_home"
export CLOUDSDK_CONFIG="$isolated_home/gcloud"
unset GOOGLE_APPLICATION_CREDENTIALS
unset CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE
unset GOOGLE_CLOUD_QUOTA_PROJECT

./node_modules/.bin/firebase emulators:exec --only auth,firestore,functions --config firebase.p2-emulator.json --project demo-click360-p2-staging "npm run qa:cloud:multiuser --prefix functions"
