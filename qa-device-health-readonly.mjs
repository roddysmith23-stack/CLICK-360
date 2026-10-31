import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const source=await readFile('device-health-readonly.js','utf8');
const reviewedBuild='a'.repeat(12);
const results=[];
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch();
 try{for(const scenario of ['clean','confirmed_one','tail_unknown','queued','projection','hash_corrupt','rejected_status','old_build','missing_worker_build','gate_denied','no_writer','context_change','not_standalone','old_schema','missing_database','worker_context','changed_journal','owner_replaced','missing_release','wrong_business']){
  const context=await browser.newContext();
  try{
   const page=await context.newPage();
   await page.route('https://readonly-health.example.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated read-only health fixture</title>'}));
   await page.goto('https://readonly-health.example.test/');
   const baseline=await page.evaluate(async({scenario,reviewedBuild})=>{
    const owner='PRIVATE_OWNER_NEVER_EMIT',business='PRIVATE_BUSINESS_NEVER_EMIT';
    const canonical=v=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):Array.isArray(v)?v.map(canonical):v;
    const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical(v)))))].map(b=>b.toString(16).padStart(2,'0')).join('');
    window.FIXTURE_DB=null;
    if(scenario!=='missing_database'){
     const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('click360-modular-outbox-v1',scenario==='old_schema'?4:5);
      q.onupgradeneeded=()=>q.result.createObjectStore('operations',{keyPath:'key'});q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
     const rows=[];
     const n=scenario==='tail_unknown'?1001:['confirmed_one','queued','projection','hash_corrupt'].includes(scenario)?1:0;
     for(let i=0;i<n;i++){
      const payload={actorUid:owner,kind:'sale',notes:'PRIVATE_COMMERCIAL_CONTENT_MUST_NOT_EMIT'},id=`real-shape-${i}`;
      const state=scenario==='tail_unknown'&&i===1000?'unknown':scenario==='queued'?'queued':'confirmed';
      const biz=scenario==='tail_unknown'&&i===1000?'PRIVATE_SECOND_BUSINESS':business;
      rows.push({key:`${owner}:${biz}:${id}`,ownerUid:owner,businessId:biz,operationId:id,actorUid:owner,payload,
       schemaVersion:1,payloadHash:scenario==='hash_corrupt'?'0'.repeat(64):await hash(payload),revision:1,state,
       projectionState:scenario==='projection'?'pending':'complete',createdAt:i,attempts:0});
     }
     const foreign={key:'FOREIGN:BUSINESS:OTHER',ownerUid:'FOREIGN',businessId:'BUSINESS',operationId:'OTHER',payload:{secret:'FOREIGN_TOKEN_MUST_NOT_EMIT'}};
     rows.push(foreign);
     await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readwrite');for(const row of rows)tx.objectStore('operations').put(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
     db.close();
    }
    const user={uid:owner};window.click360Auth={currentUser:user};window.click360User={uid:owner,ownerId:owner,role:scenario==='worker_context'?'cashier':'owner'};
    if(scenario==='worker_context')window.click360Auth.currentUser={uid:'WORKER'};
    window.click360GetActiveBusinessId=()=>scenario==='wrong_business'?'OTHER_BUSINESS':business;
    window.click360TenantContext={authUid:owner};
    Object.defineProperty(navigator,'standalone',{value:scenario!=='not_standalone',configurable:true});
    window.CLICK360_RELEASE_ASSETS={'device-health-readonly.js':scenario==='missing_release'?null:reviewedBuild,'app.js':scenario==='old_build'?'9175df8de2dd':reviewedBuild};window.click360ServiceWorkerRelease={buildSha:scenario==='missing_worker_build'?null:reviewedBuild};
    window.click360StartupDiagnostic={phase:'READY'};window.click360SparkBootstrapState={phase:'READY',operationalCloudConfirmed:true};window.click360AccessUiState={state:'ready'};
    window.click360SparkCoordinator={phase:()=> 'READY',isBusy:()=>false};window.click360IsMixedBuild=()=>false;
    window.click360GetSyncStatus=()=>({status:scenario==='rejected_status'?'modular_pending':'modular_confirmed',operationalCloudConfirmed:scenario!=='rejected_status',deviceId:'PRIVATE_DEVICE_MUST_NOT_EMIT'});
    window.click360SparkMutationGate=()=>({allowed:scenario!=='gate_denied',reason:scenario==='gate_denied'?owner:'modular_access_verified'});
    window.click360SparkOperationalSession={identity:{ownerUid:owner,businessId:business,tenantKey:`owner:${owner}:business:${business}`},isBusy:()=>false,
     health:async()=>{if(scenario==='context_change')window.click360Auth.currentUser={uid:owner};
      if(scenario==='owner_replaced')window.click360User={...window.click360User};
      if(scenario==='changed_journal'){const db=await new Promise(resolve=>{const r=indexedDB.open('click360-modular-outbox-v1');r.onsuccess=()=>resolve(r.result);});
       const original=window.READONLY_ORIGINAL_TRANSACTION;await new Promise(resolve=>{const tx=original.call(db,'operations','readwrite');tx.objectStore('operations').put({key:`${owner}:${business}:new-op`,ownerUid:owner,businessId:business,operationId:'new-op',actorUid:owner,revision:1,state:'unknown',schemaVersion:1,payload:{actorUid:owner,kind:'sale'},payloadHash:'0'.repeat(64)});tx.oncomplete=resolve;});db.close();}
      return {pendingCount:scenario==='queued'?1:0,unknownCount:0,projectionPendingCount:scenario==='projection'?1:0,countIsBounded:false,activeRequests:0};}};
    if(scenario==='no_writer')window.click360SparkOperationalSession=null;
    localStorage.setItem('legacy-marker','real_conflict');
    window.captureRaw=async()=>{
     const exists=(await indexedDB.databases()).find(d=>d.name==='click360-modular-outbox-v1');
     if(!exists)return {databases:[],rows:[]};
     const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(exists.name);r.onupgradeneeded=()=>{r.transaction.abort();reject(Error('NO_UPGRADE'));};r.onsuccess=()=>resolve(r.result);});
     const rows=await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readonly'),r=tx.objectStore('operations').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();return {version:exists.version,rows};};
    const before=await window.captureRaw();
    window.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};XMLHttpRequest.prototype.open=()=>{throw Error('NETWORK_FORBIDDEN');};
    const transaction=IDBDatabase.prototype.transaction;window.READONLY_ORIGINAL_TRANSACTION=transaction;
    IDBDatabase.prototype.transaction=function(...args){if(args[1]!=='readonly')throw Error('WRITE_FORBIDDEN');return transaction.apply(this,args);};
    indexedDB.deleteDatabase=()=>{throw Error('DELETE_FORBIDDEN');};
    for(const k of ['setItem','removeItem','clear'])Storage.prototype[k]=()=>{throw Error('STORAGE_WRITE_FORBIDDEN');};
    window.click360WriteGate=()=>{throw Error('LEGACY_GATE_FORBIDDEN');};window.click360GetSyncState=()=>{throw Error('LEGACY_DIAGNOSTIC_FORBIDDEN');};
    return {before,localMarker:localStorage.getItem('legacy-marker')};
   },{scenario,reviewedBuild});
   await page.addScriptTag({content:source});
   const result=await page.evaluate(async()=>{try{return await CLICK360_DEVICE_READONLY_SUPPORT.inspect();}catch(e){return {reason:e.message,localPreflightReady:false};}});
   const after=await page.evaluate(()=>captureRaw());if(scenario!=='changed_journal')assert.deepEqual(after,baseline.before,'The collector must leave every stored row and schema intact');
   assert.equal(await page.evaluate(()=>localStorage.getItem('legacy-marker')),baseline.localMarker);
   assert.equal(result.localPreflightReady,['clean','confirmed_one'].includes(scenario));
   if(['clean','confirmed_one'].includes(scenario))assert.equal(result.reason,'LOCAL_READONLY_PREFLIGHT_PASS');
   if(scenario==='confirmed_one'){assert.equal(result.lastConfirmedOperation.kind,'sale');assert.equal(result.lastConfirmedOperation.projectionComplete,true);assert.match(result.lastConfirmedOperation.operationFingerprint,/^[a-f0-9]{64}$/);}
   if(scenario==='tail_unknown'){assert.equal(result.journal.total,1001);assert.equal(result.journal.unknown,1);assert.equal(result.journal.enumerationComplete,true);}
   if(scenario==='hash_corrupt')assert.equal(result.journal.payloadHashErrors,1);
   if(scenario==='context_change')assert.equal(result.contextStable,false);
   if(scenario==='missing_database')assert.equal(result.reason,'EXISTING_JOURNAL_NOT_FOUND');
   if(scenario==='old_schema')assert.equal(result.reason,'JOURNAL_VERSION_NOT_CERTIFIED');
   assert(!/PRIVATE_|FOREIGN|MUST_NOT_EMIT/.test(JSON.stringify(result)),'No identities or commercial data may be emitted');
   results.push({browser:name,scenario,result:result.reason,storageUnchanged:true,legacyMarkerUnchanged:true,privateDataEmitted:false});
  }finally{await context.close();}
 }}finally{await browser.close();}
}
await mkdir('output/playwright/spark-operational-ui',{recursive:true});
await writeFile('output/playwright/spark-operational-ui/device-health-validation.json',JSON.stringify({status:'PASS',checks:results.length,productionWrites:0,networkRequests:0,results},null,2),{mode:0o600});
console.log(JSON.stringify({status:'PASS',checks:results.length,browsers:['chromium','webkit'],fullCensusTail:1001,storageWrites:0,privateDataEmitted:false}));
