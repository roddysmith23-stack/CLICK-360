#!/bin/sh
set -eu

if [ ! -x ./node_modules/.bin/firebase ]; then
  echo "firebase-tools is required. Run npm ci first." >&2
  exit 1
fi

if [ -x /usr/local/opt/openjdk@21/bin/java ]; then
  PATH="/usr/local/opt/openjdk@21/bin:$PATH"
elif [ -x /opt/homebrew/opt/openjdk@21/bin/java ]; then
  PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"
fi
export PATH

./node_modules/.bin/firebase emulators:exec \
  --only firestore,auth \
  --project demo-click360-v17-mirror \
  "node qa-v17-shary-admin-emulator.mjs"
