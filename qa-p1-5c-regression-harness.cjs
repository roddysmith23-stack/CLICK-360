const childProcess = require('node:child_process');
const { assert, fs, path, ROOT, loadSmartPrintCore } = require('./qa/helpers/smart-print-test-utils.cjs');

const core = loadSmartPrintCore();
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const app = read('app.js');
const html = read('index.html');
const styles = read('styles.css');
const worker = read('service-worker.js');
const runtime = read('runtime-guard.js');
const build = read('scripts/build-static-release.mjs');
const printing = read('printing-service.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const pkg = JSON.parse(read('package.json'));
const artifacts = JSON.parse(read('qa/artifacts/p1-5c-synthetic-print-plans.json'));

assert.match(app, /APP_RELEASE_VERSION = '1\.0\.5'/);
assert.match(app, /APP_ASSET_VERSION = 'commercial-1-0-5-r36-p0-2-reliability-fix'/);
assert.match(runtime, /APP_VERSION = '1\.0\.5'/);
assert.match(worker, /click360-commercial-1-0-5-r36-p0-2-reliability-fix/);
assert.match(html, /smart-print-core\.js\?v=commercial-1-0-5-r36-p0-2-reliability-fix/);
assert.ok(html.indexOf('smart-print-core.js') < html.indexOf('app.js'), 'core loads before app');
assert.match(worker, /\.\/smart-print-core\.js/);
assert.match(build, /'smart-print-core\.js'/);
assert.equal(manifest.start_url, './?v=commercial-1-0-5-r36-p0-2-reliability-fix');
assert.equal(pkg.version, '1.0.5');
assert.equal(artifacts.hardwareCertified, false);
assert.ok(artifacts.cases.length >= 13);
const artifactIds = new Set(artifacts.cases.map((entry) => entry.id));
for (const id of [
  'exact-one-stock-seven',
  'roll-two-start-right',
  'roll-three-exact-four',
  'sheet-two-start-five-used-six',
  'sheet-three-seven',
  'orientation-40x60',
  'orientation-60x40',
  'design-qr-only',
  'design-complete-compact',
  'numbered-test-3x3'
]) assert.equal(artifactIds.has(id), true, `synthetic artifact exists: ${id}`);
assert.equal(core.DESIGN_PRESETS['qr-only'].showUrl, false);
assert.equal(core.DESIGN_PRESETS.compact.showUrl, false);
assert.deepEqual(
  Array.from(core.buildCalibrationGrid(1), (cell) => cell.cell),
  [1, 2, 3, 4, 5, 6, 7, 8, 9]
);

for (const contract of [
  'getOptions',
  'buildLabelSheetPlan',
  'labelPrintPage',
  'labelStartSlot',
  'usedPrintSlots',
  'savePrintProfileBtn',
  'labelCalibrationGrid',
  'copyPrintDiagnostic'
]) assert.ok(app.includes(contract), `${contract} remains integrated`);
assert.match(printing, /mediaWidthMm \|\| job\.widthMm/);
assert.match(printing, /click360PrintPortal/);
assert.match(styles, /#click360PrintPortal/);
assert.match(styles, /body>\*:not\(#click360PrintPortal\)/);
assert.doesNotMatch(styles, /P1\.5C[^]*printLabels\[data-paper\^="roll"\] \.printLabel\{break-after:page/);

const cachedAssets = [...worker.matchAll(/'(\.\/[^']+)'/g)].map((match) => match[1]);
for (const asset of cachedAssets) {
  const relative = asset === './' ? 'index.html' : asset.replace(/^\.\//, '');
  assert.ok(fs.existsSync(path.join(ROOT, relative)), `cached asset exists: ${asset}`);
}

const forbidden = [
  'p0-tenant-guard.js',
  'access-flow.js'
];
let changed = [];
try {
  changed = childProcess.execFileSync('git', ['diff', '--name-only', '6aa097f9ce48fbb308d7851a0917122d5ed2695a'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch {}
for (const file of forbidden) assert.equal(changed.includes(file), false, `${file} is untouched`);
const firebaseConfig = read('firebase-config.js');
assert.match(firebaseConfig, /projectId:\s*"click-360"/, 'production Firebase project remains intact');
assert.match(firebaseConfig, /const CLICK360_STAGING_FIREBASE_CONFIG = \{[\s\S]*projectId:\s*"click360-staging-7620168025"/, 'staging Firebase config is separate');
assert.match(firebaseConfig, /CLICK360_IS_STAGING_HOST[\s\S]*CLICK360_STAGING_FIREBASE_CONFIG[\s\S]*CLICK360_PRODUCTION_FIREBASE_CONFIG/, 'runtime selects exactly one environment config');
if (changed.includes('firestore.rules')) {
  const rules = read('firestore.rules');
  assert.match(rules, /match \/businesses\/\{businessId\}\/auditEvents\/\{eventId\}[\s\S]*allow update, delete: if false;/, 'stability candidate permits only its separately tested append-only audit contract');
}
assert.equal(core.VERSION, '1.0.5');

console.log('P1.5C regression harness PASS');
