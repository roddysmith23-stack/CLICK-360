import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, webkit, devices } from 'playwright';

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
    const browser=await engine.launch();
    try{
      const context=await browser.newContext(options);
      await context.route(/googleapis\.com|firebaseio\.com|\/__\/auth\//,route=>route.abort());
      let page=await context.newPage();
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
      const first=await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();return new Promise(resolve=>{
        const timeout=setTimeout(()=>resolve('timeout'),30000);
        reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker.addEventListener('statechange',()=>{if(worker.state==='redundant'){clearTimeout(timeout);resolve('rejected');}});},{once:true});
        reg.update().catch(()=>{clearTimeout(timeout);resolve('rejected');});
      });});
      assert.equal(first,'rejected','mixed release must fail installation, preserving old worker');
      assert.equal(await page.evaluate(()=>localStorage.getItem('qa-valid-local')),'retain-me');
      corrupt=false;
      const activation=await page.evaluate(async expectedSha=>{
        const reg=await navigator.serviceWorker.getRegistration();
        // Reproduce an update that already started (e.g. automatic update).
        // A listener for FUTURE updatefound alone misses this worker entirely.
        let startTimer,onFound,rejectStart,updateFoundBeforeListener=false;
        const started=new Promise((resolve,reject)=>{
          rejectStart=reject;
          onFound=()=>{updateFoundBeforeListener=true;resolve();};reg.addEventListener('updatefound',onFound,{once:true});
          startTimer=setTimeout(()=>reject(Error('update did not start')),30000);
          if(reg.installing&&reg.installing.state!=='redundant')resolve();
        });
        const update=reg.update();
        update.catch(rejectStart);
        try{await started;}finally{clearTimeout(startTimer);reg.removeEventListener('updatefound',onFound);}
        const existing=reg.installing||reg.waiting||reg.active;
        const initialState=existing?.state;
        await new Promise((resolve,reject)=>{
          const tracked=new Map();let finished=false;
          const finish=(error)=>{
            if(finished)return;finished=true;clearTimeout(timer);
            reg.removeEventListener('updatefound',found);
            navigator.serviceWorker.removeEventListener('message',message);
            for(const [worker,listener]of tracked)worker.removeEventListener('statechange',listener);
            error?reject(error):resolve();
          };
          const message=event=>{
            if(event.data?.type==='CLICK360_RELEASE_STATUS'&&event.data.buildSha===expectedSha
              &&event.source===reg.active&&reg.active?.state==='activated')finish();
          };
          const track=worker=>{
            if(!worker||tracked.has(worker))return;
            const state=()=>{
              if(worker.state==='activated')worker.postMessage({type:'CLICK360_RELEASE_STATUS'});
              else if(worker.state==='redundant')finish(Error('new release worker rejected'));
            };
            tracked.set(worker,state);worker.addEventListener('statechange',state);state();
          };
          const found=()=>track(reg.installing);
          const timer=setTimeout(()=>finish(Error(`activation timeout: ${JSON.stringify({initialState,installing:reg.installing?.state,waiting:reg.waiting?.state,active:reg.active?.state})}`)),30000);
          navigator.serviceWorker.addEventListener('message',message);
          reg.addEventListener('updatefound',found);
          track(existing);
          update.then(()=>track(reg.installing||reg.waiting||reg.active),finish);
        });
        return {initialState,existingWorkerHandled:!!existing,updateFoundBeforeListener,confirmedSha:expectedSha};
      },manifest.buildSha);
      assert.equal(activation.existingWorkerHandled,true);
      assert.equal(activation.confirmedSha,manifest.buildSha,'activation requires the exact new worker, never the old active worker');
      assert.equal(await page.evaluate(()=>location.hash),'#cash');
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
      results.push({name,from:JSON.parse(await readFile(path.join(oldRoot,'release-manifest.json'))).buildSha,to:manifest.buildSha,activation,result:'PASS'});
      console.log(`PASS ${name}: real old build -> certified release, mixed install rejected, IDB/LS/outbox retained`);
    }finally{await browser.close();}
  }
  await mkdir(path.join(root,'output/playwright'),{recursive:true});
  await writeFile(path.join(root,'output/playwright/founder-pwa-upgrade.json'),JSON.stringify(results,null,2));
}finally{await new Promise(resolve=>server.close(resolve));}
