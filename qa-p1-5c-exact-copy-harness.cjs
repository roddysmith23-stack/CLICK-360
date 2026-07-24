const { assert, loadSmartPrintCore, paper, product } = require('./qa/helpers/smart-print-test-utils.cjs');

const core = loadSmartPrintCore();
assert.deepEqual({ ...core.resolveCopies(1, false, 7) }, {
  valid: true,
  count: 1,
  mode: 'exact',
  message: 'Se imprimiran 1 etiquetas exactas. El stock no cambia esta cantidad.'
});
assert.equal(core.resolveCopies(7, false, 1).count, 7);
assert.equal(core.resolveCopies(1, true, 7).count, 7);
assert.equal(core.resolveCopies(1, true, 0).count, 0);
assert.match(core.resolveCopies(1, true, 0).warning, /no tiene stock/);
for (const invalid of [0, -1, 1.5, NaN, Infinity, 501, '']) {
  assert.equal(core.resolveCopies(invalid, false, 7).valid, false, `${invalid} is rejected`);
}
assert.equal(core.resolveCopies(500, false, 1).valid, true);

const exactOne = core.buildSheetPlan([{ product: product(), copies: core.resolveCopies(1, false, 7).count }], paper(), {});
assert.equal(exactOne.count, 1);
assert.equal(exactOne.pages[0].occupied, 1);
const exactSeven = core.buildSheetPlan([{ product: product(), copies: core.resolveCopies(7, false, 1).count }], paper(), {});
assert.equal(exactSeven.count, 7);
assert.equal(exactSeven.pages[0].occupied, 7);

console.log('P1.5C exact copy harness PASS');
