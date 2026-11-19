// Native IndexedDB and localStorage, with synthetic read-only Firestore responses.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {_android, chromium, webkit} from 'playwright';

const requested=process.argv[2];
assert(!requested||['chromium','webkit','android'].includes(requested),'Use a local browser or the isolated Android emulator');
const android=requested==='android';
const files=['spark-modular-migration.js','spark-modular-recovery.js','v16-storage.js','spark-migration-bootstrap.js'];
const sources=await Promise.all(files.map(file=>readFile(file,'utf8')));
const baseline=execFileSync('git',['show','470456c28bb7d09d26c73cd331cbe9ca8971ec83:spark-migration-bootstrap.js'],{encoding:'utf8'});

for(const name of requested?[requested]:['chromium','webkit']){
  const device=android?(await _android.devices()).find(d=>d.serial()==='emulator-5554'):null;
  if(android)assert(device,'Isolated Android emulator not connected');
  const browser=android?null:await (name==='chromium'?chromium:webkit).launch();
  const origin='https://secondary-handoff.example.test';
  try{
    const context=android?await device.launchBrowser():await browser.newContext();
    try{
      await context.route(origin+'/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Secondary handoff</title>'}));
      const page=await context.newPage();
      await page.goto(origin);
      for(const content of [...sources.slice(0,-1),baseline])await page.addScriptTag({content});
      await page.evaluate(async()=>{
        const owner='synthetic-secondary-owner',business='synthetic-retail',b='aaaaaaaaaaaa',projectId='click-360';
        const identity={ownerUid:owner,ownerId:owner,businessId:owner,tenantKey:`owner:${owner}:business:${owner}`,schemaVersion:10};
        const tenant={...identity,authUid:owner};
        const data={businesses:[{id:business}],products:[{id:'confirmed-product',businessId:business}]};
        const snapshot={...data,identity};
        const api=CLICK360_SPARK_MIGRATION,remoteHash=await api.hash(data),sourceHash=await api.hash({...snapshot,sales:[]});
        const control={ownerUid:owner,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',
          recordVersion:5,remoteRevision:2,sourceHash,reconstructedHash:sourceHash,remoteHash,
          businessIds:[business],buildSha:'2875f6e7496f',sourceDeviceId:'original-apple'};
        window.CLICK360_FIREBASE_CONFIG={projectId};
        window.click360Auth={currentUser:{uid:owner}};
        window.CLICK360_RELEASE_ASSETS=Object.fromEntries(['app.js','firebase-service.js','v16-storage.js','modular-operation-journal.js',
          'spark-modular-migration.js','spark-modular-reconciliation.js','spark-modular-recovery.js','spark-modular-importer.js',
          'spark-modular-record-codec.js','spark-modular-handoff.js','spark-migration-bootstrap.js'].map(file=>[file,b]));
        const docs={
          [`businesses/${owner}/metadata/storage`]:control,
          [`businesses/${owner}/state/main`]:{revision:2,payload:{identity,data}},
          [`businesses/${owner}/storageApprovals/runtimePreparation`]:{captureHash:'f'.repeat(64)},
          'storageRollout/sparkV1':{enabled:true,operationalAccess:true,automaticCutover:true,pilotOwnerUids:[owner]},
          [`accountAccess/${owner}`]:{plan:'founder_legacy'}
        };
        const db={app:{options:{projectId}},doc:path=>({get:async({source})=>{
          if(source!=='server')throw Error('EXPECTED_SERVER_READ');
          return {data:()=>structuredClone(docs[path]),exists:Object.hasOwn(docs,path),metadata:{fromCache:false,hasPendingWrites:false}};
        }})};
        await CLICK360_V16_STORAGE.putSnapshot(tenant,snapshot,{source:'local_change',pendingRemoteSync:true,deviceRevision:'old-receipt'});
        const before=await CLICK360_V16_STORAGE.getSnapshot(tenant);
        localStorage.setItem('synthetic-legacy-cache',JSON.stringify(snapshot));
        window.FIXTURE={tenant,before,business,options:{db,ownerUid:owner,actorUid:owner,buildSha:b,projectId,
          resolveUser:()=>click360Auth.currentUser,resolveContext:()=>tenant,leaseHeld:()=>true,
          readLocal:()=>CLICK360_V16_STORAGE.getSnapshot(tenant),
          readSecondaryCache:options=>options?.allowUnconfirmedReceipt===true
            ?{primary:localStorage.getItem('synthetic-legacy-cache'),older:null,metadata:'synthetic unconfirmed receipt'}:null}};
        window.CLICK360_MODULAR_JOURNAL={open:async()=>({
          assertOwnerCoverage:async()=>({enumerationComplete:true,recordCount:0}),close(){}})};
        try{await CLICK360_SPARK_MIGRATION_BOOTSTRAP.create(FIXTURE.options).verifyLocalHandoff();}
        catch(error){if(error.message==='SPARK_LOCAL_HANDOFF_PIN_REQUIRED')return;throw error;}
        throw Error('BASELINE_BLOCK_NOT_REPRODUCED');
      });
      await page.addScriptTag({content:sources.at(-1)});
      await page.evaluate(async()=>{
        const {tenant,before,business,options}=FIXTURE,api=CLICK360_SPARK_MIGRATION;
        const proof=await CLICK360_SPARK_MIGRATION_BOOTSTRAP.create(options).verifyLocalHandoff();
        if(proof.status!=='SECONDARY_CACHE_PRESERVED')throw Error('VERIFY_SECONDARY_FAILED');
        const candidate={identity:before.snapshot.identity,businesses:[{id:business}],products:[]};
        await CLICK360_V16_STORAGE.promoteVerifiedSnapshot(tenant,candidate,
          {verifiedLocalHandoff:proof,source:'spark_operational_candidate',deviceRevision:'modular',expectedDeviceRevision:before.deviceRevision});
        const installed=await CLICK360_V16_STORAGE.getSnapshot(tenant);
        const archive=await new Promise((resolve,reject)=>{
          const open=indexedDB.open('CLICK360_V16_DB');
          open.onerror=()=>reject(open.error);
          open.onsuccess=()=>{
            const db=open.result,tx=db.transaction('tenantSnapshots','readonly');
            const request=tx.objectStore('tenantSnapshots').get(`legacy-archive:${installed.id}:${installed.legacyArchiveHash}`);
            tx.oncomplete=()=>{db.close();resolve(request.result);};
            tx.onabort=()=>{db.close();reject(tx.error);};
          };
        });
        if(installed.source!=='spark_operational_candidate'||await api.hash(archive.content.record)!==await api.hash(before)
          ||await api.hash(archive.content)!==installed.legacyArchiveHash
          ||archive.content.localStorageCopy.primary!==localStorage.getItem('synthetic-legacy-cache'))
          throw Error('SECONDARY_ARCHIVE_INVALID');
      });
      console.log(`PASS ${name} secondary device, prior PIN_REQUIRED reproduced and local cache archived`);
    }finally{await context.close();}
  }finally{await browser?.close();await device?.close();}
}
