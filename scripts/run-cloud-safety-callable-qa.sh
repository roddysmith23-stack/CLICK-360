#!/usr/bin/env sh
set -eu
for java_dir in /opt/homebrew/opt/openjdk@21/bin /usr/local/opt/openjdk@21/bin; do
  if [ -x "$java_dir/java" ]; then PATH="$java_dir:$PATH"; export PATH; break; fi
done
node scripts/build-cloud-safety-functions.mjs
npm run build:static
GOOGLE_APPLICATION_CREDENTIALS="$PWD/qa/fixtures/synthetic-emulator-adc.json"
export GOOGLE_APPLICATION_CREDENTIALS
./node_modules/.bin/firebase emulators:exec --config firebase.safety-emulator.json --only auth,firestore,functions --project demo-click360-safety "node qa/cloud-safety-callable-emulator.mjs && node qa/cloud-safety-auto-backup-e2e.mjs"
