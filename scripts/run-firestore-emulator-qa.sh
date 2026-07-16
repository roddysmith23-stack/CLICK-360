#!/usr/bin/env sh
set -eu

has_java() {
  command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1
}

if ! has_java; then
  for java_bin in /opt/homebrew/opt/openjdk@21/bin/java /usr/local/opt/openjdk@21/bin/java; do
    if [ -x "$java_bin" ]; then
      export PATH="$(dirname "$java_bin"):$PATH"
      break
    fi
  done
fi

if ! has_java; then
  echo "Java 21 or newer is required to run the Firestore emulator QA." >&2
  exit 1
fi

rm -f firestore-debug.log
./node_modules/.bin/firebase emulators:exec --only firestore --project demo-click360-p0-rules "node scripts/run-firestore-emulator-tests.cjs"

if [ ! -f firestore-debug.log ]; then
  echo "Firestore emulator did not produce firestore-debug.log; expression-limit verification is incomplete." >&2
  exit 1
fi

if grep -q "maximum of 1000 expressions" firestore-debug.log; then
  echo "Firestore rules exceeded the 1000-expression evaluation limit." >&2
  exit 1
fi
