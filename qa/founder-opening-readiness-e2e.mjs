import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const external = process.env.CLICK360_READINESS_URL || '';
const url = external || 'http://127.0.0.1:4759/index.html';
// Reuse the certified production-shaped synthetic fixture, not client data.
const source = await readFile(path.join(root, 'qa/p0-shary-cash-close-save-rejected-e2e.mjs'), 'utf8');
const factory = source.slice(source.indexOf('function fixtureSource()'), source.indexOf('async function createPage'));
const fixture = new Function(factory.replace(/    const closeButton =[\s\S]*?    return \{ beforeBytes:/, '    return { beforeBytes:') + '; return fixtureSource();')();
const server = external ? null : spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), 'dist', '-p', '4759', '-c-1'], { cwd:root, stdio:'ignore' });
const ctx = { authUid:'synthetic-shary-owner', ownerUid:'synthetic-shary-owner', ownerId:'synthetic-shary-owner', businessId:'synthetic-shary-owner', tenantKey:'owner:synthetic-shary-owner:business:synthetic-shary-owner', schemaVersion:10 };
async function open(engine, profile, directory) {
  const context = await engine.launchPersistentContext(directory, { ...profile, serviceWorkers:'block' });
  if (profile.isMobile) await context.addInitScript(() => {
    Object.defineProperty(navigator,'standalone',{configurable:true,value:true});
    const native=window.matchMedia.bind(window);
    window.matchMedia=query=>query==='(display-mode: standalone)' ? {matches:true,media:query,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}} : native(query);
  });
  // Fixtures intentionally replace only remote transport. Never contact production.
  await context.route(/googleapis\.com|firebaseio\.com|\/__\/auth\//, route => route.abort());
  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => typeof window.click360ApplyTenantState === 'function');
  await page.waitForFunction(() => !['loading','authenticated_resolving'].includes(window.click360GetAccessUiState?.()?.state));
  await page.clock.pauseAt(new Date('2026-09-26T17:45:00Z'));
  return { context, page };
}
async function identity(page, restore = false) {
  return page.evaluate(async ({ctx, restore}) => {
    window.click360SetTenantContext(ctx, { deferLocalLoad:true });
    window.click360User = { uid:ctx.authUid, role:'owner', name:'Synthetic Owner', approved:true, status:'founder_legacy', plan:'founder_legacy', isOwner:true, ownerId:ctx.authUid, manualLimitOverrides:{businesses:1,workers:1,productsActive:600} };
    window.click360AccessState = { mode:'founder_legacy', plan:'founder_legacy', readOnly:false };
    window.click360WriteGate = () => ({ allowed:true });
    window.__cloudPushes = 0;
    window.click360SyncNow = async () => { window.__cloudPushes++; throw new Error('Oversized legacy push forbidden'); };
    window.click360GetSyncState = () => ({ status:'pending_write', blocking:false, cloudCapacityBlocked:window.click360GetCapacityStatus().cloudCapacityBlocked });
    window.click360RecordTelemetry = async () => {};
    await window.click360PrepareTenantStorage(ctx);
    const restored = restore ? await window.click360LoadIndexedTenantCache(ctx) : false;
    document.getElementById('click360-auth-gate')?.remove();
    return restored;
  }, {ctx, restore});
}
const results = [];
try {
  for (let i=0;i<60;i++) { try { if ((await fetch(url)).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,250)); }
  for (const [name, engine, profile] of [['WebKit iPhone PWA',webkit,devices['iPhone 15']], ['Chromium mobile',chromium,devices['Pixel 7']], ['Chromium desktop',chromium,{}]]) {
    for (const bytes of [860000,900000,Math.round(1.2*1024*1024),3*1024*1024,7*1024*1024,8*1024*1024+1000]) {
      const directory = await mkdtemp(path.join(os.tmpdir(),'click360-opening-'));
      let {context,page} = await open(engine,profile,directory);
      await page.evaluate(fixture, { targetBytes:bytes });
      // Remove only the synthetic fixture's historical open session. Its
      // historical sale/movement/stock remain intact throughout the new opening.
      const before = await page.evaluate(() => {
        const state = window.click360GetTenantState();
        state.businesses.push({id:'synthetic-secondary',name:'Secondary synthetic business',status:'activo',type:'ropa',settings:{timeZone:'America/Guayaquil'}});
        state.cashSessions.find(s=>s.id==='cash-0903').status='closed';
        window.click360ApplyTenantState(state,window.click360TenantContext);
        return {products:state.products,sales:state.sales,movements:state.movements,closed:state.dailyReports};
      });
      // Identity reset is intentional, then install the retained fixture.
      const state = await page.evaluate(() => window.click360GetTenantState());
      await identity(page);
      await page.evaluate(state => { window.click360ApplyTenantState(state,window.click360TenantContext); window.click360Route('cash'); },state);
      await page.locator('#apertureAmountInput').fill('0');
      await page.locator('#startDayBtnCash').evaluate(button=>button.click());
      await page.waitForFunction(() => !window.click360GetCapacityStatus().deviceSavePending);
      const after = await page.evaluate(() => ({ state:window.click360GetTenantState(), readiness:window.click360GetClientReadiness(), failure:window.click360LastSaveFailure, pushes:window.__cloudPushes }));
      assert.deepEqual(after.state.products,before.products); assert.deepEqual(after.state.sales,before.sales); assert.deepEqual(after.state.dailyReports,before.closed);
      assert.equal(after.pushes,0);
      assert.deepEqual(after.readiness.effectiveLimits,{businesses:2,workers:2,productsActive:2000});
      if (bytes>8*1024*1024) {
        assert.equal(after.failure.code,'local_state_too_large');
        assert.equal(after.state.cashSessions.filter(s=>s.status==='open').length,0);
        assert.deepEqual(after.state.movements,before.movements);
        await context.close();
      } else {
        assert.equal(after.failure,null);
        const session = after.state.cashSessions.find(s=>s.status==='open');
        assert(session); assert.equal(session.openingAmount,0);
        assert.deepEqual(after.state.movements.slice(0,-1),before.movements);
        assert.equal(after.state.movements.at(-1).cashSessionId,session.id);
        assert.equal(after.readiness.cloudCapacityBlocked,true);
        assert.equal(after.readiness.indexedDbAvailable,true);
        assert.equal(after.readiness.pendingOperations,1);
        await page.evaluate(()=>window.click360Route('backup'));
        assert.equal(await page.getByText('Nube sincronizada',{exact:false}).count(),0);
        // Fully close the browser process and reopen the same persistent profile.
        await context.close();
        ({context,page}=await open(engine,profile,directory));
        assert.equal(await identity(page,true),true);
        const cold = await page.evaluate(()=>({state:window.click360GetTenantState(),capacity:window.click360GetCapacityStatus()}));
        assert.equal(cold.state.cashSessions.find(s=>s.id===session.id)?.status,'open');
        assert.deepEqual(cold.state.products,before.products); assert.deepEqual(cold.state.sales,before.sales);
        assert.equal(cold.capacity.cloudCapacityBlocked,true);
        await context.close();
      }
      results.push({platform:name,bytes,result:'PASS'});
      console.log(`PASS actual cash opening $0 / full browser cold restart: ${name} ${bytes}`);
    }
  }
  await mkdir(path.join(root,'output/playwright'),{recursive:true});
  await writeFile(path.join(root,'output/playwright/founder-opening-readiness.json'),JSON.stringify({url,results},null,2));
} finally { server?.kill('SIGTERM'); }
