import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-handoff.js';
import './spark-modular-reconciliation.js';
import './spark-modular-record-codec.js';
import {largeTenantData,stateDocument} from './qa/r38-emulator-support.mjs';
const api=CLICK360_SPARK_MIGRATION,p0d=CLICK360_SPARK_RECONCILIATION,ownerUid='p0d-synthetic-owner';
const snapshot=largeTenantData(ownerUid);snapshot.products=snapshot.products.slice(0,2);
for(const key of ['sales','movements','cashSessions','dailyReports','auditLogs','layaways'])snapshot[key]=[];
snapshot.identity=stateDocument(ownerUid,7,snapshot).payload.identity;
const baseline={ownerUid,deviceId:'original-device',buildSha:'4430b99063c3',record:{snapshot,identity:snapshot.identity,
 deviceRevision:'persist-old',baseRevision:7,pendingRemoteSync:false,pendingOperations:[]},
 journalCapture:{ownerUid,enumerationComplete:true,recordCount:0,rows:[]}};
const current=structuredClone(baseline),remote={source:'server',revision:7,identity:snapshot.identity,snapshot:structuredClone(snapshot)};
const input={ownerUid,baseline,current,remote,lookupOperation:async()=>{throw Error('NO_COMMAND_EXPECTED');}};
const preserved=await api.hash(input.current),ready=await p0d.recoveryPreflight(input);
assert.equal(ready.status,'CLIENT_PREFLIGHT_READY');assert.equal(ready.changedRecords,0);
assert.equal(ready.sourceHash,ready.reconstructedHash);assert.equal(await api.hash(current),preserved);
assert.equal(ready.replayAllowed,false);assert.equal(ready.cutover,false);
const newer=structuredClone(current);newer.record.deviceRevision='persist-new';newer.record.pendingRemoteSync=true;
newer.record.cloudCapacityBlocked=true;newer.record.pendingOperations=['legacy-save-not-a-command'];
newer.record.snapshot.products[0].name='Nombre actualizado localmente';
const delta=await p0d.recoveryPreflight({...input,current:newer});assert.equal(delta.changedRecords,1);
assert.notEqual(delta.sourceHash,ready.sourceHash);assert.equal(delta.sourceHash,delta.reconstructedHash);
const historical=structuredClone(baseline);historical.record.snapshot.sales=[{id:'old-sale',businessId:ownerUid,date:'2026-09-03',total:30,items:[]}];
await assert.rejects(p0d.recoveryPreflight({...input,baseline:historical}),/HISTORICAL_RECORD_REMOVED/);
await assert.rejects(p0d.recoveryPreflight({...input,current:{...current,deviceId:'foreign-device'}}),/ORIGINAL_DEVICE/);
await assert.rejects(p0d.recoveryPreflight({...input,current:{...current,journalCapture:{...current.journalCapture,enumerationComplete:false}}}),/COMPLETE_CAPTURE/);
const bad=structuredClone(current);bad.record.snapshot.products[0].qty=-99;
await assert.rejects(p0d.recoveryPreflight({...input,current:bad}),/CONTRADICTION|STOCK|SOURCE/);
for(const size of [99,100,101,250,1000]){
 let reads=0;const pending=structuredClone(current);
 pending.journalCapture.rows=Array.from({length:size},(_,i)=>({ownerUid,businessId:ownerUid,operationId:`op-${i}`,
  key:`${ownerUid}:${ownerUid}:op-${i}`,payloadHash:'a'.repeat(64),state:'unknown'}));pending.journalCapture.recordCount=size;
 const result=await p0d.recoveryPreflight({...input,current:pending,lookupOperation:async operation=>{
  reads++;return operation.operationId===`op-${size-1}`?{source:'unavailable'}:{source:'server',exists:true,record:{...operation,status:'committed'}};}});
 assert.equal(reads,size);assert.equal(result.unknownCount,1);assert.equal(result.status,'CLIENT_PREFLIGHT_BLOCKED');assert.equal(result.cutover,false);
 const confirmed=await p0d.recoveryPreflight({...input,current:pending,lookupOperation:async operation=>({source:'server',exists:true,record:{...operation,status:'committed'}})});
 assert.equal(confirmed.reason,'P0D_COMMAND_SOURCE_COVERAGE_REQUIRED');assert.equal(confirmed.confirmedCount,size);
}
// Run the actual transport with a bounded synthetic Firestore facade; no
// commercial writer methods exist. Real Rules/browser coverage is separate.
const hash=api.hash,baselineHash=await hash(baseline),currentHash=await hash(current);
const policy={enabled:true,ownerUid,buildSha:current.buildSha,baselineCaptureHash:baselineHash,
 baselineSourceHash:await hash(snapshot),deviceIdHash:await hash(current.deviceId),businessIds:[ownerUid]};
const docs=new Map(),writes=[];let cached=false,drift=false,contextValid=true;
const snap=(data,id)=>({exists:!!data,id,metadata:{fromCache:cached,hasPendingWrites:false},data:()=>structuredClone(data)});
for(const [key,capture]of [[baselineHash,baseline],[currentHash,current]]){
 const content=api.canonicalJson(capture),path=`businesses/${ownerUid}/recoveryCopies/${key}`;
 docs.set(path,{ownerUid,captureHash:key,state:'CLIENT_VERIFIED',deviceId:capture.deviceId,buildSha:capture.buildSha,
  sourceHash:await hash(capture.record.snapshot),journalHash:await hash(capture.journalCapture),payloadBytes:api.byteLength(capture),partCount:1,remoteRevision:7,remoteHash:await hash(remote.snapshot)});
 docs.set(path+'/parts/p0',{ownerUid,captureHash:key,position:0,content,contentHash:await hash(content)});
}
const policyPath=`businesses/${ownerUid}/recoveryPreflightPolicy/main`;
docs.set(policyPath,policy);docs.set(`businesses/${ownerUid}/state/main`,{revision:7,payload:{identity:snapshot.identity,data:remote.snapshot}});
const db={doc:path=>({path,get:async()=>snap(docs.get(path)),collection:()=>({orderBy(){return this;},limit(){return this;},get:async()=>({metadata:{fromCache:cached,hasPendingWrites:false},docs:[snap(docs.get(path+'/parts/p0'),'p0')]})})}),
 runTransaction:async fn=>fn({get:async ref=>snap(docs.get(ref.path)),set:(ref,data)=>{assert.match(ref.path,/\/recoveryPreflights\//);writes.push(ref.path);docs.set(ref.path,data);}})};
const config={db,firebase:{firestore:{FieldValue:{serverTimestamp:()=>({seconds:1})}}},ownerUid,actorUid:ownerUid,buildSha:current.buildSha,
 copy:{status:'RECOVERY_COPY_CLIENT_VERIFIED',serverReadVerified:true,captureHash:currentHash},
 assertContext:()=>{if(!contextValid)throw Error('P0D_CONTEXT_CHANGED');},readLocal:async()=>drift?{...current.record,deviceRevision:'changed'}:current.record,captureJournal:async()=>current.journalCapture};
const run=()=>p0d.createDevicePreflight(config).prepare();
assert.equal((await run()).status,'CLIENT_PREFLIGHT_READY');assert.equal(writes.length,1);
assert.equal((await run()).status,'CLIENT_PREFLIGHT_READY');assert.equal(writes.length,1,'Idempotent same-source receipt');
cached=true;await assert.rejects(run(),/SERVER_REQUIRED/);cached=false;
drift=true;await assert.rejects(run(),/CURRENT_DEVICE_DRIFT/);drift=false;
contextValid=false;await assert.rejects(run(),/CONTEXT_CHANGED/);contextValid=true;
docs.set(policyPath,{...policy,enabled:false});assert.equal((await run()).status,'DISABLED');assert.equal(writes.length,1);
console.log('PASS P0D source/delta/roundtrip/financial/1000-row UNKNOWN census, strict server capture, drift, identity, disable, idempotency; no commercial writes or replay');
