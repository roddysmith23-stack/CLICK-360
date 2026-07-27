const { assert, loadSmartPrintCore } = require('./qa/helpers/smart-print-test-utils.cjs');

const core = loadSmartPrintCore();
const legacy = {
  id: 'legacy-label',
  name: 'Legacy',
  paperType: 'sheet-2',
  widthMm: 90,
  heightMm: 45,
  columns: 2,
  rows: 5,
  marginRightMm: 8,
  marginBottomMm: 8,
  layout: { qr: { x: 10, y: 10, width: 100, height: 100 } }
};
const before = JSON.stringify(legacy);
const normalized = core.normalizeLegacyTemplate(legacy, 'qa-omega');
assert.equal(JSON.stringify(legacy), before, 'legacy normalization is read-only');
assert.equal(normalized.businessId, 'qa-omega');
assert.equal(normalized.paper.columns, 2);
assert.equal(normalized.paper.marginRightMm, 8);
assert.equal(normalized.design.elements.qr.width, 100);

const provisional = core.normalizePrintProfile({
  id: 'roll-2-40x60-provisional',
  businessId: 'qa-print-profile',
  name: 'Rollo 2 columnas 40 x 60 mm',
  paper: core.PAPER_PRESETS['roll-2-40x60-provisional']
}, 'qa-print-profile');
assert.equal(provisional.status, 'provisional');
assert.equal(provisional.paper.status, 'provisional');
assert.equal(provisional.paper.measurementsConfirmed, false);
assert.equal(provisional.paper.columns, 2);
assert.equal(provisional.paper.mediaWidthMm, 0);

const keyA = core.localDeviceStorageKey({ uid: 'uid-a', tenantKey: 'owner:a:business:a', businessId: 'omega', deviceId: 'device-1' });
const keyB = core.localDeviceStorageKey({ uid: 'uid-a', tenantKey: 'owner:a:business:a', businessId: 'alfa', deviceId: 'device-1' });
const keyDevice = core.localDeviceStorageKey({ uid: 'uid-a', tenantKey: 'owner:a:business:a', businessId: 'omega', deviceId: 'device-2' });
assert.ok(keyA && keyB && keyDevice);
assert.notEqual(keyA, keyB, 'businesses do not share local print state');
assert.notEqual(keyA, keyDevice, 'devices do not share local calibration');
assert.equal(core.localDeviceStorageKey({ uid: 'uid-a', businessId: 'omega', deviceId: 'device-1' }), '', 'incomplete context is rejected');

const local = core.normalizeLocalDeviceState({
  selectedProfileId: 'profile-a',
  calibrations: {
    safe: { xOffsetMm: 1.25, yOffsetMm: -0.5, status: 'verified', geometryFingerprint: 'paper-a', attemptId: 'attempt-1', updatedAt: '2026-07-23T00:00:00Z' },
    corrupt: { xOffsetMm: 999, yOffsetMm: 'secret', status: 'certified' }
  },
  email: 'not-allowed@example.com'
}, { uid: 'uid-a', tenantKey: 'tenant-a', businessId: 'omega', deviceId: 'device-1' });
assert.equal(local.selectedProfileId, 'profile-a');
assert.deepEqual(Object.keys(local.calibrations), ['safe']);
assert.equal(local.calibrations.safe.status, 'verified');
assert.equal('email' in local, false);

console.log('P1.5C print profile harness PASS');
