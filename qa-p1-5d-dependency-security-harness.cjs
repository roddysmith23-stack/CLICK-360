const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'p0-qa.yml'), 'utf8');
const build = fs.readFileSync(path.join(root, 'scripts', 'build-static-release.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const deployedSources = [
  'index.html', 'app.js', 'firebase-service.js', 'access-flow.js', 'runtime-guard.js',
  'p0-tenant-guard.js', 'v16-domain.js', 'v16-storage.js', 'printing-service.js',
  'smart-print-core.js', 'service-worker.js', 'manifest.webmanifest'
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const administrativeScripts = [
  'scripts/admin-access-v16.mjs',
  'scripts/audit-firestore-legacy.mjs',
  'scripts/migrate-legacy-v9-to-v10.mjs',
  'scripts/normalize-approved-owner-access.mjs'
];

assert.equal(Object.hasOwn(packageJson.dependencies, 'firebase-admin'), true, 'firebase-admin remains explicitly tracked until a compatible remediation exists');
assert.equal(build.includes("'node_modules'"), false, 'static release allowlist never copies node_modules');
assert.equal(/firebase-admin|@google-cloud\/firestore|google-gax/.test(deployedSources), false, 'deployed browser modules do not import administrative SDK packages');
assert.equal(administrativeScripts.every((file) => fs.readFileSync(path.join(root, file), 'utf8').includes('firebase-admin')), true, 'administrative SDK usage is limited to the reviewed scripts');
assert.match(workflow, /^  v16-qa:/m, 'PWA and Rules QA job remains independently visible');
assert.match(workflow, /^  admin-fixture-qa:/m, 'administrative fixture QA runs without production credentials');
assert.match(workflow, /^  security-audit:/m, 'security audit is independently visible');
assert.match(workflow, /npm audit --omit=dev --audit-level=moderate/, 'security audit remains a blocking command');
assert.equal(workflow.includes('continue-on-error'), false, 'CI cannot make a security failure green artificially');
assert.match(workflow, /npm run qa:admin:fixtures/, 'administrative scripts run only with fixtures in CI');

console.log('PASS P1.5D dependency security harness: runtime boundary, fixture-only admin QA, independent blocking audit policy.');
