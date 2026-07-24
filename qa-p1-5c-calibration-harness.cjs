const { assert, loadSmartPrintCore, paper } = require('./qa/helpers/smart-print-test-utils.cjs');

const core = loadSmartPrintCore();
const grid = core.buildCalibrationGrid(1);
assert.equal(grid.length, 9);
assert.deepEqual({ ...grid[0] }, { cell: 1, deltaXmm: -1, deltaYmm: -1 });
assert.deepEqual({ ...grid[4] }, { cell: 5, deltaXmm: 0, deltaYmm: 0 });
assert.deepEqual({ ...grid[8] }, { cell: 9, deltaXmm: 1, deltaYmm: 1 });

const centered = core.applyCalibrationCell({ cell: 5, currentXOffsetMm: 0.5, currentYOffsetMm: -0.25 });
assert.equal(centered.valid, true);
assert.equal(centered.xOffsetMm, 0.5);
assert.equal(centered.yOffsetMm, -0.25);
assert.equal(centered.status, 'verified');
const moved = core.applyCalibrationCell({ cell: 1, currentXOffsetMm: 0, currentYOffsetMm: 0 });
assert.equal(moved.xOffsetMm, -1);
assert.equal(moved.yOffsetMm, -1);
assert.equal(moved.status, 'provisional');
assert.equal(core.applyCalibrationCell({ cell: 0, currentXOffsetMm: 0, currentYOffsetMm: 0 }).valid, false);
assert.equal(core.calculateCalibration({ currentXOffsetMm: 0, currentYOffsetMm: 0, observedXmm: NaN, observedYmm: 0, targetXmm: 0, targetYmm: 0 }).valid, false);
assert.equal(core.calculateCalibration({ currentXOffsetMm: 0, currentYOffsetMm: 0, observedXmm: -20, observedYmm: 0, targetXmm: 0, targetYmm: 0 }).valid, false);

const fingerprint = core.paperGeometryFingerprint(paper());
assert.notEqual(fingerprint, core.paperGeometryFingerprint(paper({ gapHorizontalMm: 4 })), 'geometry changes invalidate calibration');
const localA = core.normalizeLocalDeviceState({
  calibrations: { [fingerprint]: { xOffsetMm: 1, yOffsetMm: -1, status: 'verified', geometryFingerprint: fingerprint } }
}, { uid: 'uid-a', tenantKey: 'tenant-a', businessId: 'omega', deviceId: 'device-a' });
const localB = core.normalizeLocalDeviceState({}, { uid: 'uid-a', tenantKey: 'tenant-a', businessId: 'omega', deviceId: 'device-b' });
assert.equal(Object.keys(localA.calibrations).length, 1);
assert.equal(Object.keys(localB.calibrations).length, 0);
assert.notEqual(
  core.localDeviceStorageKey(localA),
  core.localDeviceStorageKey(localB),
  'calibration is isolated per device'
);
assert.equal(localA.calibrations[Object.keys(localA.calibrations)[0]].status, 'verified');

console.log('P1.5C calibration harness PASS');
