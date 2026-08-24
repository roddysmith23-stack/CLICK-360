const { assert, fs, path, ROOT, loadSmartPrintCore } = require('./qa/helpers/smart-print-test-utils.cjs');
const vm = require('node:vm');

const core = loadSmartPrintCore();
const source = fs.readFileSync(path.join(ROOT, 'universal-label-canvas.js'), 'utf8');
const sandbox = { globalThis: {}, window: {} };
sandbox.window = sandbox.globalThis;
sandbox.globalThis.CLICK360_SMART_PRINT = core;
vm.runInNewContext(source, sandbox, { filename: 'universal-label-canvas.js' });
const canvas = sandbox.globalThis.CLICK360_UNIVERSAL_LABEL_CANVAS;

const physical = canvas.normalizeDocument({
  schemaVersion: 2,
  paper: { id: 'synthetic-roll', mediaType: 'roll-2', widthMm: 40, heightMm: 60, mediaWidthMm: 82, mediaHeightMm: 60, columns: 2, rows: 1, gapXmm: 2, dpi: 203 },
  objects: [
    { id: 'qr-main', type: 'qr', xMm: 2, yMm: 2, widthMm: 18, heightMm: 18 },
    { id: 'name-main', type: 'name', xMm: 22, yMm: 4, widthMm: 16, heightMm: 7 },
    { id: 'price-main', type: 'price', xMm: 22, yMm: 14, widthMm: 16, heightMm: 7 }
  ],
  quantity: 3,
  startSlot: 2
});
assert.equal(physical.schemaVersion, 3);
assert.equal(physical.paper.widthMm, 40);
assert.equal(physical.paper.columns, 2);
assert.deepEqual(Object.keys(physical.objects[0]).sort(), ['heightMm', 'id', 'imageData', 'locked', 'rotation', 'text', 'type', 'visible', 'widthMm', 'xMm', 'yMm', 'z']);
assert.equal(physical.objects[0].xMm, 2);
assert.equal(physical.objects[0].widthMm, 18);
assert.ok(physical.style && physical.qrStyle && physical.barcodeStyle, 'v3 documents must carry canonical style/qrStyle/barcodeStyle');

const legacyV1 = canvas.normalizeDocument({
  version: 1,
  paper: { widthMm: 40, heightMm: 60, columns: 1, rows: 1 },
  objects: [{ id: 'legacy-qr', type: 'qr', x: 500, y: 250, width: 250, height: 250 }]
});
assert.equal(legacyV1.objects[0].xMm, 15);
assert.equal(legacyV1.objects[0].yMm, 12.5); // shifts with the forced-square heightMm (was 15mm, now 10mm, widening the available y-clamp range
// r37.1 (P0-B, QR professional rules): a QR object is FORCED square (the
// smaller of the two legacy-converted axes) -- the legacy grid's own
// width:height ratio doesn't map 1:1 onto mm space unless the paper itself
// is square, so converting each axis independently (the pre-fix behavior)
// silently stretched the QR into a 10x15mm box here. That was the exact
// "QR nunca debe estirarse" bug.
assert.equal(legacyV1.objects[0].widthMm, 10);
assert.equal(legacyV1.objects[0].heightMm, 10);

const legacyLayout = canvas.normalizeDocument({
  paper: { widthMm: 60, heightMm: 88, columns: 1, rows: 1 },
  layout: { qr: { x: 45, y: 60, width: 170, height: 170 }, code: { x: 130, y: 278, width: 230, size: 10 } }
});
assert.equal(legacyLayout.objects.length, 2);
assert.equal(legacyLayout.objects.find((object) => object.id === 'code').type, 'sku');
assert.ok(legacyLayout.objects.every((object) => Number.isFinite(object.xMm) && Number.isFinite(object.yMm)));

let history = canvas.createHistory(physical);
history = canvas.commit(history, canvas.updateObject(history.present, 'name-main', { rotation: 90 }));
assert.equal(history.present.objects.find((object) => object.id === 'name-main').rotation, 90);
history = canvas.undo(history);
assert.equal(history.present.objects.find((object) => object.id === 'name-main').rotation, 0);
history = canvas.redo(history);
const duplicated = canvas.duplicateObject(history.present, 'name-main');
assert.equal(duplicated.objects.length, 4);
const copy = duplicated.objects.find((object) => object.id !== 'name-main' && object.type === 'name');
const aligned = canvas.alignObjects(duplicated, ['name-main', copy.id], 'center');
const firstCenter = aligned.objects.find((object) => object.id === 'name-main').xMm + aligned.objects.find((object) => object.id === 'name-main').widthMm / 2;
const copyCenter = aligned.objects.find((object) => object.id === copy.id).xMm + aligned.objects.find((object) => object.id === copy.id).widthMm / 2;
assert.equal(firstCenter, copyCenter);
const bounded = canvas.updateObject(physical, 'name-main', { xMm: 999, yMm: 999, widthMm: 999, heightMm: 999 });
const boundedObject = bounded.objects.find((object) => object.id === 'name-main');
assert.ok(boundedObject.xMm + boundedObject.widthMm <= bounded.paper.widthMm);
assert.ok(boundedObject.yMm + boundedObject.heightMm <= bounded.paper.heightMm);

const groups = [{ product: { id: 'p-synthetic', name: 'Producto QA', code: 'QA-001', price: 10 }, copies: 3 }];
const plan = canvas.buildPrintPlan(groups, physical, { startSlot: 2 });
const zoomIndependentPlan = canvas.buildPrintPlan(groups, { ...physical, zoom: 2 }, { startSlot: 2 });
assert.equal(plan.valid, true);
assert.equal(plan.count, 3);
assert.equal(plan.pages[0].cells[0].status, 'used');
assert.equal(plan.pages[0].cells[1].status, 'filled');
assert.equal(plan.pages.reduce((total, page) => total + page.occupied, 0), 3);
assert.equal(canvas.planFingerprint(plan), canvas.planFingerprint(zoomIndependentPlan));

const pitched = canvas.normalizeDocument({
  paper: { widthMm:40, heightMm:30, columns:1, rows:2, mediaWidthMm:40, mediaHeightMm:70, pitchMm:35 },
  objects: physical.objects,
  quantity:2
});
const pitchedPlan = canvas.buildPrintPlan([{ product:groups[0].product, copies:2 }], pitched);
assert.equal(pitchedPlan.pages[0].cells[1].yMm, 35);

const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const editor = fs.readFileSync(path.join(ROOT, 'universal-label-editor.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const build = fs.readFileSync(path.join(ROOT, 'scripts/build-static-release.mjs'), 'utf8');
const printing = fs.readFileSync(path.join(ROOT, 'printing-service.js'), 'utf8');
assert.match(app, /async function openAdvancedLabelModal/);
assert.match(app, /applyUniversalDeviceCalibration/);
assert.match(app, /universalProfileId:profile\.id, calibrations/);
assert.match(app, /xOffsetMm:0, yOffsetMm:0, scaleX:1, scaleY:1/);
assert.match(editor, /api\.selectProfile\?\.\(activeProfileId\)/);
assert.match(styles, /\.ulcWorkspace\{display:flex;flex:1 1 auto;/);
assert.match(styles, /\.ulcFooter\{position:relative;z-index:5;flex:none;/);
assert.match(styles, /#ulcSimpleMode/);
assert.match(app, /async function openLabelModal/);
assert.match(app, /CLICK360_UNIVERSAL_LABEL_EDITOR/);
assert.match(app, /buildUniversalLabelPrintNode/);
assert.match(app, /readImage:\(input, onImage\) => readImageInput/);
assert.match(app, /universal-mm-v2/);
assert.match(app, /renderer:'universal-mm-v2'/);
assert.match(app, /schemaVersion:2/);
assert.match(app, /universalProfileId:activeProfileId/);
assert.match(app, /handoffPrint\(/);
assert.match(editor, /Guardar PDF limpio/);
assert.match(editor, /ulcSystemPrint/);
assert.doesNotMatch(editor, /ulcPdf/);
assert.match(editor, /ulcSimpleMode/);
assert.match(editor, /data-ulc-tpl-delete/);
assert.match(editor, /data-ulc-handle="resize"/);
assert.match(editor, /data-ulc-handle="rotate"/);
assert.match(editor, /ulcProfiles/);
assert.match(editor, /ulcProfileName/);
assert.match(editor, /setPointerCapture/);
assert.match(editor, /openAdvanced/);
assert.match(editor, /ulcSaveTemplate/);
assert.match(editor, /ulcSaveProfile/);
assert.match(editor, /api\.readImage/);
assert.match(editor, /calibratedScaleX/);
assert.match(editor, /calibratedScaleY/);
assert.match(editor, /paper\.scaleX \|\| 1/);
assert.match(editor, /paper\.scaleY \|\| 1/);
assert.match(source, /willReadFrequently/);
assert.match(source, /ctx\.scale\(paper\.scaleX, paper\.scaleY\)/);
assert.match(html, /universal-label-canvas\.js/);
assert.match(html, /universal-label-editor\.js/);
assert.ok(html.indexOf('universal-label-canvas.js') < html.indexOf('universal-label-editor.js'));
assert.ok(html.indexOf('universal-label-editor.js') < html.indexOf('app.js'));
assert.match(worker, /\.\/universal-label-canvas\.js/);
assert.match(worker, /\.\/universal-label-editor\.js/);
assert.match(build, /'universal-label-canvas\.js'/);
assert.match(build, /'universal-label-editor\.js'/);
assert.match(printing, /print-plan-empty/);
assert.match(printing, /print-resource-empty/);
assert.match(fs.readFileSync(path.join(ROOT, 'qa/fixtures/p2-universal-label-canvas.html'), 'utf8'), /@page\{size:\$\{mediaWidth\}mm \$\{mediaHeight\}mm;margin:0\}/);
assert.match(fs.readFileSync(path.join(ROOT, 'qa/universal-label-browser-e2e.mjs'), 'utf8'), /\[320, 360, 375, 390, 414, 430, 768, 820, 1024, 1280, 1366, 1440, 1920\]/);
assert.doesNotMatch(app, /Shary\s*·|shary-ltt214/i);
assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'smart-print-core.js'), 'utf8'), /shary-ltt214/i);

console.log('P2 universal label canvas harness PASS');
