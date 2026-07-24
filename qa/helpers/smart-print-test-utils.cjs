const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadSmartPrintCore() {
  const source = fs.readFileSync(path.join(ROOT, 'smart-print-core.js'), 'utf8');
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'smart-print-core.js' });
  assert.ok(context.CLICK360_SMART_PRINT, 'smart print core exports its browser API');
  return context.CLICK360_SMART_PRINT;
}

function paper(overrides = {}) {
  return {
    id: 'qa-paper',
    businessId: 'qa-omega',
    mediaType: 'sheet',
    labelWidthMm: 60,
    labelHeightMm: 35,
    mediaWidthMm: 210,
    mediaHeightMm: 297,
    columns: 3,
    rows: 7,
    gapHorizontalMm: 3,
    gapVerticalMm: 3,
    marginTopMm: 7,
    marginRightMm: 7,
    marginBottomMm: 7,
    marginLeftMm: 7,
    nominalDpi: 300,
    status: 'verified',
    measurementsConfirmed: true,
    ...overrides
  };
}

function product(id = 'qa-product') {
  return { id, businessId: 'qa-omega', code: `QA-${id}`, name: `Producto ${id}`, qty: 7, price: 10 };
}

module.exports = { ROOT, assert, fs, path, loadSmartPrintCore, paper, product };
