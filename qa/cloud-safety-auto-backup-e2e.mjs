import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit,firefox,devices} from 'playwright';
import {largeTenantData,stateDocument,accountAccess} from './r38-emulator-support.mjs';
import '../cloud-safety-backup.js';
const projectId='demo-click360-safety',root=path.resolve('dist');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:58080');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:59099');
const requireFunctions=createRequire(new URL('../functions/package.json',import.meta.url));
const admin=requireFunctions('firebase-admin/app'),firestore=requireFunctions('firebase-admin/firestore');
const adminApp=admin.initializeApp({projectId},'synthetic-safety-auto-browser'),db=firestore.getFirestore(adminApp);
const api=globalThis.CLICK360_CLOUD_SAFETY;
const server=createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://127.0.0.1').pathname;
    const file=path.resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
    if(!file.startsWith(`${root}/`)){res.writeHead(403).end();return;}
    const mime=file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.json')||file.endsWith('.webmanifest')?'application/json':'application/octet-stream';
    res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-store');res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  for(const [name,engine,options] of [['iPhone WebKit',webkit,devices['iPhone 15']],['Chromium mobile',chromium,devices['Pixel 7']],['Chromium desktop',chromium,{}],['Firefox desktop',firefox,{}]]){
    const email=`safety-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`,password='Synthetic-emulator-only-123!';
    const signup=await fetch('http://127.0.0.1:59099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
    const credentials=await signup.json();assert(signup.ok&&credentials.localId);
    const owner=credentials.localId,initial=largeTenantData(owner),legacy=stateDocument(owner,42,initial);
    await db.doc(`approvedUsers/${owner}`).set({uid:owner,email,name:'Synthetic QA owner',ownerId:owner,role:'owner',isOwner:true,status:'active',approved:true});
    await db.doc(`accountAccess/${owner}`).set({...accountAccess(owner),email,manualLimitOverrides:{businesses:1,workers:1,productsActive:600}});
    await db.doc(`businesses/${owner}/state/main`).set(legacy);
    const browser=await engine.launch();
    try{
      const context=await browser.newContext(options);
      const network={callableRequests:0,callableResponses:[],failures:[]};
      context.on('request',request=>{if(request.url().endsWith('/finalizeCloudSafetyBackup'))network.callableRequests++;});
      context.on('response',response=>{if(response.url().endsWith('/finalizeCloudSafetyBackup'))network.callableResponses.push(response.status());});
      context.on('requestfailed',request=>{network.failures.push({host:new URL(request.url()).host,method:request.method(),error:request.failure()?.errorText});});
      await context.addInitScript(({projectId})=>{
        // Service-worker-controlled requests bypass Playwright routing. Bind
        // ONLY this fixed demo callable to its real loopback Functions server;
        // no response mocking, credentials substitution or production fallback.
        const nativeFetch=window.fetch.bind(window);
        const demoCallable=`https://us-central1-${projectId}.cloudfunctions.net/finalizeCloudSafetyBackup`;
        window.fetch=(input,options)=>nativeFetch(input===demoCallable?`http://127.0.0.1:55001/${projectId}/us-central1/finalizeCloudSafetyBackup`:input,options);
        let namespace;
        Object.defineProperty(window,'firebase',{configurable:true,get:()=>namespace,set:value=>{
          namespace=value;if(!value||value.__safetyPatched)return;value.__safetyPatched=true;
          const initialize=value.initializeApp.bind(value);
          value.initializeApp=(_config,name)=>{
            const app=initialize({apiKey:'fake-api-key',projectId,authDomain:`${projectId}.firebaseapp.com`,appId:'1:1:web:synthetic'},name);
            app.auth().useEmulator('http://127.0.0.1:59099',{disableWarnings:true});
            // The test's HTTP interception buffers streaming WebChannel replies.
            // Use the documented polling transport only in this emulator fixture.
            app.firestore().settings({experimentalForceLongPolling:true});
            app.firestore().useEmulator('127.0.0.1',58080);return app;
          };
        }});
      },{projectId});
      await context.route('**/*',async route=>{
        const url=route.request().url();
        if(url.startsWith('http://127.0.0.1:')||url.startsWith('data:'))return route.continue();
        return route.abort();
      });
      let page=await context.newPage();const url=`http://127.0.0.1:${server.address().port}/`;
      await page.goto(url);
      await page.waitForFunction(()=>window.click360Auth?.signInWithEmailAndPassword,null,{timeout:60000});
      await page.evaluate(({email,password})=>window.click360Auth.signInWithEmailAndPassword(email,password),{email,password});
      await page.waitForFunction(()=>window.click360TenantContext&&window.click360GetTenantState?.()?.products?.length===436,null,{timeout:60000});
      await page.evaluate(()=>navigator.serviceWorker.ready);
      await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
      const fixture=await page.evaluate(async()=>{
        const ctx=window.click360TenantContext,storage=window.CLICK360_V16_STORAGE;
        const existing=await storage.getSnapshot(ctx),snapshot=structuredClone(window.click360GetTenantState());
        snapshot.settings.padding='x'.repeat(1200000);
        snapshot.products[0].stock-=1;snapshot.products[0].qty=snapshot.products[0].stock;
        snapshot.sales.push({id:'local-only-historical-sale',operationId:'local-only-op',businessId:snapshot.activeBusinessId,total:30,date:'2026-09-03',items:[]});
        snapshot.movements.push({id:'local-only-movement',operationId:'local-only-op',businessId:snapshot.activeBusinessId,saleId:'local-only-historical-sale',amount:30});
        await storage.putSnapshot(ctx,snapshot,{cloudCapacityBlocked:true,pendingRemoteSync:true,expectedDeviceRevision:existing?.deviceRevision||'',deviceRevision:'local-only-op',pendingOperations:['local-only-op','unknown-not-replayed'],baseRevision:42});
        return {ctx,stock:snapshot.products[0].stock,sales:snapshot.sales.length,movements:snapshot.movements.length};
      });
      // Existing device-only operations are protected without a new user action.
      await page.close();page=await context.newPage();await page.goto(url);
      // Pause connectivity before the automatic upload, then recover without
      // commercial replay, a new mutation, or deleting any device storage.
      await context.setOffline(true);
      const offlineRecord=await page.evaluate(ctx=>window.CLICK360_V16_STORAGE.getSnapshot(ctx),fixture.ctx);
      assert.equal(offlineRecord.snapshot.products[0].stock,fixture.stock);
      assert.deepEqual(offlineRecord.pendingOperations,['local-only-op','unknown-not-replayed']);
      await context.setOffline(false);
      try{await page.waitForFunction(()=>window.click360CloudSafetyStatus?.status==='CONFIRMED',null,{timeout:90000});}
      catch(error){
        console.log('BACKUP TRANSPORT',JSON.stringify(network));
        const backups=await db.collection(`businesses/${owner}/safetyBackups`).get();
        console.log('SERVER BACKUP PROGRESS',JSON.stringify(await Promise.all(backups.docs.map(async doc=>({status:doc.data().status,parts:(await doc.ref.collection('parts').get()).size,expected:doc.data().partCount})))));
        console.log('AUTOMATIC BACKUP FAILURE',JSON.stringify(await page.evaluate(async()=>{
          const ctx=window.click360TenantContext,record=ctx?await window.CLICK360_V16_STORAGE.getSnapshot(ctx):null;
          return {status:window.click360CloudSafetyStatus,runner:window.click360GetCloudSafetyHealth?.(),capacity:window.click360GetCapacityStatus?.(),
            contextReady:!!ctx,authReady:!!window.firebase.auth().currentUser,ownerMatches:window.firebase.auth().currentUser?.uid===ctx?.ownerId,
            durablePresent:!!record,durableBlocked:record?.cloudCapacityBlocked,pendingCount:record?.pendingOperations?.length,
            firestoreHost:window.firebase.firestore()._delegate?._settings?.host,
            recordOwnerPresent:!!record?.ownerId,snapshotIdentityPresent:!!record?.snapshot?.identity,
            online:navigator.onLine,buildSha:window.CLICK360_RUNTIME_GUARD?.getReleaseMetadata?.().buildSha};
        })));
        throw error;
      }
      const captured=await page.evaluate(async ctx=>({record:await window.CLICK360_V16_STORAGE.getSnapshot(ctx),status:window.click360CloudSafetyStatus,limits:window.click360GetClientReadiness?.().effectiveLimits,mixed:window.click360IsMixedBuild?.()}),fixture.ctx);
      assert.equal(captured.mixed,false);assert.equal(captured.limits.productsActive,2000);
      assert.equal(captured.record.snapshot.products[0].stock,fixture.stock);
      assert.equal(captured.record.pendingOperations.length,2);
      const backupRef=db.doc(`businesses/${owner}/safetyBackups/${captured.status.backupId}`),manifest=(await backupRef.get()).data();
      assert.equal(manifest.status,'COMPLETE');
      const rebuilt=await api.reconstruct(manifest,(await backupRef.collection('parts').get()).docs.map(d=>d.data()));
      assert.deepEqual(rebuilt,captured.record);
      assert.equal(rebuilt.snapshot.sales.filter(s=>s.id==='local-only-historical-sale').length,1);
      const remote=(await db.doc(`businesses/${owner}/state/main`).get()).data().payload.data;
      assert.equal(remote.sales.filter(s=>s.id==='local-only-historical-sale').length,0,'Safety archive never replays a local sale into legacy');
      assert.equal(remote.products[0].stock,initial.products[0].stock);
      await page.close();page=await context.newPage();await page.goto(url);
      try{await page.waitForFunction(()=>window.click360CloudSafetyStatus?.status==='CONFIRMED',null,{timeout:90000});}
      catch(error){
        console.log('SECOND COLD START FAILURE',JSON.stringify(await page.evaluate(async()=>{
          const ctx=window.click360TenantContext,storage=window.CLICK360_V16_STORAGE;
          const record=ctx?await storage.getSnapshot(ctx):null;
          return {status:window.click360CloudSafetyStatus,runner:window.click360GetCloudSafetyHealth?.(),capacity:window.click360GetCapacityStatus?.(),
            authReady:!!window.firebase.auth().currentUser,durablePresent:!!record,durableBlocked:record?.cloudCapacityBlocked,
            pendingCount:record?.pendingOperations?.length,safety:ctx?await storage.getSafetyMetadata(ctx):null};
        })));
        throw error;
      }
      assert.equal((await db.collection(`businesses/${owner}/safetyBackups`).get()).size,1,'Cold restart does not duplicate an unchanged capture');
      console.log(`PASS ${name}: actual served build automatic existing-state backup, offline/reconnect, durable cold restart, server reconstruction equality, Founder 600→2000, local-only sale/stock/outbox preserved; no commercial replay`);
    }finally{await browser.close();}
  }
}finally{await new Promise(resolve=>server.close(resolve));await db.terminate();await admin.deleteApp(adminApp);}
