const { assert, loadSmartPrintCore, paper, product } = require('./qa/helpers/smart-print-test-utils.cjs');

const core = loadSmartPrintCore();
const a4Three = core.validatePaperProfile(paper());
assert.equal(a4Three.valid, true);
assert.equal(a4Three.requiredWidthMm, 200);
assert.equal(a4Three.requiredHeightMm, 277);

const seven = core.buildSheetPlan([{ product: product(), copies: 7 }], paper(), {});
assert.equal(seven.valid, true);
assert.equal(seven.count, 7);
assert.equal(seven.pages.length, 1);
assert.equal(seven.pages[0].occupied, 7);
assert.equal(seven.pages[0].emptyCells, 14);
assert.deepEqual(
  Array.from([seven.pages[0].cells[0].xMm, seven.pages[0].cells[0].yMm, seven.pages[0].cells[3].yMm]),
  [7, 7, 45]
);

const startFive = core.buildSheetPlan([{ product: product(), copies: 3 }], paper({ columns: 2, rows: 4, labelWidthMm: 90, labelHeightMm: 45, gapHorizontalMm: 4, gapVerticalMm: 4, marginTopMm: 8, marginRightMm: 8, marginBottomMm: 8, marginLeftMm: 8 }), { startSlot: 5, usedSlots: [6] });
assert.deepEqual(Array.from(startFive.pages[0].cells, (cell) => cell.status), ['used', 'used', 'used', 'used', 'filled', 'used', 'filled', 'filled']);
assert.equal(startFive.pages[0].cells[4].item.copy, 1);

const rollTwo = paper({
  mediaType: 'roll-2',
  labelWidthMm: 40,
  labelHeightMm: 60,
  mediaWidthMm: 82,
  mediaHeightMm: 0,
  columns: 2,
  rows: 1,
  gapHorizontalMm: 2,
  gapVerticalMm: 0,
  marginTopMm: 0,
  marginRightMm: 0,
  marginBottomMm: 0,
  marginLeftMm: 0,
  nominalDpi: 203
});
const rollPlan = core.buildSheetPlan([{ product: product(), copies: 3 }], rollTwo, { startSlot: 2 });
assert.equal(rollPlan.pages.length, 2);
assert.deepEqual(Array.from(rollPlan.pages[0].cells, (cell) => cell.status), ['used', 'filled']);
assert.equal(rollPlan.pages[1].occupied, 2);
assert.deepEqual(Array.from(rollPlan.pages[0].cells, (cell) => cell.xMm), [0, 42]);

const impossible = core.validatePaperProfile({ ...rollTwo, mediaWidthMm: 70 });
assert.equal(impossible.valid, false);
assert.match(impossible.errors[0], /requieren 82\.0 mm/);
const incomplete = core.validatePaperProfile({ ...rollTwo, mediaWidthMm: 0 });
assert.equal(incomplete.valid, true, 'legacy roll auto-width is a provisional derived carrier, not a blocked profile');
assert.equal(incomplete.requiredWidthMm, 82);
assert.ok(incomplete.warnings.some((warning) => /Ancho automatico/.test(warning)));
const incompleteSheet = core.validatePaperProfile({ ...rollTwo, mediaType:'sheet', mediaWidthMm:0 });
assert.equal(incompleteSheet.valid, false, 'sheet width still requires an explicit supported page');
assert.match(incompleteSheet.errors[0], /ancho total/);
const invalidStart = core.buildSheetPlan([{ product: product(), copies: 1 }], paper(), { startSlot: 99 });
assert.equal(invalidStart.valid, false);
assert.equal(invalidStart.pages.length, 0);
const allUsed = core.buildSheetPlan([{ product: product(), copies: 1 }], paper({ columns: 2, rows: 1 }), { usedSlots: [1, 2] });
assert.equal(allUsed.valid, false);
assert.match(allUsed.errors[0], /Todas las casillas/);
const empty = core.buildSheetPlan([{ product: product(), copies: 0 }], paper(), {});
assert.equal(empty.pages.length, 0);

for (const rotation of core.ROTATIONS) {
  const rotated = core.normalizePaperProfile(paper({ contentRotation: rotation }));
  assert.equal(rotated.contentRotation, rotation);
  assert.equal(rotated.labelWidthMm, 60);
  assert.equal(rotated.labelHeightMm, 35);
}

console.log('P1.5C paper geometry harness PASS');
