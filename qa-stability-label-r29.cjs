'use strict';

const { assert, loadSmartPrintCore, paper, product } = require('./qa/helpers/smart-print-test-utils.cjs');
const core = loadSmartPrintCore();

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

function filledCells(plan) {
  return plan.pages.flatMap(page => Array.from(page.cells)).filter(cell => cell.status === 'filled');
}

for (const quantity of [1, 2, 4, 10]) {
  const copies = core.resolveCopies(quantity, false, 999);
  assert.equal(copies.valid, true, `quantity ${quantity} valid`);
  assert.equal(copies.count, quantity, `quantity ${quantity} preserved exactly`);
  const plan = core.buildSheetPlan([{ product: product(), copies: copies.count }], rollTwo, { startSlot: 1 });
  assert.equal(plan.valid, true, `quantity ${quantity} has valid physical plan`);
  assert.equal(plan.count, quantity, `plan count ${quantity}`);
  assert.equal(filledCells(plan).length, quantity, `exactly ${quantity} physical cells are filled`);
  assert.equal(plan.pages.length, Math.ceil(quantity / 2), `quantity ${quantity} uses expected number of two-column rows/pages`);
}

const secondCellOne = core.buildSheetPlan([{ product: product(), copies: 1 }], rollTwo, { startSlot: 2 });
assert.equal(secondCellOne.valid, true);
assert.deepEqual(Array.from(secondCellOne.pages[0].cells, c => c.status), ['used', 'filled']);
assert.equal(secondCellOne.pages[0].cells[1].slot, 2);
assert.equal(secondCellOne.pages[0].cells[1].xMm, 42);
assert.equal(secondCellOne.pages[0].cells[1].item.copy, 1);

const secondCellFour = core.buildSheetPlan([{ product: product(), copies: 4 }], rollTwo, { startSlot: 2 });
assert.equal(secondCellFour.valid, true);
assert.equal(filledCells(secondCellFour).length, 4);
assert.deepEqual(Array.from(secondCellFour.pages[0].cells, c => c.status), ['used', 'filled']);
assert.equal(secondCellFour.pages.length, 3, 'startSlot 2 consumes right cell first then continues across full rows');
assert.equal(secondCellFour.pages[1].occupied, 2);
assert.equal(secondCellFour.pages[2].occupied, 1);
assert.deepEqual(Array.from(secondCellFour.pages[1].cells, c => c.xMm), [0, 42]);

const usedLeft = core.buildSheetPlan([{ product: product(), copies: 2 }], rollTwo, { startSlot: 1, usedSlots: [1] });
assert.equal(usedLeft.valid, true);
assert.deepEqual(Array.from(usedLeft.pages[0].cells, c => c.status), ['used', 'filled']);
assert.equal(filledCells(usedLeft).length, 2);
assert.equal(usedLeft.pages[1].occupied, 1);

const invalidQuantity = core.resolveCopies(0, false, 1);
assert.equal(invalidQuantity.valid, false, 'zero copies remains rejected');
const invalidSlot = core.buildSheetPlan([{ product: product(), copies: 1 }], rollTwo, { startSlot: 3 });
assert.equal(invalidSlot.valid, false, 'slot outside two-column capacity remains rejected');
assert.equal(invalidSlot.pages.length, 0);

console.log('CLICK360_LABEL_R29_REGRESSION: PASS exact quantities 1/2/4/10 + startSlot 2 + used slots');
