const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');

const root = __dirname;
const main = 'main...HEAD';
const changedFiles = execFileSync('git', ['diff', '--name-only', main], { cwd:root, encoding:'utf8' })
  .split('\n').filter(Boolean);

const allowed = new Set([
  'app.js', 'firebase-service.js', 'index.html', 'manifest.webmanifest', 'package-lock.json', 'package.json',
  'p2-web-safe-flags.js', 'printing-service.js', 'runtime-guard.js', 'service-worker.js', 'smart-print-core.js', 'styles.css',
  'universal-label-canvas.js', 'universal-label-editor.js', 'scripts/build-static-release.mjs',
  'qa-business-switch-harness.cjs', 'qa-check.cjs', 'qa-p1-1-write-cash-harness.cjs',
  'qa-p1-1b-sync-guard-harness.cjs', 'qa-p1-1c-reliability-sync-recovery-harness.cjs',
  'qa-p1-1d-cash-close-reliability-harness.cjs', 'qa-p1-5a-barcode-scanner-harness.cjs',
  'qa-p1-5a-finance-help-harness.cjs', 'qa-p1-5a-label-printing-harness.cjs',
  'qa-p1-5a-launch-regression-harness.cjs', 'qa-p1-5a-tables-lite-harness.cjs',
  'qa-p1-5b-production-ux-polish-harness.cjs', 'qa-p1-5c-help-diagnostic-harness.cjs',
  'qa-p1-5c-regression-harness.cjs', 'qa-v16-1-2-runtime-harness.cjs',
  'qa-v16-1-commercial-harness.cjs', 'qa-v16-2-regression-harness.mjs', 'qa-v16-contract.cjs',
  'qa-p1-5c-print-profile-harness.cjs', 'qa-p2-universal-label-canvas-harness.cjs', 'qa-p2-web-safe-release-harness.cjs',
  'qa/check-png-nonblank.cjs', 'qa/fixtures/p2-universal-label-canvas.html', 'qa/run-p2-universal-label-browser-e2e.sh',
  'docs/CLICK360_P2_LABEL_CALIBRATION_SMOKE.md', 'docs/CLICK360_P2_UNIVERSAL_LABEL_CANVAS.md',
  'docs/CLICK360_P2_WEB_SAFE_RELEASE_REPORT.md'
]);
const boundaryPaths = new Set([
  '.github/workflows/p0-qa.yml', 'docs/CLICK360_FIREBASE_DATA_AUDIT.md',
  'docs/CLICK360_LEGACY_MIGRATION_REPORT.md', 'docs/CLICK360_P2_WEB_ADMIN_DEPENDENCY_BOUNDARY.md',
  'docs/CLICK360_V16_SECURITY_AND_RULES.md', 'qa-p2-web-admin-boundary-harness.cjs',
  'scripts/admin-tool-wrapper.mjs', 'scripts/admin-access-v16.mjs',
  'scripts/audit-firestore-legacy.mjs', 'scripts/migrate-legacy-v9-to-v10.mjs',
  'scripts/normalize-approved-owner-access.mjs'
]);
const isAllowed = (file) => allowed.has(file) || boundaryPaths.has(file) || file.startsWith('tools/admin/');

assert(changedFiles.length > 0, 'the release branch must contain a reviewable diff');
for (const file of changedFiles) assert(isAllowed(file), `unsafe release path: ${file}`);

const runtimeFiles = changedFiles.filter((file) => !file.startsWith('docs/') && !file.startsWith('qa') && !file.startsWith('tools/admin/') && !boundaryPaths.has(file) && file !== 'qa-p2-web-safe-release-harness.cjs');
const diff = execFileSync('git', ['diff', '--unified=0', main, '--', ...runtimeFiles], { cwd:root, encoding:'utf8' });
const addedCode = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');
for (const token of ['deleteDoc', 'writeBatch', 'setDoc(', 'firebase deploy', 'localStorage.clear', 'migration apply']) {
  assert(!addedCode.includes(token), `unsafe added operation: ${token}`);
}
assert(!changedFiles.some((file) => file === 'firestore.rules' || file.startsWith('functions/')), 'cloud Rules or Functions entered the web release');

const flags = fs.readFileSync(`${root}/p2-web-safe-flags.js`, 'utf8');
assert(flags.includes('p2UniversalLabelsEnabled: true'), 'universal labels must be enabled');
for (const key of ['p2WorkersEnabled', 'p2RestaurantAdvancedEnabled', 'p2LogisticsEnabled', 'p2OwnerPreviewEnabled']) {
  assert(flags.includes(`${key}: false`), `${key} must remain disabled`);
}

const app = fs.readFileSync(`${root}/app.js`, 'utf8');
const firebase = fs.readFileSync(`${root}/firebase-service.js`, 'utf8');
const rootPackage = JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8'));
const rootLock = JSON.parse(fs.readFileSync(`${root}/package-lock.json`, 'utf8'));
assert(app.includes("const APP_RELEASE_VERSION = '1.0.5-p2-web-safe'"), 'visible release version must be current');
assert(app.includes("const APP_ASSET_VERSION = 'mvp-launch-v16-2-p2-web-safe-r1'"), 'app asset version must be current');
assert(app.includes('p2UniversalLabelsEnabled !== true'), 'universal labels must honor the release gate');
assert(firebase.includes("const APP_ASSET_VERSION = 'mvp-launch-v16-2-p2-web-safe-r1'"), 'only the app cache generation changes in Firebase service');
assert.equal(Object.hasOwn(rootPackage.dependencies || {}, 'firebase-admin'), false, 'web runtime excludes firebase-admin');
assert.equal(Object.hasOwn(rootLock.packages[''].dependencies || {}, 'firebase-admin'), false, 'web lockfile excludes firebase-admin');

console.log(`P2 web-safe release harness: PASS (${changedFiles.length} approved paths; web runtime has no cloud mutation surface)`);
