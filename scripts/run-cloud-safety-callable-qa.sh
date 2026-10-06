#!/usr/bin/env sh
set -eu
node qa/cloud-safety-lifecycle-check.mjs before
for java_dir in /opt/homebrew/opt/openjdk@21/bin /usr/local/opt/openjdk@21/bin; do
  if [ -x "$java_dir/java" ]; then PATH="$java_dir:$PATH"; export PATH; break; fi
done
node scripts/build-cloud-safety-functions.mjs
npm run build:static
node scripts/validate-cloud-safety-staging.mjs
GOOGLE_APPLICATION_CREDENTIALS="$PWD/qa/fixtures/synthetic-emulator-adc.json"
export GOOGLE_APPLICATION_CREDENTIALS
safety_result=0
./node_modules/.bin/firebase emulators:exec --config firebase.safety-emulator.json --only auth,firestore,functions --project demo-click360-safety "node qa/cloud-safety-callable-emulator.mjs && node qa/cloud-safety-auto-backup-e2e.mjs" || safety_result=$?
node qa/cloud-safety-lifecycle-check.mjs after
exit "$safety_result"
