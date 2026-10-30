import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, webkit, devices } from 'playwright';
import {observeWorkerUpdate} from './service-worker-update-observer.mjs';
import '../qa-service-worker-update-observer.mjs';
import {createEmulatorIsolation} from './emulator-network-isolation.mjs';

const root=path.resolve(import.meta.dirname,'..');
const oldRoot=process.env.CLICK360_OLD_BUILD_DIR;
assert(oldRoot,'Set CLICK360_OLD_BUILD_DIR to a preserved real old static build');
const manifest=JSON.parse(await readFile(path.join(root,'dist/release-manifest.json')));
let active=oldRoot;
let corrupt=false;
const server=createServer(async(req,res)=>{
  try {
    const pathname=new URL(req.url,'http://localhost').pathname;
    const entry=pathname==='/'?'index.html':pathname.slice(1);
    if(entry.includes('..'))throw Error('Invalid path');
    const content=await readFile(path.join(active,entry));
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type',entry.endsWith('.js')?'application/javascript':entry.endsWith('.json')?'application/json':entry.endsWith('.html')?'text/html':entry.endsWith('.css')?'text/css':'application/octet-stream');
    res.end(corrupt&&entry==='tenant-quota-overrides.js'?Buffer.from('/* mixed asset */'):content);
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const results=[];
try {
  for(const [name,engine,options] of [['Chromium PWA',chromium,devices['Pixel 7']],['WebKit PWA',webkit,devices['iPhone 15']]]){
    active=oldRoot; corrupt=false;
    const profile=await mkdtemp(path.join(os.tmpdir(),'click360-upgrade-profile-'));
    let isolation,context;
    try{
      isolation=await createEmulatorIsolation([new URL(url).origin]);
      // The historical worker itself forwards cross-origin fetches. Page
      // routing cannot intercept that traffic; an external WebChannel can
      // retain the old worker while the new worker waits to activate. Reuse
      // the process-owned proxy so BOTH page and worker remain loopback-only.
      const launch=()=>engine.launchPersistentContext(profile,{...options,proxy:{server:isolation.server}});
      context=await launch();
      let page=context.pages()[0]||await context.newPage();
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.CLICK360_V16_STORAGE);
      await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
      await page.reload();
      await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.CLICK360_V16_STORAGE);
      const identity={authUid:'upgrade-owner',ownerId:'upgrade-owner',businessId:'upgrade-business',tenantKey:'upgrade-owner:upgrade-business'};
      const beforeRecord = await page.evaluate(async ctx=>{
        localStorage.setItem('qa-valid-local','retain-me');
        await window.CLICK360_V16_STORAGE.putSnapshot(ctx,{products:[{id:'p',stock:4,qty:4}],padding:'x'.repeat(900000)},
          {cloudCapacityBlocked:true,pendingRemoteSync:true,operationId:'pending-opening',pendingOperations:['pending-opening'],deviceRevision:'pending-opening'});
        location.hash='#cash'; // Existing automatic update must not reload a working form.
        return window.CLICK360_V16_STORAGE.getSnapshot(ctx);
      },identity);
      active=path.join(root,'dist'); corrupt=true;
      const first=await page.evaluate(observeWorkerUpdate,{mode:'rejected',expectedBuild:manifest.buildSha});
      assert.equal(first.status,'rejected','mixed release must fail installation, preserving old worker');
      assert.equal(await page.evaluate(()=>localStorage.getItem('qa-valid-local')),'retain-me');
      corrupt=false;
      const installed=await page.evaluate(observeWorkerUpdate,{mode:'installed',expectedBuild:manifest.buildSha});
      assert.equal(installed.buildSha,manifest.buildSha);
      assert(['installed','activated'].includes(installed.status),'Only a fully installed verified release can proceed to normal reopen');
      assert.equal(await page.evaluate(()=>location.hash),'#cash');
      // Preserve the original cash document while its replacement installs.
      // Then exercise an actual browser/PWA close and reopen of the SAME
      // native profile, not a timer or forced worker activation over a form.
      await context.close();context=await launch();
      page=context.pages()[0]||await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.click360GetClientReadiness);
      const activated=await page.evaluate(observeWorkerUpdate,{mode:'activated',expectedBuild:manifest.buildSha});
      assert.equal(activated.status,'activated');assert.equal(activated.buildSha,manifest.buildSha);
      // Repeat only observation of an already-current registration: there is
      // no new updatefound event, yet the ACTIVE worker must prove its build.
      const current=await page.evaluate(observeWorkerUpdate,{mode:'activated',expectedBuild:manifest.buildSha});
      assert.equal(current.buildSha,manifest.buildSha);
      await page.close();
      page=await context.newPage(); await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.click360GetClientReadiness);
      const evidence=await page.evaluate(async ctx=>{
        const cacheKeys=await caches.keys();
        const records=await window.CLICK360_V16_STORAGE.getSnapshot(ctx);
        return {cacheKeys,records,local:localStorage.getItem('qa-valid-local'),build:window.click360GetClientReadiness().buildSha};
      },identity);
      assert.equal(evidence.build,manifest.buildSha);
      assert.equal(evidence.local,'retain-me');
      assert.equal(evidence.records.snapshot.products[0].stock,4);
      assert.deepEqual(evidence.records,beforeRecord,'upgrade must retain EVERY field written by the actual old schema');
      assert.equal(evidence.records.pendingRemoteSync,true);
      assert.equal(evidence.records.operationId,'pending-opening');
      assert(evidence.cacheKeys.some(key=>key.endsWith(manifest.buildSha)));
      results.push({name,from:JSON.parse(await readFile(path.join(oldRoot,'release-manifest.json'))).buildSha,to:manifest.buildSha,nativeProfileRestart:true,result:'PASS'});
      console.log(`PASS ${name}: real old build -> certified release, mixed install rejected, IDB/LS/outbox retained`);
    }finally{await context?.close();await isolation?.close();}
  }
  await mkdir(path.join(root,'output/playwright'),{recursive:true});
  await writeFile(path.join(root,'output/playwright/founder-pwa-upgrade.json'),JSON.stringify(results,null,2));
}finally{await new Promise(resolve=>server.close(resolve));}
