const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const gitRefExists = (ref) => {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd:root, stdio:'ignore' });
    return true;
  } catch {
    return false;
  }
};
const base = ['origin/main', 'main'].find(gitRefExists);
assert(base, 'main is required for the web release scope audit');

const committed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd:root, encoding:'utf8' });
const working = execFileSync('git', ['diff', '--name-only', base], { cwd:root, encoding:'utf8' });
const changed = [...new Set(`${committed}\n${working}`.split('\n').filter(Boolean))];
assert(changed.length > 0, 'the release must contain a reviewable web diff');

const forbidden = [
  /^tools\/admin\//,
  /^functions\//,
  /^firestore\.rules$/,
  /^scripts\/(?:admin-access-v16|audit-firestore-legacy|migrate-legacy-v9-to-v10|normalize-approved-owner-access)\.mjs$/
];
for (const file of changed) {
  assert(!forbidden.some((pattern) => pattern.test(file)), `forbidden release path: ${file}`);
}

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
assert.equal(packageJson.version, '1.0.5');
assert.equal(Object.hasOwn(packageJson.dependencies || {}, 'firebase-admin'), false);
assert.equal(Object.hasOwn(packageLock.packages[''].dependencies || {}, 'firebase-admin'), false);
assert.equal(packageJson.devDependencies?.playwright, '1.62.0');

const app = read('app.js');
const index = read('index.html');
const worker = read('service-worker.js');
const flags = read('p2-web-safe-flags.js');
const build = read('scripts/build-static-release.mjs');
assert.match(app, /APP_RELEASE_VERSION = '1\.0\.5'/);
assert.match(app, /APP_ASSET_VERSION = 'commercial-1-0-5-r1'/);
assert.match(index, /universal-label-canvas\.js\?v=commercial-1-0-5-r1/);
assert.match(index, /universal-label-editor\.js\?v=commercial-1-0-5-r1/);
assert.match(worker, /click360-commercial-1-0-5-r1/);
assert.match(flags, /p2UniversalLabelsEnabled: true/);
for (const key of ['p2WorkersEnabled', 'p2RestaurantAdvancedEnabled', 'p2LogisticsEnabled', 'p2OwnerPreviewEnabled']) {
  assert.match(flags, new RegExp(`${key}: false`), `${key} must remain disabled`);
}
for (const asset of ['universal-label-canvas.js', 'universal-label-editor.js']) {
  assert.match(build, new RegExp(`'${asset.replace('.', '\\.')}'`));
}
assert.doesNotMatch(build, /node_modules|tools\/admin|functions\//);

const runtimeFiles = changed.filter((file) => [
  'app.js', 'firebase-service.js', 'printing-service.js', 'runtime-guard.js',
  'service-worker.js', 'smart-print-core.js', 'universal-label-canvas.js',
  'universal-label-editor.js'
].includes(file));
const runtimeDiff = runtimeFiles.length
  ? execFileSync('git', ['diff', '--unified=0', base, '--', ...runtimeFiles], { cwd:root, encoding:'utf8' })
  : '';
const additions = runtimeDiff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n');
for (const token of ['deleteDoc', 'writeBatch', 'setDoc(', 'localStorage.clear', 'migration apply']) {
  assert(!additions.includes(token), `forbidden runtime operation: ${token}`);
}

console.log(`CLICK 360 1.0.5 web release scope PASS: ${changed.length} frontend/QA/documentation paths`);
