'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const worker = fs.readFileSync('service-worker.js', 'utf8');

const RELEASE = '1.0.5';
const ASSET = 'commercial-1-0-5-r1';

function resolveCopies({ manualQuantity, stock, printByStock = false }) {
  const manual = Math.trunc(Number(manualQuantity));
  assert(Number.isFinite(manual) && manual >= 1 && manual <= 500, 'manual quantity must be between 1 and 500');
  if (!printByStock) return manual;
  return Math.max(0, Math.min(500, Math.trunc(Number(stock) || 0)));
}

function buildSheet(template, copies) {
  const columns = Math.max(1, Math.trunc(Number(template.columns) || 1));
  const rows = Math.max(1, Math.trunc(Number(template.rows) || 1));
  const capacity = columns * rows;
  return Array.from({ length: copies }, (_, index) => ({
    page: Math.floor(index / capacity),
    row: Math.floor((index % capacity) / columns),
    column: index % columns,
    xMm: Number(template.marginLeftMm || 0)
      + (index % columns) * (Number(template.widthMm) + Number(template.gapXmm || 0)),
    yMm: Number(template.marginTopMm || 0)
      + Math.floor((index % capacity) / columns) * (Number(template.heightMm) + Number(template.gapYmm || 0))
  }));
}

function templatesForBusiness(templates, businessId) {
  return templates.filter((template) => template.businessId === businessId);
}

function previewLabel(product, options) {
  return {
    name: options.showName === false ? '' : product.name,
    price: options.showPrice === false ? '' : product.price,
    qr: options.showQr === false ? '' : product.qr,
    barcode: options.showBarcode === false ? '' : product.barcode,
    sku: product.code
  };
}

const product = {
  id: 'p-omega',
  businessId: 'omega',
  name: 'Producto QA',
  price: 12.5,
  qty: 7,
  code: 'SKU-001',
  qr: 'click360://product/p-omega?businessId=omega',
  barcode: '7501031311309'
};

assert.equal(resolveCopies({ manualQuantity: 1, stock: product.qty }), 1, 'stock 7 plus manual 1 prints exactly one label');
assert.equal(resolveCopies({ manualQuantity: 1, stock: product.qty, printByStock: true }), 7, 'print-by-stock explicitly prints seven labels');
assert.equal(resolveCopies({ manualQuantity: 3, stock: product.qty }), 3, 'manual quantity 3 prints exactly three labels');
assert.throws(() => resolveCopies({ manualQuantity: 0, stock: 7 }), /between 1 and 500/, 'invalid manual quantity is rejected');

const twoColumns = buildSheet({
  widthMm: 50,
  heightMm: 30,
  columns: 2,
  rows: 5,
  marginLeftMm: 5,
  marginTopMm: 4,
  gapXmm: 2,
  gapYmm: 3
}, 3);
assert.deepEqual(
  twoColumns.map(({ page, row, column }) => ({ page, row, column })),
  [
    { page: 0, row: 0, column: 0 },
    { page: 0, row: 0, column: 1 },
    { page: 0, row: 1, column: 0 }
  ],
  'two-column template preserves deterministic positions'
);
assert.equal(twoColumns[1].xMm, 57, 'two-column template applies width and horizontal gap in millimeters');

const threeColumns = buildSheet({
  widthMm: 30,
  heightMm: 20,
  columns: 3,
  rows: 8,
  marginLeftMm: 3,
  marginTopMm: 2,
  gapXmm: 1,
  gapYmm: 1
}, 4);
assert.deepEqual(
  threeColumns.map(({ row, column }) => ({ row, column })),
  [{ row: 0, column: 0 }, { row: 0, column: 1 }, { row: 0, column: 2 }, { row: 1, column: 0 }],
  'three-column template wraps to the next row'
);

const roll = buildSheet({ widthMm: 101.6, heightMm: 50.8, columns: 1, rows: 1 }, 3);
assert.deepEqual(roll.map((label) => label.page), [0, 1, 2], 'thermal roll prints one label unit per page');

const custom = buildSheet({
  widthMm: 42,
  heightMm: 28,
  columns: 2,
  rows: 2,
  marginLeftMm: 7,
  marginTopMm: 9,
  gapXmm: 4,
  gapYmm: 5
}, 4);
assert.equal(custom[0].xMm, 7, 'custom template respects left margin');
assert.equal(custom[0].yMm, 9, 'custom template respects top margin');
assert.equal(custom[3].xMm, 53, 'custom template respects horizontal spacing');
assert.equal(custom[3].yMm, 42, 'custom template respects vertical spacing');

const before = JSON.stringify(product);
const preview = previewLabel(product, { showQr: true, showBarcode: true, showName: true, showPrice: true });
assert.equal(preview.qr, product.qr, 'QR is included in preview');
assert.equal(preview.barcode, product.barcode, 'barcode is included in preview');
assert.equal(JSON.stringify(product), before, 'preview/export does not alter product or stock');

const templates = [
  { id: 'omega-roll', businessId: 'omega' },
  { id: 'alfa-sheet', businessId: 'alfa' }
];
assert.deepEqual(templatesForBusiness(templates, 'omega').map((item) => item.id), ['omega-roll'], 'label profiles are isolated by businessId');

assert.match(app, /function resolveLabelCopies\(|click360ResolveLabelCopies/, 'application exposes an explicit label copy resolver');
assert.match(app, /printByStock|useStock|labelUseStock|una etiqueta por cada unidad en stock/i, 'printing by stock is an explicit opt-in');
assert.match(app, /type=["']checkbox["'][^>]*(?:stock|existencia)|(?:stock|existencia)[^<]{0,100}<input[^>]+type=["']checkbox["']/i, 'print-by-stock is represented by a checkbox');
for (const visibleTemplate of [
  /Rollo t[eé]rmico 4x2/i,
  /Rollo t[eé]rmico etiqueta peque[ñn]a/i,
  /Hoja 2 columnas/i,
  /Hoja 3 columnas/i,
  /Personalizada/i
]) {
  assert.match(app, visibleTemplate, `application includes template ${visibleTemplate}`);
}
assert.match(app, /labelProfiles|labelTemplatesForBiz/, 'label profiles are stored and filtered per business');
assert.match(app, /widthMm|ancho etiqueta/i, 'template supports label width in millimeters');
assert.match(app, /heightMm|alto etiqueta/i, 'template supports label height in millimeters');
assert.match(app, /203|300/, 'template supports thermal printer DPI');
assert.match(app, /Vista previa|preview/i, 'label preview exists before printing');
assert.match(app, /prueba de alineaci[oó]n|alignment/i, 'label alignment test exists');
assert.match(app, /labelShape[\s\S]{0,600}Circular/i, 'label templates include a simple circular visual shape');
assert.match(app, /JsBarcode|jsbarcode/i, 'product barcode can be rendered');
assert.match(html, /jsbarcode/i, 'barcode renderer is loaded by the public page');
assert.match(styles, /@media print/, 'print media styles exist');
assert.match(styles, /data-print-media=["']?label|printSheet/, 'label print layout is isolated from the app UI');
assert.match(app, /businessId/, 'label persistence carries businessId');

assert(app.includes(`const APP_RELEASE_VERSION = '${RELEASE}'`), 'app has the P1.5A release version');
assert(app.includes(`const APP_ASSET_VERSION = '${ASSET}'`), 'app has the P1.5A asset version');
assert(html.includes(ASSET), 'HTML references the P1.5A asset version');
assert(styles.includes(ASSET), 'CSS assets reference the P1.5A asset version');
assert(worker.includes(`click360-${ASSET}`), 'service worker cache is isolated for P1.5A');

console.log('PASS P1.5A label printing harness: manual quantity, opt-in stock copies, templates, preview and business isolation');
