const { assert, loadSmartPrintCore, paper } = require('./qa/helpers/smart-print-test-utils.cjs');

const core = loadSmartPrintCore();
const safeLayout = {
  qr: { x: 8, y: 8, width: 70, height: 70, visible: true },
  name: { x: 135, y: 42, width: 95, size: 12, visible: true },
  price: { x: 135, y: 67, width: 95, size: 14, visible: true }
};
const safe = core.detectLayoutCollisions(safeLayout, { width: 200, height: 120 });
assert.equal(safe.critical, false);
assert.equal(safe.outside.length, 0);
assert.equal(safe.collisions.length, 0);

const colliding = {
  qr: { x: 10, y: 10, width: 100, height: 100, visible: true },
  barcode: { x: 40, y: 65, width: 140, height: 35, visible: true },
  name: { x: 80, y: 40, width: 120, size: 18, visible: true }
};
const collision = core.detectLayoutCollisions(colliding, { width: 200, height: 120 });
assert.equal(collision.critical, true);
assert.ok(collision.collisions.length >= 2);

const outside = core.detectLayoutCollisions({ qr: { x: 160, y: 80, width: 80, height: 80, visible: true } }, { width: 200, height: 120 });
assert.equal(outside.critical, true);
assert.deepEqual(Array.from(outside.outside, (box) => box.key), ['qr']);

const preflight = core.buildPreflight({
  paper: paper(),
  manualQuantity: 1,
  useStock: false,
  stock: 7,
  elements: colliding,
  bounds: { width: 200, height: 120 },
  qrSizeMm: 12,
  showUrl: true,
  visibleUrl: 'https://example.invalid/a/very/long/url/that/should/not/be/printed'
});
assert.equal(preflight.blocking, true);
assert.ok(preflight.errors.some((check) => check.code === 'collisions'));
assert.ok(preflight.errors.some((check) => check.code === 'qr-size'));
assert.ok(preflight.warnings.some((check) => check.code === 'long-url'));

const corrected = core.autoCorrectLayout(colliding, { width: 200, height: 120 });
const correctedResult = core.detectLayoutCollisions(corrected, { width: 200, height: 120 });
assert.equal(correctedResult.critical, false, 'auto-correct removes critical overlap');
assert.deepEqual(
  JSON.parse(JSON.stringify(core.autoCorrectLayout(corrected, { width: 200, height: 120 }))),
  JSON.parse(JSON.stringify(corrected)),
  'auto-correct is idempotent'
);

console.log('P1.5C layout collision harness PASS');
