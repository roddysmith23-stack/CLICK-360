const { assert, fs, path, ROOT, loadSmartPrintCore } = require('./qa/helpers/smart-print-test-utils.cjs');
const vm = require('node:vm');

const core = loadSmartPrintCore();
const source = fs.readFileSync(path.join(ROOT, 'universal-label-canvas.js'), 'utf8');
const sandbox = { globalThis: {}, window: {} };
sandbox.window = sandbox.globalThis;
sandbox.globalThis.CLICK360_SMART_PRINT = core;
vm.runInNewContext(source, sandbox, { filename: 'universal-label-canvas.js' });
const canvas = sandbox.globalThis.CLICK360_UNIVERSAL_LABEL_CANVAS;

const document = canvas.normalizeDocument({
  paper: { id: 'synthetic-roll', mediaType: 'roll-2', widthMm: 40, heightMm: 60, mediaWidthMm: 82, mediaHeightMm: 60, columns: 2, rows: 1 },
  objects: [
    { id: 'qr-main', type: 'qr', x: 4, y: 4, width: 28, height: 28 },
    { id: 'name-main', type: 'name', x: 4, y: 36, width: 32, height: 8 },
    { id: 'price-main', type: 'price', x: 4, y: 47, width: 32, height: 8 }
  ], quantity: 3, startSlot: 2
});
assert.equal(document.paper.widthMm, 40);
assert.equal(document.paper.columns, 2);
let history = canvas.createHistory(document);
history = canvas.commit(history, canvas.updateObject(history.present, 'name-main', { rotation: 90 }));
assert.equal(history.present.objects.find((object) => object.id === 'name-main').rotation, 90);
history = canvas.undo(history);
assert.equal(history.present.objects.find((object) => object.id === 'name-main').rotation, 0);
history = canvas.redo(history);
const duplicated = canvas.duplicateObject(history.present, 'name-main');
assert.equal(duplicated.objects.length, 4);
const copy = duplicated.objects.find((object) => object.id !== 'name-main' && object.type === 'name');
const aligned = canvas.alignObjects(duplicated, ['name-main', copy.id], 'center');
assert.equal(aligned.objects.find((object) => object.id === 'name-main').x + aligned.objects.find((object) => object.id === 'name-main').width / 2, aligned.objects.find((object) => object.id === copy.id).x + aligned.objects.find((object) => object.id === copy.id).width / 2);

const paper = core.normalizePaperProfile({ id: 'synthetic-roll', mediaType: 'roll-2', labelWidthMm: 40, labelHeightMm: 60, mediaWidthMm: 82, mediaHeightMm: 60, columns: 2, rows: 1, gapHorizontalMm: 2, gapVerticalMm: 0, nominalDpi: 203 });
const plan = canvas.buildPrintPlan([{ product: { id: 'p-synthetic', name: 'Producto QA' }, copies: 3 }], paper, { startSlot: 2 });
assert.equal(plan.valid, true);
assert.equal(plan.count, 3);
assert.equal(plan.pages[0].cells[0].status, 'used');
assert.equal(plan.pages[0].cells[1].status, 'filled');
assert.ok(canvas.planFingerprint(plan).includes('3'));

const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const worker = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const build = fs.readFileSync(path.join(ROOT, 'scripts/build-static-release.mjs'), 'utf8');
const printing = fs.readFileSync(path.join(ROOT, 'printing-service.js'), 'utf8');
for (const control of ['labelCanvasUndo', 'labelCanvasRedo', 'labelCanvasRotate', 'labelCanvasDuplicate', 'labelCanvasAlign']) assert.ok(app.includes(control), `${control} is wired`);
assert.match(app, /CLICK360_UNIVERSAL_LABEL_CANVAS/);
assert.match(html, /universal-label-canvas\.js/);
assert.ok(html.indexOf('universal-label-canvas.js') < html.indexOf('app.js'));
assert.match(worker, /\.\/universal-label-canvas\.js/);
assert.match(build, /'universal-label-canvas\.js'/);
assert.match(printing, /print-plan-empty/);
assert.match(printing, /print-resource-empty/);
assert.doesNotMatch(app, /Shary\s*·|shary-ltt214/i);
assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'smart-print-core.js'), 'utf8'), /shary-ltt214/i);
console.log('P2 universal label canvas harness PASS');
