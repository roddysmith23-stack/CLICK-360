import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-reconciliation.js';
import './spark-modular-handoff.js';
import './spark-modular-record-codec.js';
import './spark-migration-bootstrap.js';
const api=globalThis.CLICK360_SPARK_MIGRATION;
const ownerUid='migration-owner',businessIds=['business-a','business-b'];
const identity={ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,schemaVersion:10};
const remote={businesses:businessIds.map(id=>({id})),products:[],sales:[],movements:[],cashSessions:[],dailyReports:[]};
const local={...structuredClone(remote),identity};
local.cashSessions.push({id:'local-session',operationId:'local-opening',businessId:businessIds[0],date:'2026-09-03',status:'open',openingAmount:0});
local.sales.push({id:'local-sale',operationId:'local-sale',cashSessionId:'local-session',businessId:businessIds[0],
  date:'2026-09-03',total:30,received:30,iva:0,method:'Transferencia',items:[{id:'product',qty:1}]});
local.movements.push({id:'local-opening',operationId:'local-opening',cashSessionId:'local-session',businessId:businessIds[0],
  date:'2026-09-03',kind:'apertura',amount:0},
  {id:'local-receipt',operationId:'local-sale',saleId:'local-sale',cashSessionId:'local-session',businessId:businessIds[0],
    date:'2026-09-03',kind:'ingreso',amount:30,paymentType:'sale',paymentMethod:'Transferencia'});
function fixture({enabled=true,automaticShadow=true,automaticRecoveryCopy=false,rows=[],cache=false,buildSha='21409a1d2dc7'}={}){
  let actor=ownerUid,lease=true,revision='device-2',closed=0,imports=0;
  const calls=[],pins=new Map(),captures=new Map(),handoffs=new Map(),serverDocs=new Map();
  let afterShadow=()=>{},readHandoffCorrupt=false,serverRecords=[],afterServerRecords=()=>{},importerAuthority=null;
  const record={snapshot:local,deviceRevision:revision,baseRevision:1,pendingRemoteSync:true,cloudCapacityBlocked:true,pendingOperations:['snapshot-save-id']};
  const transport={cache,pendingWrites:false};
  const db={app:{options:{projectId:'demo-click360-spark-modular'}},doc:path=>({get:async options=>{
    assert.equal(options.source,'server');calls.push(path);
    const value=serverDocs.has(path)?serverDocs.get(path):path==='storageRollout/sparkV1'?{enabled,automaticShadow,automaticRecoveryCopy,pilotOwnerUids:[ownerUid]}:
      path.endsWith('/state/main')?{revision:1,payload:{identity,data:remote}}:null;
    return {exists:!!value,data:()=>value,metadata:{fromCache:transport.cache,hasPendingWrites:transport.pendingWrites}};
  }})};
  globalThis.CLICK360_MODULAR_JOURNAL={open:async options=>{
    assert.equal(options,undefined,'Migration must census all local actors without claiming their rows');
    return {captureOwner:async()=>({ownerUid,rows:structuredClone(rows),recordCount:rows.length,enumerationComplete:true}),assertOwnerCoverage:async(_owner,businesses)=>{
      if(rows.some(row=>row.ownerUid===_owner&&!businesses.includes(row.businessId)))throw Error('OWNER_OUTBOX_BUSINESS_COVERAGE_REQUIRED');
    },countPending:async i=>({countIsBounded:false,total:rows.filter(r=>r.businessId===i.businessId).length,
      pendingCount:rows.filter(r=>r.businessId===i.businessId).length,unknownCount:0}),countProjectionPending:async()=>0,
      listPendingPage:async(i,{limit,after})=>{
        const scoped=rows.filter(r=>r.businessId===i.businessId),offset=after?.offset||0,end=offset+limit;
        return {rows:scoped.slice(offset,end),next:end<scoped.length?{offset:end}:null,complete:end>=scoped.length};
      },close:()=>closed++};
  }};
  globalThis.CLICK360_SPARK_RECOVERY={open:async()=>({deviceIdentity:async()=>({ownerUid,deviceId:'durable-device',durable:true}),
    captureDevice:async value=>{const captureHash=await api.hash(value);captures.set(captureHash,structuredClone(value));return {captureHash,durable:true};},
    preserveCloud:async({captureHash,assertStable})=>{await assertStable();assert(captures.has(captureHash));return {status:'RECOVERY_COPY_CLIENT_VERIFIED',captureHash,operationalCloudConfirmed:false};},
    close:()=>closed++,pin:async value=>pins.set(value.sourceHash,value),read:async key=>({...pins.get(key),durable:true}),
    pinHandoff:async plan=>{const captureHash=await api.hash({kind:'READ_ONLY_HANDOFF_PLAN',ownerUid,plan});handoffs.set(captureHash,structuredClone(plan));return {captureHash,durable:true};},
    readHandoff:async captureHash=>({captureHash,durable:true,plan:readHandoffCorrupt?{invalid:true}:structuredClone(handoffs.get(captureHash))})})};
  globalThis.CLICK360_SPARK_IMPORTER={create:options=>{importerAuthority=options.preparationAuthority;return {readServerRecords:async()=>{afterServerRecords();return structuredClone(serverRecords);},prepareShadow:async()=>{
    imports++;const source=await options.readSource(),selected=await api.selectSource({ownerUid,...source});
    const guard=await options.readGuard();assert.equal(guard.mutationLockHeld,true);
    await options.recovery.pin({sourceHash:selected.sourceHash,snapshot:selected.snapshot,deviceRevision:selected.deviceRevision,
      remoteRevision:selected.remoteRevision,identity:selected.identity,pendingOperations:selected.pendingOperations,buildSha:options.buildSha});
    assert.equal(await api.hash((await options.recovery.read(selected.sourceHash)).snapshot),selected.sourceHash);
    const shadow={phase:'READY_TO_CUTOVER',cutoverPerformed:false,
      equality:{status:'SEMANTIC_EQUALITY_PASS',sourceHash:selected.sourceHash,reconstructedHash:selected.sourceHash}};
    afterShadow(shadow);return shadow;
  }};}};
  const options={db,projectId:db.app.options.projectId,firebase:{},ownerUid,actorUid:ownerUid,deviceId:'device',buildSha,
    resolveUser:()=>({uid:actor}),resolveContext:()=>({authUid:actor,ownerUid}),leaseHeld:()=>lease,
    readLocal:async()=>({...record,deviceRevision:revision})};
  return {options,record,calls,pins,captures,handoffs,serverDocs,transport,setServerRecords:rows=>serverRecords=rows,
    afterServerRecords:callback=>afterServerRecords=callback,authority:()=>importerAuthority,verify:()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.create(options).verifyLocalHandoff(),
    afterShadow:callback=>afterShadow=callback,
    corruptHandoffRead:()=>readHandoffCorrupt=true,run:()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.create(options).prepare(),
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
  assert.equal(pin.capacityProof.results.length,1);
  assert.equal(pin.capacityProof.results[0].replayAllowed,false);
  assert.equal(pin.capacityProof.sourceHash,await api.hash(local));
  assert.equal(pin.cashProofs.length,2);
  assert(pin.cashProofs.every(proof=>proof.canProceed));
  assert.equal(r.handoffPrepared,true);assert.equal(f.handoffs.size,1);
  assert.equal(r.handoff.plan.sourceHash,await api.hash(local));
  assert.equal(r.handoff.plan.runtimes[0].content.data.openCashSessionId,'local-session');
  assert.equal(r.handoff.plan.runtimes[1].content.data.openCashSessionId,'');
  assert.equal(r.handoff.plan.cutoverAllowed,false);assert(!Object.hasOwn(pin,'handoff'),'Original immutable source pin is not rewritten');
}
for(const delta of [{phase:'MODULAR'},{cutoverPerformed:true},{equality:{status:'PENDING'}},
  {equality:{status:'SEMANTIC_EQUALITY_PASS',sourceHash:'f'.repeat(64),reconstructedHash:'f'.repeat(64)}}]){
  const f=fixture();f.afterShadow(shadow=>Object.assign(shadow,delta));
  await assert.rejects(f.run(),/HANDOFF_EQUALITY_REQUIRED/);assert.equal(f.handoffs.size,0);assert.equal(f.captures.size,1);
}
{
  const f=fixture();f.afterShadow(()=>{f.record.pendingOperations.push('late-save-reference');});
  await assert.rejects(f.run(),/DEVICE_METADATA_DRIFT_STOP/);assert.equal(f.handoffs.size,0);assert.equal(f.captures.size,1);
}
{
  const rows=[],f=fixture({rows});
  f.afterShadow(()=>rows.push({ownerUid,businessId:businessIds[0],operationId:'late-command',state:'unknown'}));
  await assert.rejects(f.run(),/OUTBOX_CHANGED_STOP/);assert.equal(f.handoffs.size,0);assert.equal(f.captures.size,1);
}
{
  const f=fixture();f.corruptHandoffRead();
  await assert.rejects(f.run(),/HANDOFF_PIN_REQUIRED/);assert.equal(f.handoffs.size,1);assert.equal(f.pins.size,1);
}
for(const count of [76,101,1000]){
  const f=fixture();
  f.record.pendingOperations=Array.from({length:count},(_,i)=>`device-save-${i}`);
  const before=structuredClone(f.record);
  await f.run();
  const proof=[...f.pins.values()][0].capacityProof;
  assert.equal(proof.results.length,count,'Legacy pending saves are not the modular journal');
  assert(proof.results.every(row=>row.replayAllowed===false&&row.action==='IMPORT_RECONCILED_SOURCE_ONLY'));
  assert(!f.calls.some(path=>path.includes('/operationLedger/')),'Snapshot save IDs are never commercial commands');
  assert.deepEqual(f.record,before);
}
for(const pendingOperations of [['duplicate','duplicate'],[{operationId:'not-a-snapshot-reference',state:'unknown'}]]){
  const f=fixture();f.record.pendingOperations=pendingOperations;
  await assert.rejects(f.run(),/SPARK_CAPACITY_PENDING_PROOF_REQUIRED|MIGRATION_UNKNOWN_OPERATIONS_STOP/);
  assert.equal(f.counts().imports,0);assert.equal(f.captures.size,1);
}
// A lossless record-codec roundtrip is not proof that imported sessions have
// verified financial counters. The REAL bootstrap must reject before calling
// the importer, while retaining the original local snapshot and recovery pin.
for(const businessId of businessIds){
  const f=fixture();
  f.record.snapshot=structuredClone(f.record.snapshot);
  f.record.snapshot.cashSessions.push({id:'unverified-session',businessId,
    operationId:'opening',date:'2026-09-03',status:'open',openingAmount:0});
  const before=structuredClone(f.record);
  await assert.rejects(f.run(),/SPARK_MIGRATION_CASH_PROOF_REQUIRED/);
  assert.equal(f.counts().imports,0);
  assert.equal(f.captures.size,1,'Financial preflight must never erase the original source');
  assert.deepEqual(f.record,before);
}
for(const config of [{enabled:false},{automaticShadow:false}]){
  const f=fixture(config);assert.deepEqual(await f.run(),{prepared:false});assert.deepEqual(f.counts(),{closed:0,imports:0});
}
for(const automaticRecoveryCopy of [false,true]){
  const f=fixture({automaticShadow:true,automaticRecoveryCopy});
  f.options.projectId='click-360';f.options.db.app.options.projectId='click-360';f.options.productionRecoveryOnly=true;
  const result=await f.run();
  assert.equal(result.prepared,false,'Production recovery cannot activate shadow/cutover even when the shadow policy is true');
  assert.equal(f.counts().imports,0);
  if(automaticRecoveryCopy)assert.equal(result.recoveryCopy.status,'RECOVERY_COPY_CLIENT_VERIFIED');
  else assert.equal(f.captures.size,0);
}
for(const count of [1,99,100,101,250,1000]){
  const rows=Array.from({length:count},(_,i)=>({operationId:`operation-${i}`,ownerUid,businessId:businessIds[0],payloadHash:'a'.repeat(64),payload:{actorUid:ownerUid}}));
  const f=fixture({rows});await assert.rejects(f.run(),/COMMAND_HANDOFF_REQUIRED/);
  assert.equal(f.calls.filter(path=>path.includes('/operationLedger/')).length,count,'No truncated census');
  assert.equal(f.counts().imports,0);assert.equal(f.pins.size,0);
  assert.equal(f.captures.size,1,'Device capture must survive a blocked command handoff');
  assert.equal([...f.captures.values()][0].journalCapture.rows.length,count);
}
{
  const f=fixture({automaticShadow:false,automaticRecoveryCopy:true,rows:[{ownerUid,businessId:businessIds[0],operationId:'unknown',state:'unknown',payloadHash:'a'.repeat(64)}]});
  const before=structuredClone(f.record),r=await f.run();
  assert.equal(r.prepared,false);assert.equal(r.recoveryCopy.status,'RECOVERY_COPY_CLIENT_VERIFIED');
  assert.equal(r.operationalCloudConfirmed,false);assert.equal(f.counts().imports,0);
  assert.equal([...f.captures.values()][0].journalCapture.rows[0].state,'unknown');
  assert.deepEqual(f.record,before);assert(!f.calls.some(p=>p.includes('/operationLedger/')),'Copy is never a retry or confirmation');
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
  const f=fixture({rows:[{operationId:'outside-source',ownerUid,businessId:'omitted-business',payloadHash:'a'.repeat(64),payload:{actorUid:ownerUid}}]});
  await assert.rejects(f.run(),/OWNER_OUTBOX_BUSINESS_COVERAGE_REQUIRED/);assert.equal(f.counts().imports,0);
}
{
  const f=fixture();let reads=0;
  f.options.readLocal=async()=>({...f.record,deviceRevision:++reads>1?'changed-device-revision':'device-2'});
  await assert.rejects(f.run(),/DEVICE_DRIFT_STOP/);assert.equal(f.counts().imports,0);assert.equal(f.pins.size,0);
}
// A snapshot hash/revision alone cannot pin its queue or remote base. A
// background save may change those fields without changing commercial JSON.
for(const delta of [{baseRevision:2},{pendingOperations:['new-save-reference']},
  {pendingRemoteSync:false},{cloudCapacityBlocked:false},{source:'spark_operational_candidate'}]){
  const f=fixture();let reads=0;
  f.options.readLocal=async()=>({...f.record,...(++reads>1?delta:{})});
  await assert.rejects(f.run(),/DEVICE_METADATA_DRIFT_STOP/);
  assert.equal(f.counts().imports,0);
  assert.deepEqual(f.record.pendingOperations,['snapshot-save-id']);
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
async function localHandoffFixture(buildSha){
  const rows=[],f=fixture({rows,buildSha}),prepared=await f.run(),plan=prepared.handoff.plan;
  const approval=await CLICK360_SPARK_HANDOFF.runtimeApproval(plan,f.options.buildSha);
  const pin=f.pins.get(plan.sourceHash),control={ownerUid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',
    semanticEquality:'PASS',sourceHash:plan.sourceHash,reconstructedHash:plan.sourceHash,
    deviceRevision:pin.deviceRevision,sourceDeviceId:pin.sourceDeviceId,remoteHash:pin.remoteSourceHash,
    remoteRevision:pin.remoteRevision,buildSha:f.options.buildSha,businessIds:[...plan.businessIds]};
  f.serverDocs.set('storageRollout/sparkV1',{enabled:true,automaticCutover:true,pilotOwnerUids:[ownerUid]});
  f.serverDocs.set(`businesses/${ownerUid}/metadata/storage`,control);
  f.serverDocs.set(`businesses/${ownerUid}/storageApprovals/runtimePreparation`,approval);
  f.serverDocs.set(`businesses/${ownerUid}/storageApprovals/cutover`,{ownerUid,sourceHash:plan.sourceHash,
    buildSha:f.options.buildSha,businessIds:[...plan.businessIds]});
  f.serverDocs.set(`approvedUsers/${ownerUid}`,{plan:'founder_legacy',manualLimitOverrides:{productsActive:600}});
  const manifest=await api.plan({ownerUid,snapshot:f.record.snapshot,identity,
    remoteRevision:pin.remoteRevision,deviceRevision:pin.deviceRevision});
  for(const row of manifest.records){
    const proof=pin.cashProofs.find(p=>p.businessId===row.content.businessId);
    if(row.content.module==='cashSessions'&&proof?.verified[row.content.id]){
      row.content.operational=structuredClone(proof.verified[row.content.id].summary);
      row.content.operationalHash=proof.verified[row.content.id].summaryHash;
    }
  }
  const records=[...manifest.records,...plan.runtimes.map(row=>({path:row.path,content:approval.runtimeRecords[row.content.businessId]}))];
  for(const businessId of plan.businessIds){
    const scope={ownerUid,businessId};
    const flat={id:'storage',...scope,tenantKey:`owner:${ownerUid}:business:${businessId}`,storageSchemaVersion:2,
      module:'metadata',recordVersion:1,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',
      sourceHash:plan.sourceHash,reconstructedHash:plan.sourceHash,accountPlan:'founder_legacy',manualLimitOverrides:{productsActive:600}};
    records.push({path:`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/storage`,
      content:await CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity:scope,moduleName:'metadata',recordId:'storage'})});
  }
  f.setServerRecords(records);
  return {...f,rows,plan,approval,control,records};
}
{
  const f=await localHandoffFixture('2875f6e7496f');f.options.buildSha='a'.repeat(12);
  f.options.projectId='click-360';f.options.db.app.options.projectId='click-360';
  const proof=await f.verify(),scope={projectId:'click-360',ownerUid,buildSha:f.options.buildSha};
  assert.equal(proof.sourceBuildSha,'2875f6e7496f');assert.equal(proof.buildSha,f.options.buildSha);
  assert.equal(CLICK360_SPARK_MIGRATION_BOOTSTRAP.assertLocalHandoffAuthority(proof,scope),true);
  assert.throws(()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.assertLocalHandoffAuthority({...proof},scope),/AUTHORITY_REQUIRED/);
  assert.equal(f.counts().imports,1,'Finishing a committed handoff must not import again');
  f.serverDocs.get('storageRollout/sparkV1').automaticMigration=true;
  f.control.storageMode='migrating';f.control.phase='READY_TO_CUTOVER';
  await assert.rejects(CLICK360_SPARK_MIGRATION_BOOTSTRAP.create(f.options).verifyLocalHandoff({preCutover:true}),/CONTROL_REQUIRED/,
    'Compatibility never authorizes a new cutover with old approvals');
}
{
  const f=await localHandoffFixture();f.options.buildSha='a'.repeat(12);
  await assert.rejects(f.verify(),/CONTROL_REQUIRED/,'Unknown old builds are not automatically accepted');
}
for(const plan of ['normal','',null,'lifetime']){
  const f=await localHandoffFixture();
  f.serverDocs.set(`accountAccess/${ownerUid}`,{plan});
  await assert.rejects(f.verify(),/OWNER_PLAN_UNSUPPORTED/,'An existing unsupported account cannot fall back to a legacy Founder approval');
}
{
  const f=await localHandoffFixture(),proof=await f.verify();
  f.serverDocs.set(`approvedUsers/${ownerUid}`,{plan:'founder_legacy',manualLimitOverrides:{productsActive:2500}});
  await assert.rejects(proof.assertStable(),/OWNER_CONTRACT_CHANGED/);
}
{
  const f=await localHandoffFixture(),before=structuredClone(f.record),pins=structuredClone([...f.pins]);
  const result=await f.verify();assert.equal(result.verified,true);await result.assertStable();
  assert.deepEqual(result.businessIds,businessIds);assert.deepEqual(f.record,before);
  assert.deepEqual([...f.pins],pins);assert.equal(f.rows.length,0);
  f.record.uiWorkingDates={[businessIds[0]]:'2026-09-03'};
  await assert.rejects(result.assertStable(),/DEVICE_DRIFT_STOP/,'Working date/device metadata cannot silently change before the CAS');
}
{
  const f=await localHandoffFixture();
  // The source preserves UI business order; the handoff plan canonicalizes
  // IDs for hashing. Identical coverage must not become a false conflict.
  f.control.businessIds=[...businessIds].reverse();
  f.serverDocs.set(`businesses/${ownerUid}/storageApprovals/cutover`,{ownerUid,
    sourceHash:f.plan.sourceHash,buildSha:f.options.buildSha,businessIds:[...f.control.businessIds]});
  const result=await f.verify();await result.assertStable();
  assert.deepEqual(result.businessIds,f.control.businessIds);
}
{
  const f=await localHandoffFixture();
  // The real SDK returns Timestamp prototypes for the storage control. They
  // must be compared exactly rather than rejected as business JSON or omitted.
  class Timestamp{constructor(seconds){this.seconds=seconds;this.nanoseconds=42;}toJSON(){return {seconds:this.seconds,nanoseconds:this.nanoseconds};}}
  f.control.updatedAt=new Timestamp(100);
  const result=await f.verify();await result.assertStable();
  // Replacement documents, not mutation of the verifier's captured value.
  f.serverDocs.set(`businesses/${ownerUid}/metadata/storage`,{...f.control,updatedAt:new Timestamp(101)});
  await assert.rejects(result.assertStable(),/AUTHORIZATION_DRIFT_STOP/);
}
for(const mutation of [
  f=>f.serverDocs.delete(`businesses/${ownerUid}/storageApprovals/runtimePreparation`),
  f=>f.serverDocs.set(`businesses/${ownerUid}/storageApprovals/cutover`,{ownerUid,sourceHash:f.plan.sourceHash,buildSha:'f'.repeat(12),businessIds}),
  f=>f.control.businessIds.pop(),
  f=>f.control.storageMode='migrating',
  f=>f.serverDocs.get('storageRollout/sparkV1').automaticCutover=false,
  f=>f.serverDocs.get('storageRollout/sparkV1').pilotOwnerUids='not-an-array',
  f=>f.record.pendingOperations.push('late-local-save'),
  f=>f.rows.push({ownerUid,businessId:businessIds[0],operationId:'unknown',state:'unknown'}),
  f=>f.records[0].content.data.changed=true,
  f=>f.records.push(structuredClone(f.records[0])),
  f=>f.pins.clear(),
  f=>f.corruptHandoffRead(),
  f=>f.transport.cache=true,
  f=>f.transport.pendingWrites=true,
  f=>f.serverDocs.set(`businesses/${ownerUid}/state/main`,{revision:2,payload:{identity,data:remote}}),
  f=>f.afterServerRecords(()=>f.actor('revoked-owner'))
]){
  const f=await localHandoffFixture();mutation(f);const before=structuredClone(f.record);
  await assert.rejects(f.verify());assert.deepEqual(f.record,before,'Failed handoff must never replace the local source');
}
for(const delta of [{enabled:false},{operationalAccess:false},{automaticShadow:false},{automaticMigration:false},{pilotOwnerUids:['other']}]){
  const f=fixture();f.options.projectId='click-360';f.options.db.app.options.projectId='click-360';
  f.serverDocs.set('storageRollout/sparkV1',{enabled:true,operationalAccess:true,automaticShadow:true,automaticMigration:true,pilotOwnerUids:[ownerUid],...delta});
  const before=structuredClone(f.record);assert.equal((await f.run()).prepared,false);
  assert.deepEqual(f.record,before);assert.equal(f.counts().imports,0);assert.equal(f.captures.size,0);
}
for(const target of ['click-360','click360-staging-7620168025']){
  const f=fixture();f.options.projectId=target;f.options.db.app.options.projectId=target;
  const policy={enabled:true,operationalAccess:true,automaticShadow:true,automaticMigration:true,sourceBoundPreparation:true,pilotOwnerUids:[ownerUid]};
  const devicePolicy={ownerUid,enabled:true,buildSha:f.options.buildSha,sourceDeviceId:'durable-device'};
  f.serverDocs.set(`businesses/${ownerUid}/recoveryPreflightPolicy/main`,devicePolicy);
  f.serverDocs.set('storageRollout/sparkV1',policy);
  const before=structuredClone(f.record),deferred=await f.run();
  assert.equal(deferred.reason,'SPARK_SOURCE_BOUND_APPROVAL_PENDING');
  assert.equal(deferred.prepared,false);assert.equal(deferred.cutoverPerformed,false);
  assert.equal(f.counts().imports,0);assert.deepEqual(f.record,before);
  const source=await api.selectSource({ownerUid,remote:{source:'server',revision:1,identity,snapshot:remote},local:{...f.record,durable:true},unknownOperations:0});
  const {snapshot:ignored,...metadata}=f.record;
  const journalCapture={ownerUid,rows:[],recordCount:0,enumerationComplete:true};
  const financialProofs=await Promise.all(source.businessIds.map(async businessId=>({businessId,...await api.deriveCashSummaries({snapshot:source.snapshot,businessId})})));
  const plan=await CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot:source.snapshot,sourceHash:source.sourceHash,
    deviceMetadataHash:await api.hash(metadata),journalHash:await api.hash(journalCapture),journalCapture,
    businessIds:source.businessIds,financialProofs,unknownCount:0,conflictCount:0});
  const approval=await CLICK360_SPARK_HANDOFF.runtimeApproval(plan,f.options.buildSha);
  f.serverDocs.set(`businesses/${ownerUid}/storageApprovals/runtimePreparation`,approval);
  f.serverDocs.set(`businesses/${ownerUid}/storageApprovals/cutover`,{ownerUid,sourceHash:plan.sourceHash,buildSha:f.options.buildSha,businessIds:source.businessIds});
  assert.equal((await f.run()).prepared,true);assert.equal(f.counts().imports,1);
  f.serverDocs.set(`businesses/${ownerUid}/recoveryPreflightPolicy/main`,{...devicePolicy,sourceDeviceId:'different-device'});
  const foreignDevice=await f.run();assert.equal(foreignDevice.reason,'SPARK_SOURCE_BOUND_APPROVAL_PENDING');
  assert.equal(f.counts().imports,1,'Device identity mismatch must defer before any shadow claim');
  f.serverDocs.set(`businesses/${ownerUid}/recoveryPreflightPolicy/main`,devicePolicy);
  f.record.pendingOperations.push('newer-normal-use-save');
  const changed=await f.run();assert.equal(changed.reason,'SPARK_SOURCE_BOUND_APPROVAL_PENDING');
  assert.equal(f.counts().imports,1,'A stale approval cannot claim a changed device source or fence legacy');
  f.record.pendingOperations.pop();
  const token=f.authority();
  const scope={projectId:target,ownerUid,buildSha:f.options.buildSha,deviceId:'durable-device'};
  assert.equal(CLICK360_SPARK_MIGRATION_BOOTSTRAP.assertPreparationAuthority(token,scope,{write:true}),true);
  assert.throws(()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.assertPreparationAuthority({verified:true},scope),/AUTHORITY_REQUIRED/);
  assert.throws(()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.assertPreparationAuthority(token,{...scope,ownerUid:'other'}),/AUTHORITY_REQUIRED/);
  await CLICK360_SPARK_MIGRATION_BOOTSTRAP.verifyPreparationAuthority(token,scope,{write:true});
  f.serverDocs.set('storageRollout/sparkV1',{...policy,operationalAccess:false});
  await assert.rejects(CLICK360_SPARK_MIGRATION_BOOTSTRAP.verifyPreparationAuthority(token,scope,{write:true}),/ADMIN_POLICY_REQUIRED/);
  f.actor('revoked');assert.throws(()=>CLICK360_SPARK_MIGRATION_BOOTSTRAP.assertPreparationAuthority(token,scope),/CONTEXT_CHANGED/);
}
console.log(JSON.stringify({status:'PASS',scope:'migration_bootstrap_callback_contract',ownerWideCensus:true,
  localSourcePreserved:true,foreignActorBlocked:true,productionActivation:false,cutover:false}));

// A normal-use attempt cannot fence an untouched legacy owner just because
// financial/outbox evidence is unavailable. Once a fence exists, strict
// recovery is mandatory: no silent return to a legacy commercial writer.
for(const target of ['click-360','click360-staging-7620168025'])for(const fenced of [false,true]){
  const f=fixture();f.options.projectId=target;f.options.db.app.options.projectId=target;
  f.serverDocs.set('storageRollout/sparkV1',{enabled:true,operationalAccess:true,automaticShadow:true,
    automaticMigration:true,sourceBoundPreparation:true,pilotOwnerUids:[ownerUid]});
  f.record.snapshot=structuredClone(f.record.snapshot);
  f.record.snapshot.cashSessions.push({id:'unverified-unattended-session',businessId:businessIds[0],
    operationId:'unverified-opening',date:'2026-09-03',status:'open',openingAmount:0});
  if(fenced)f.serverDocs.set(`businesses/${ownerUid}/metadata/storage`,{ownerUid,storageMode:'migrating'});
  const before=structuredClone(f.record);
  if(fenced)await assert.rejects(f.run(),/SPARK_MIGRATION_CASH_PROOF_REQUIRED/);
  else{
    const r=await f.run();assert.equal(r.prepared,false);assert.equal(r.reason,'SPARK_MIGRATION_CASH_PROOF_REQUIRED');
    assert.equal(r.cutoverPerformed,false);
  }
  assert.equal(f.counts().imports,0);assert.deepEqual(f.record,before);
}
console.log('PASS unattended source-bound approvals precede shadow; absent/stale approval and unverified financial source preserve untouched legacy; existing fences never downgrade');
