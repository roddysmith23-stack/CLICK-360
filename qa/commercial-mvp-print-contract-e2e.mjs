import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit, firefox } from 'playwright';

// Synthetic-only browser contract. The existing extractors load exact app.js
// prepare/profile/plan/render/handoff functions, not a geometry reimplementation.
// Only business/profile storage and window.print are replaced by local fixtures.
const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/commercial-mvp-print-contract');
const reportDir = path.join(root, 'artifacts/full-mvp-20260831/print');
const port = Number(process.env.CLICK360_MVP_PRINT_PORT || 4898);
const url = `http://127.0.0.1:${port}/qa/fixtures/r33-print-profile-merge.html`;
for (const script of ['extract-print-profile-merge.cjs', 'extract-print-handoff.cjs', 'extract-legacy-label-renderer.cjs']) {
  execFileSync(process.execPath, [path.join(root, 'qa', script)], { stdio:'inherit' });
}
await mkdir(output, { recursive:true }); await mkdir(reportDir, { recursive:true });
const server = spawn(process.execPath, [path.join(root,'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });
const allResults = [];
async function run(name, browserType) {
  const browser = await browserType.launch();
  const results = [];
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(url, { waitUntil:'networkidle' });
    await page.emulateMedia({ media:'print' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    await page.evaluate(() => {
      window.__MVP_PRINT_RUN__ = async (scenario) => {
        const { quantity, startSlot, rotation, gap, width, height, rows, legacy } = scenario;
        const api = window.CLICK360_UNIVERSAL_LABEL_CANVAS;
        const paper = { id:'synthetic-roll', mediaType:'roll-2', widthMm:40, heightMm:60, columns:2, rows, gapXmm:4, gapYmm:gap, marginLeftMm:6, marginRightMm:2, marginTopMm:13, marginBottomMm:2, mediaWidthMm:width, mediaHeightMm:height, contentRotation:rotation, dpi:203 };
        const doc = api.normalizeDocument({ paper, objects:[
          { id:'qr-synthetic', type:'qr', xMm:4, yMm:4, widthMm:22, heightMm:22, visible:true },
          { id:'name-synthetic', type:'name', xMm:4, yMm:30, widthMm:32, heightMm:8, visible:true },
          { id:'price-synthetic', type:'price', xMm:4, yMm:43, widthMm:32, heightMm:7, visible:true }
        ] });
        // A legacy top-level profile legitimately overrides stale nested 800mm.
        const template = { id:'synthetic-template', businessId:'biz-qa', name:'SYNTHETIC', priceFormat:'short', universalDocument:{ ...doc, paper:{ ...doc.paper, mediaWidthMm:legacy ? 800 : width } } };
        window.__CLICK360_TEST_PROFILES__ = legacy ? [{ id:'synthetic-profile', businessId:'biz-qa', paper:{ ...paper, labelWidthMm:40, labelHeightMm:60, gapHorizontalMm:4, gapVerticalMm:gap, nominalDpi:203 } }] : [];
        window.__CLICK360_TEST_DEVICE_STATE__ = legacy ? { selectedProfileId:'synthetic-profile' } : {};
        const before = JSON.stringify(template);
        // Preserve the existing legacy color/margin bridge as part of baseline
        // template loading; test geometry must not redefine that design contract.
        const loaded = window.__CLICK360_PROFILE_MERGE__.universalDocumentFromTemplate(template);
        const artwork = JSON.stringify({ objects:loaded.objects, style:loaded.style, qrStyle:loaded.qrStyle });
        let calls = 0;
        window.print = () => { calls++; };
        const product = { id:'synthetic-product', businessId:'biz-qa', name:'SYNTHETIC QA', code:'SYNTHETIC-001', price:1250, qty:20, stock:20 };
        try {
          const prepared = await window.__CLICK360_PROFILE_MERGE__.prepareLabelPrintJob({ product, template, businessId:'biz-qa', quantity, startSlot });
          const job = await window.__CLICK360_PRINT_HANDOFF__.executeCanonicalLabelPrint(prepared, 'system');
          const mm = px => px * 25.4 / 96;
          const pages = [...document.querySelectorAll('#click360PrintPortal .labelPrintPage')].map(el => {
            const rect = el.getBoundingClientRect();
            return { width:mm(rect.width), height:mm(rect.height), cells:[...el.querySelectorAll('.labelPrintCell')].map(cell => {
              const bounds = cell.getBoundingClientRect(), img = cell.querySelector('img');
              return { filled:cell.classList.contains('filled'), x:mm(bounds.left-rect.left), y:mm(bounds.top-rect.top), width:mm(bounds.width), height:mm(bounds.height), imageReady:!img || img.complete && img.naturalWidth > 0, image:img?.src || '' };
            }) };
          });
          return { calls, media:job.media, patterns:job.plan.pages.map(p=>p.cells.map(c=>c.status==='filled'?'X':' ').join('')), pages,
            pageCss:document.getElementById('click360-print-page-style')?.textContent || '',
            immutable:before===JSON.stringify(template), artworkUnchanged:artwork===JSON.stringify({objects:job.document.objects,style:job.document.style,qrStyle:job.document.qrStyle}), qrSquare:job.document.objects.filter(o=>o.type==='qr').every(o=>o.widthMm===o.heightMm), rotation:job.document.paper.contentRotation };
        } catch (error) { return { error:error.code || error.message, calls }; }
      };
    });
    let ordinal = 0;
    for (const quantity of [1,2,3,4,6,10]) for (const startSlot of [1,2]) for (const rotation of [0,90,180,270]) {
      const scenario = { quantity, startSlot, rotation, gap:ordinal%2 ? 4 : 0, width:[0,100,800][ordinal%3], height:[0,60,90,800][ordinal%4], rows:ordinal%3===2 ? 2 : 1, legacy:ordinal%2===0 };
      const result = await page.evaluate(s=>window.__MVP_PRINT_RUN__(s), scenario);
      assert.equal(result.error, undefined, `${name} ${JSON.stringify(scenario)}: ${result.error}`);
      assert.equal(result.calls, 1); assert.equal(result.immutable, true); assert.equal(result.artworkUnchanged, true); assert.equal(result.qrSquare, true); assert.equal(result.rotation, rotation);
      const expectedWidth = scenario.width === 100 ? 100 : 92, expectedHeight = scenario.rows*(60+scenario.gap);
      assert.deepEqual(result.media, { widthMm:expectedWidth, heightMm:expectedHeight });
      assert.ok(result.pageCss.includes(`@page{size:${expectedWidth}mm ${expectedHeight}mm;margin:0`));
      assert.equal(result.pages.length, Math.ceil((quantity+startSlot-1)/(scenario.rows*2)));
      assert.equal(result.pages.flatMap(p=>p.cells).filter(c=>c.filled).length, quantity);
      for (const physicalPage of result.pages) {
        assert.ok(physicalPage.cells.some(c=>c.filled), 'no blank interleaved page');
        assert.ok(Math.abs(physicalPage.width-expectedWidth)<0.2); assert.ok(Math.abs(physicalPage.height-expectedHeight)<0.2);
        for (const [i,cell] of physicalPage.cells.entries()) {
          assert.ok(Math.abs(cell.x-(i%2 ? 50 : 6))<0.2); assert.ok(Math.abs(cell.y-Math.floor(i/2)*(60+scenario.gap))<0.2);
          assert.ok(cell.x+cell.width<=expectedWidth+0.2); assert.ok(cell.y+cell.height<=expectedHeight+0.2); assert.equal(cell.imageReady,true);
          if (cell.image) cell.pixelHash = createHash('sha256').update(cell.image).digest('hex');
          delete cell.image;
        }
      }
      results.push({ scenario, result });
      if (name==='chromium' && [0,13,26,39,47].includes(ordinal)) {
        const pdfPath = path.join(output,`qty${quantity}-slot${startSlot}-rotation${rotation}.pdf`);
        await page.pdf({ path:pdfPath, preferCSSPageSize:true, printBackground:true });
        const pdf = (await readFile(pdfPath)).toString('latin1');
        const pageCount = [...pdf.matchAll(/\/Type\s*\/Page\b/g)].length;
        assert.equal(pageCount, result.pages.length, 'PDF must have exact page count including no trailing blank page');
        const boxes = [...pdf.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
        assert.ok(boxes.length>0);
        for (const box of boxes) { assert.ok(Math.abs(Number(box[1])*25.4/72-expectedWidth)<0.5); assert.ok(Math.abs(Number(box[2])*25.4/72-expectedHeight)<0.5); }
        results.at(-1).pdf = { path:pdfPath, pageCount, mediaBoxes:boxes.map(b=>b.slice(1)) };
        await page.screenshot({ path:path.join(output,`qty${quantity}-slot${startSlot}-rotation${rotation}.png`), fullPage:true });
      }
      await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
      ordinal++;
    }
    for (const invalid of [{quantity:0,width:0},{quantity:1.5,width:0},{quantity:2,width:40}]) {
      const result = await page.evaluate(s=>window.__MVP_PRINT_RUN__(s), { startSlot:1, rotation:0, gap:4, height:0, rows:1, legacy:true, ...invalid });
      assert.equal(result.calls,0); assert.equal(result.error,invalid.width===40?'label-paper-invalid':'label-quantity-invalid');
      results.push({ invalid, result });
    }
    await page.addScriptTag({ url:`http://127.0.0.1:${port}/qa/fixtures/generated/legacy-label-renderer.bundle.js` });
    for (const width of [0,800]) {
      const catalog = await page.evaluate(async mediaWidthMm => {
        let calls=0; window.print=()=>{calls++;};
        const groups = [{ product:{id:'catalog-a',name:'SYNTHETIC A',code:'QA-A',variant:'RED',price:10,qty:2},copies:1 },{ product:{id:'catalog-b',name:'SYNTHETIC B',code:'QA-B',variant:'BLUE',price:20,qty:3},copies:2 }];
        const result=await window.__CLICK360_LEGACY_RENDERER__.printLabels(groups,{ mediaType:'roll-2',widthMm:40,heightMm:60,columns:2,rows:1,gapXmm:4,gapYmm:4,pitchMm:67,marginLeftMm:6,marginRightMm:2,marginTopMm:13,marginBottomMm:2,mediaWidthMm,mediaHeightMm:90,startSlot:2,dpi:203 },'system');
        return {result,calls,pageCss:document.getElementById('click360-print-page-style')?.textContent,pages:[...document.querySelectorAll('#click360PrintPortal .labelPrintPage')].map(p=>[...p.querySelectorAll('img')].map(i=>({alt:i.alt,ready:i.complete&&i.naturalWidth>0}))) };
      }, width);
      assert.equal(catalog.calls,1); assert.equal(catalog.result.count,3); assert.equal(catalog.result.pages,2); assert.equal(catalog.result.status,'handed_off');
      assert.ok(catalog.pageCss.includes('@page{size:92mm 67mm;margin:0'));
      assert.equal(catalog.pages.flat().filter(i=>i.alt.includes('SYNTHETIC A')).length,1);
      assert.equal(catalog.pages.flat().filter(i=>i.alt.includes('SYNTHETIC B')).length,2);
      assert.ok(catalog.pages.flat().every(i=>i.ready));
      results.push({catalogWidth:width,catalog});
      await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
    }
    assert.deepEqual(errors, []);
    console.log(`COMMERCIAL_MVP_PRINT ${name} PASS:48 canonical +2 catalog handoffs +3 blocked jobs`);
    return { browser:name, pass:true, results };
  } catch (error) { return { browser:name, pass:false, error:error.stack, results }; }
  finally { await browser.close(); }
}
try {
  let ready=false;
  for(let i=0;i<60;i++) { try { if((await fetch(url)).ok) {ready=true;break;} }catch{} await new Promise(r=>setTimeout(r,250)); }
  assert.ok(ready,'local fixture server ready');
  for (const [name,type] of [['chromium',chromium],['webkit',webkit],['firefox',firefox]]) {
    const result=await run(name,type); allResults.push(result);
    if(!result.pass) console.error(result.error);
  }
} finally {
  server.kill('SIGTERM');
  const report={checkedAt:new Date().toISOString(),syntheticOnly:true,physicalCertification:false,pass:allResults.length===3&&allResults.every(r=>r.pass),results:allResults};
  await writeFile(path.join(reportDir,'browser-pdf-after.json'),JSON.stringify(report,null,2)+'\n');
  if(!report.pass) process.exitCode=1;
}
