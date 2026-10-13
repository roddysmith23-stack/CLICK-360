import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-reconciliation.js';
import './spark-migration-bootstrap.js';
const api=globalThis.CLICK360_SPARK_MIGRATION;
const ownerUid='migration-owner',businessIds=['business-a','business-b'];
const identity={ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,schemaVersion:10};
const remote={businesses:businessIds.map(id=>({id})),products:[],sales:[],movements:[],cashSessions:[],dailyReports:[]};
const local={...structuredClone(remote),identity};
local.sales.push({id:'local-sale',businessId:businessIds[0],total:30});
function fixture({enabled=true,automaticShadow=true,rows=[],cache=false}={}){
  let actor=ownerUid,lease=true,revision='device-2',closed=0,imports=0;
  const calls=[],pins=new Map();
  const record={snapshot:local,deviceRevision:revision,baseRevision:1,pendingRemoteSync:true,cloudCapacityBlocked:true,pendingOperations:['snapshot-save-id']};
  const db={app:{options:{projectId:'demo-click360-spark-modular'}},doc:path=>({get:async options=>{
    assert.equal(options.source,'server');calls.push(path);
    const value=path==='storageRollout/sparkV1'?{enabled,automaticShadow,pilotOwnerUids:[ownerUid]}:
      path.endsWith('/state/main')?{revision:1,payload:{identity,data:remote}}:null;
    return {exists:!!value,data:()=>value,metadata:{fromCache:cache,hasPendingWrites:false}};
  }})};
  globalThis.CLICK360_MODULAR_JOURNAL={open:async options=>{
    assert.equal(options,undefined,'Migration must census all local actors without claiming their rows');
    return {countPending:async i=>({countIsBounded:false,total:rows.filter(r=>r.businessId===i.businessId).length,
      pendingCount:rows.filter(r=>r.businessId===i.businessId).length,unknownCount:0}),countProjectionPending:async()=>0,
      listPendingPage:async(i,{limit,after})=>{
        const scoped=rows.filter(r=>r.businessId===i.businessId),offset=after?.offset||0,end=offset+limit;
        return {rows:scoped.slice(offset,end),next:end<scoped.length?{offset:end}:null,complete:end>=scoped.length};
      },close:()=>closed++};
  }};
  globalThis.CLICK360_SPARK_RECOVERY={open:async()=>({deviceIdentity:async()=>({ownerUid,deviceId:'durable-device',durable:true}),close:()=>closed++,pin:async value=>pins.set(value.sourceHash,value),read:async key=>({...pins.get(key),durable:true})})};
  globalThis.CLICK360_SPARK_IMPORTER={create:options=>({prepareShadow:async()=>{
    imports++;const source=await options.readSource(),selected=await api.selectSource({ownerUid,...source});
    const guard=await options.readGuard();assert.equal(guard.mutationLockHeld,true);
    await options.recovery.pin({sourceHash:selected.sourceHash,snapshot:selected.snapshot});
    assert.equal(await api.hash((await options.recovery.read(selected.sourceHash)).snapshot),selected.sourceHash);
    return {phase:'READY_TO_CUTOVER',cutoverPerformed:false,equality:{sourceHash:selected.sourceHash,reconstructedHash:selected.sourceHash}};
  }})};
  const options={db,projectId:db.app.options.projectId,firebase:{},ownerUid,actorUid:ownerUid,deviceId:'device',buildSha:'21409a1d2dc7',
    resolveUser:()=>({uid:actor}),resolveContext:()=>({authUid:actor,ownerUid}),leaseHeld:()=>lease,
    readLocal:async()=>({...record,deviceRevision:revision})};
  return {options,record,calls,pins,run:()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.create(options).prepare(),
    actor:value=>actor=value,lease:value=>lease=value,revision:value=>revision=value,counts:()=>({closed,imports})};
}
{
  const f=fixture();const before=structuredClone(f.record),r=await f.run();
  assert.equal(r.prepared,true);assert.equal(r.operationalCloudConfirmed,false);assert.equal(r.cutoverPerformed,false);
  assert.equal(r.reconciliations.length,2);assert(r.reconciliations.every(row=>row.enumerationComplete));
  assert.equal(r.equality.sourceHash,await api.hash(local));assert.deepEqual(f.record,before);
  assert.deepEqual(f.counts(),{closed:2,imports:1});assert.equal(f.pins.size,1);
  const pin=[...f.pins.values()][0];
  assert.equal(pin.remoteSourceHash,await api.hash(remote));assert.equal(pin.deviceRecordMetadata.deviceRevision,'device-2');
  assert.deepEqual(pin.deviceRecordMetadata.pendingOperations,['snapshot-save-id']);assert.equal(pin.reconciliations.length,2);
  assert.equal(pin.sourceDeviceId,'durable-device');
}
for(const config of [{enabled:false},{automaticShadow:false}]){
  const f=fixture(config);assert.deepEqual(await f.run(),{prepared:false});assert.deepEqual(f.counts(),{closed:0,imports:0});
}
for(const count of [1,99,100,101,250,1000]){
  const rows=Array.from({length:count},(_,i)=>({operationId:`operation-${i}`,ownerUid,businessId:businessIds[0],payloadHash:'a'.repeat(64),payload:{actorUid:ownerUid}}));
  const f=fixture({rows});await assert.rejects(f.run(),/COMMAND_HANDOFF_REQUIRED/);
  assert.equal(f.calls.filter(path=>path.includes('/operationLedger/')).length,count,'No truncated census');
  assert.equal(f.counts().imports,0);assert.equal(f.pins.size,0);
}
{
  const f=fixture({rows:[{operationId:'foreign',ownerUid,businessId:businessIds[1],payloadHash:'a'.repeat(64),payload:{actorUid:'worker'}}]});
  await assert.rejects(f.run(),/OUTBOX_RECONCILIATION_STOP/);assert.equal(f.counts().imports,0);
  assert(!f.calls.some(path=>path.endsWith('/foreign')),'Do not acquire or send another actor command');
}
for(const change of [f=>f.actor('worker'),f=>f.lease(false)]){
  const f=fixture();change(f);await assert.rejects(f.run(),/CONTEXT_CHANGED/);assert.equal(f.calls.length,0);
}
{
  const f=fixture();let reads=0;
  f.options.readLocal=async()=>({...f.record,deviceRevision:++reads>1?'changed-device-revision':'device-2'});
  await assert.rejects(f.run(),/DEVICE_DRIFT_STOP/);assert.equal(f.counts().imports,0);assert.equal(f.pins.size,0);
}
{
  const f=fixture();globalThis.document={};
  try{await assert.rejects(f.run(),/MIXED_BUILD_STOP/);assert.equal(f.calls.length,0);}
  finally{delete globalThis.document;}
}
{
  const f=fixture({cache:true});await assert.rejects(f.run(),/SERVER_REQUIRED/);
  assert.throws(()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.create({...f.options,projectId:'click-360'}),/NONPRODUCTION_ONLY/);
}
console.log(JSON.stringify({status:'PASS',scope:'migration_bootstrap_callback_contract',ownerWideCensus:true,
  localSourcePreserved:true,foreignActorBlocked:true,productionActivation:false,cutover:false}));
