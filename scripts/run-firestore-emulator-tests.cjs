const { spawnSync } = require('child_process');

for (const testFile of ['qa-firestore-emulator.cjs', 'qa-pro-lifetime-rules-hotfix.cjs']) {
  const result = spawnSync(process.execPath, [testFile], {
    env: process.env,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
