'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const baseline = process.env.CLICK360_PRINT_BASELINE || '';
const read = (name) => baseline ? execFileSync('git', ['show', `${baseline}:${name}`], { cwd:__dirname, encoding:'utf8' }) : fs.readFileSync(path.join(__dirname, name), 'utf8');
const context = { console }; context.window = context;
vm.createContext(context);
for (const name of ['smart-print-core.js', 'universal-label-canvas.js']) vm.runInContext(read(name), context);
const app = read('app.js');
vm.runInContext(app.slice(app.indexOf('function universalMediaSize('), app.indexOf('function legacyPaperProfileToUniversal(')), context);
const core = context.CLICK360_SMART_PRINT, canvas = context.CLICK360_UNIVERSAL_LABEL_CANVAS;
const fixture = { id:'synthetic-physical-contract', mediaType:'roll-2', widthMm:40, heightMm:60, columns:2, rows:1, gapXmm:4, gapYmm:4, marginTopMm:13, marginRightMm:2, marginBottomMm:2, marginLeftMm:6, mediaWidthMm:0, mediaHeightMm:0, pitchMm:0, xOffsetMm:0, yOffsetMm:0, dpi:203 };
const product = { id:'synthetic-product', businessId:'synthetic-business', name:'QA synthetic', code:'QA-001', price:9.99, qty:10 };
const make = (paper) => canvas.normalizeDocument({ paper:{ ...fixture, ...paper }, objects:[{ id:'qr-contract', type:'qr', xMm:8, yMm:10, widthMm:22, heightMm:22 }, { id:'text-contract', type:'text', xMm:3, yMm:38, widthMm:32, heightMm:6, text:'SYNTHETIC' }] });
const tests = [], check = (name, run) => { try { run(); tests.push({ name, pass:true }); } catch (e) { tests.push({ name, pass:false, error:e.message }); } };
check('legacy multicolumn roll width=0 resolves provisionally, not blocked', () => {
  const result = core.validatePaperProfile(canvas.toPrintPaper(make()));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.ok(result.warnings.length > 0, 'automatic dimensions must not imply physical certification');
});
check('catalog validator physical roll height includes last row gap', () => {
  assert.equal(core.validatePaperProfile(canvas.toPrintPaper(make())).requiredHeightMm, 64);
});
check('declared undersized multirow height cannot clip a later row', () => {
  assert.equal(context.universalMediaSize(make({ rows:2, mediaHeightMm:60 })).heightMm, 128);
});
check('plausible but stale roll page height cannot add pitch every page', () => {
  assert.equal(context.universalMediaSize(make({ mediaHeightMm:90 })).heightMm, 64);
});
check('catalog and canonical share stale-width handling and media dimensions', () => {
  const doc = make({ mediaWidthMm:800 });
  const validation = core.validatePaperProfile(canvas.toPrintPaper(doc));
  const media = core.resolvePhysicalMedia ? core.resolvePhysicalMedia(canvas.toPrintPaper(doc)) : { widthMm:validation.paper.mediaWidthMm || validation.requiredWidthMm, heightMm:validation.paper.mediaHeightMm || validation.requiredHeightMm };
  assert.equal(media.widthMm, context.universalMediaSize(doc).widthMm);
  assert.equal(media.heightMm, context.universalMediaSize(doc).heightMm);
});
check('explicit undersized measured width remains an actionable block', () => {
  assert.equal(core.validatePaperProfile(canvas.toPrintPaper(make({ mediaWidthMm:40 }))).valid, false);
  assert.ok(context.universalMediaSize(make({ mediaWidthMm:40 })).widthMm >= 92, 'direct render still cannot clip columns');
});
check('sheet dimensions and missing sheet width remain checked', () => {
  const sheet = core.validatePaperProfile({ presetId:'sheet-3' });
  assert.equal(sheet.valid, true);
  assert.equal(sheet.requiredWidthMm, 200);
  assert.equal(sheet.requiredHeightMm, 277);
  assert.equal(core.validatePaperProfile({ ...fixture, mediaType:'sheet' }).valid, false);
});
let cases = 0;
check('quantity/slot/rotation/gap/width/height matrix preserves exact cells and pitch', () => {
  for (const quantity of [1,2,3,4,6,10]) for (const startSlot of [1,2]) for (const rows of [1,2])
  for (const gapYmm of [0,4]) for (const contentRotation of [0,90,180,270])
  for (const mediaWidthMm of [0,40,92,100,148,800]) for (const mediaHeightMm of [0,60,90,800]) {
    const doc = make({ rows, gapYmm, contentRotation, mediaWidthMm, mediaHeightMm });
    const artworkBefore = JSON.stringify({ objects:doc.objects, style:doc.style, qrStyle:doc.qrStyle });
    const media = context.universalMediaSize(doc), plan = canvas.buildPrintPlan([{ product, copies:quantity }], doc, { startSlot });
    assert.equal(plan.valid, true); assert.equal(plan.count, quantity);
    assert.equal(media.heightMm, rows * (60 + gapYmm));
    assert.equal(media.widthMm, mediaWidthMm === 100 ? 100 : 92);
    const filled = plan.pages.flatMap(p => p.cells.filter(c => c.status === 'filled'));
    assert.equal(filled.length, quantity);
    assert.ok(plan.pages.every(p => p.occupied > 0), 'no blank page interleaving');
    for (const p of plan.pages) for (const cell of p.cells) {
      assert.equal(cell.xMm, cell.column === 1 ? 6 : 50);
      assert.equal(cell.yMm, (cell.row - 1) * (60 + gapYmm));
      assert.ok(cell.xMm + 40 <= media.widthMm);
      assert.ok(cell.yMm + 60 <= media.heightMm);
      const physicalY = p.index * media.heightMm + cell.yMm;
      assert.equal(physicalY, (p.index * rows + cell.row - 1) * (60 + gapYmm));
    }
    assert.equal(JSON.stringify({ objects:doc.objects, style:doc.style, qrStyle:doc.qrStyle }), artworkBefore);
    assert.ok(doc.objects.filter(o=>o.type==='qr').every(o=>o.widthMm===o.heightMm));
    cases++;
  }
});
check('explicit pitch stays identical in plan and media resolver', () => {
  const doc = make({ rows:2, pitchMm:67 });
  const plan = canvas.buildPrintPlan([{ product, copies:4 }], doc);
  assert.equal(plan.pages[0].cells[2].yMm, 67);
  assert.equal(context.universalMediaSize(doc).heightMm, 134);
});
const result = { checkedAt:new Date().toISOString(), source:baseline || 'working-tree', syntheticOnly:true, tests, matrixCases:cases, pass:tests.every(t=>t.pass) };
const output = path.join(__dirname, 'artifacts/full-mvp-20260831/print');
fs.mkdirSync(output, { recursive:true });
fs.writeFileSync(path.join(output, baseline ? 'contract-before.json' : 'contract-after.json'), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if (!result.pass) process.exitCode=1;
