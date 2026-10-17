import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,query,orderBy,documentId,limit,startAfter,runTransaction,serverTimestamp} from 'firebase/firestore';
import './spark-modular-migration.js';
import './spark-modular-importer.js';
import './spark-migration-bootstrap.js';
import './spark-modular-handoff.js';
import './spark-modular-reconciliation.js';
import './spark-modular-record-codec.js';
import './spark-modular-transaction-transport.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular',ownerUid='spark-import-owner',businessId='import-business';
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules:await readFile('firestore.spark.rules','utf8')}});
const client=env.authenticatedContext(ownerUid).firestore();
let beforePageRead=null,beforeActivationTransaction=null,activePageReads=0,maxActivePageReads=0;
const wrap=snap=>({exists:snap.exists(),data:()=>snap.data()});
// SDK-shape compatibility only: all reads, transactions and Rules are executed
// by the real authenticated Web client, never an Admin transport.
const db={app:{options:{projectId}},doc:path=>{
  const ref=doc(client,path);
  ref.get=async options=>{assert.equal(options.source,'server');const s=await getDocFromServer(ref);return {...wrap(s),metadata:s.metadata};};
  return ref;
},
  collection:path=>({orderBy:field=>{
    const constraints=[orderBy(field)];
    const page={limit:n=>{constraints.push(limit(n));return page;},startAfter:id=>{constraints.push(startAfter(id));return page;},
      get:async options=>{
        assert.equal(options.source,'server');activePageReads++;maxActivePageReads=Math.max(maxActivePageReads,activePageReads);
        try{if(beforePageRead)await beforePageRead();return await getDocsFromServer(query(collection(client,path),...constraints));}
        finally{activePageReads--;}
      }};
    return page;}}),
  runTransaction:async callback=>{
    if(beforeActivationTransaction){const hook=beforeActivationTransaction;beforeActivationTransaction=null;await hook();}
    return runTransaction(client,tx=>callback({get:async ref=>wrap(await tx.get(ref)),set:(ref,data)=>tx.set(ref,data),update:(ref,data)=>tx.update(ref,data)}));
  }};
const firebase={firestore:{FieldValue:{serverTimestamp},FieldPath:{documentId}}};
const api=globalThis.CLICK360_SPARK_MIGRATION;
const identity={ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,schemaVersion:10};
const secondBusinessId='runtime-empty-business';
const remote={identity,businesses:[{id:businessId,name:'Synthetic import'},{id:secondBusinessId,name:'Second synthetic import'}],products:Array.from({length:130},(_,i)=>({id:`p-${i}`,businessId,stock:2,qty:2})),sales:[],movements:[],cashSessions:[],dailyReports:[],invoices:[],auditLogs:[],deletedProducts:[],settings:{workers:[],labelTemplates:[]}};
const local=structuredClone(remote);local.products[0].stock=1;local.products[0].qty=1;
local.cashSessions.push({id:'historical-session',operationId:'historical-opening',businessId,date:'2026-09-03',status:'open',openingAmount:0});
local.sales.push({id:'historical-sale',operationId:'historical-sale',businessId,cashSessionId:'historical-session',
  date:'2026-09-03',total:30,received:30,iva:0,method:'Transferencia',businessDate:'2026-09-03',items:[{id:'p-0',qty:1}]});
local.movements.push({id:'historical-opening',operationId:'historical-opening',businessId,cashSessionId:'historical-session',date:'2026-09-03',kind:'apertura',amount:0},
  {id:'historical-movement',operationId:'historical-sale',businessId,cashSessionId:'historical-session',date:'2026-09-03',
    kind:'ingreso',paymentType:'sale',paymentMethod:'Transferencia',saleId:'historical-sale',amount:30});
// Match the real published envelope: identity is outside the commercial body.
delete remote.identity;delete local.identity;
const rootState={...identity,revision:42,payload:{schemaVersion:10,identity,data:remote}};
const pins=new Map();let interrupt=true,currentUser={uid:ownerUid};
const input={db,firebase,projectId,ownerUid,buildSha:'21409a1d2dc710315ab8c3c27e5da566f004cc8e',deviceId:'synthetic-device',resolveUser:()=>currentUser,requireCashProof:true,
  readGuard:async()=>({ownerUid,deviceRevision:'device-43',unknownOperations:0,mutationLockHeld:true}),
  readSource:async()=>{const snap=await getDocFromServer(doc(client,`businesses/${ownerUid}/state/main`));return {remote:{source:'server',identity:snap.data().payload.identity,revision:snap.data().revision,snapshot:snap.data().payload.data},
    local:{identity,durable:true,snapshot:local,deviceRevision:'device-43',baseRevision:42,pendingRemoteSync:true,pendingOperations:[{operationId:'persist-existing'}]},unknownOperations:0};},
  // Synthetic recovery adapter here; physical IndexedDB belongs to PWA E2E.
  recovery:{pin:async row=>pins.set(row.sourceHash,structuredClone(row)),read:async key=>({...structuredClone(pins.get(key)),durable:true})},
  onProgress:event=>{if(interrupt&&event.phase==='SHADOW_WRITING'&&event.completed>0){assert.equal(event.completed,100,'Client Rules certify the full bounded 100-record chunk');interrupt=false;throw Error('SIMULATED_INTERRUPTED_UPLOAD');}}};
try{
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),`approvedUsers/${ownerUid}`),{uid:ownerUid,ownerId:ownerUid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(c.firestore(),`businesses/${ownerUid}/state/main`),rootState);
    await setDoc(doc(c.firestore(),'storageRollout/sparkV1'),{enabled:true,pilotOwnerUids:[ownerUid]});
  });
  const importer=globalThis.CLICK360_SPARK_IMPORTER.create(input);
  await assert.rejects(importer.prepareShadow(),/SIMULATED_INTERRUPTED_UPLOAD/);
  const result=await importer.prepareShadow();
  assert.equal(maxActivePageReads,8,'All scopes, including empty modules, use a bounded eight-query verification pool');
  assert.equal(activePageReads,0,'All rereads finish before semantic comparison');
  assert.equal(result.cutoverPerformed,false);assert.equal(result.equality.status,'SEMANTIC_EQUALITY_PASS');
  assert.equal(result.equality.sourceHash,await api.hash(local));
  // The real authenticated SDK must not bypass the pending operational Rules
  // gate. Even a transport in verified modular mode cannot mutate commercial
  // records until those Rules/domain operations are explicitly certified.
  const transport=globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({db,projectId,ownerUid,businessId,resolveUser:()=>currentUser});
  await assert.rejects(()=>transport.run(()=>{}),/CUTOVER_NOT_VERIFIED/);
  const storageRef=doc(client,`businesses/${ownerUid}/metadata/storage`);
  const savedControl=(await getDocFromServer(storageRef)).data();
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),storageRef.path),{...savedControl,storageMode:'modular',phase:'MODULAR'}));
  await transport.run(async tx=>{const p=await tx.get('products','p-0');assert.equal(p.stock,1);assert.equal(p.qty,1);});
  await assertFails(transport.run(async tx=>{const p=await tx.get('products','p-0');tx.update('products','p-0',{...p,stock:0,qty:0,recordVersion:2});}));
  assert.equal((await getDocFromServer(doc(client,`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/products/p-0`))).data().data.stock,1);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),storageRef.path),savedControl));
  const retry=await importer.prepareShadow();assert.deepEqual(retry.equality,result.equality);
  // A failed verification query must settle the bounded in-flight read pool
  // before closing its recovery resources or returning an error to bootstrap.
  beforePageRead=async()=>{beforePageRead=null;throw Error('SYNTHETIC_QUERY_INTERRUPTED');};
  await assert.rejects(importer.prepareShadow(),/SYNTHETIC_QUERY_INTERRUPTED/);
  assert.equal(activePageReads,0,'Failed verification cannot leave authoritative queries running after cleanup');
  assert.deepEqual((await importer.prepareShadow()).equality,result.equality,'Interrupted reread resumes without rewriting source or duplicating records');
  // Exercise the bootstrap connection with the AUTHENTICATED Web SDK and
  // real Rules. This still uses an explicit synthetic recovery/journal adapter;
  // physical IndexedDB is independently tested by the browser suite.
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'storageRollout/sparkV1'),{
    enabled:true,automaticShadow:true,pilotOwnerUids:[ownerUid]}));
  globalThis.CLICK360_MODULAR_JOURNAL={open:async()=>({
    captureOwner:async()=>({ownerUid,rows:[],recordCount:0,enumerationComplete:true}),
    assertOwnerCoverage:async()=>({enumerationComplete:true,recordCount:0}),
    countPending:async()=>({countIsBounded:false,total:0,pendingCount:0,unknownCount:0}),
    countProjectionPending:async()=>0,listPendingPage:async()=>({rows:[],next:null,complete:true}),close(){}})};
  const handoffPins=new Map();
  globalThis.CLICK360_SPARK_RECOVERY={open:async()=>({...input.recovery,
    pinHandoff:async plan=>{const captureHash=await api.hash({kind:'READ_ONLY_HANDOFF_PLAN',ownerUid,plan});handoffPins.set(captureHash,structuredClone(plan));return {captureHash};},
    readHandoff:async captureHash=>({captureHash,durable:true,plan:structuredClone(handoffPins.get(captureHash))}),
    captureDevice:async value=>({captureHash:await api.hash(value),durable:true}),
    deviceIdentity:async()=>({ownerUid,deviceId:input.deviceId,durable:true}),close(){}})};
  const connected=await CLICK360_SPARK_MIGRATION_BOOTSTRAP.create({...input,actorUid:ownerUid,
    resolveContext:()=>({authUid:ownerUid,ownerUid}),leaseHeld:()=>true,
    readLocal:async()=>({snapshot:local,identity,deviceRevision:'device-43',baseRevision:42,
      pendingRemoteSync:true,cloudCapacityBlocked:true,pendingOperations:['persist-existing']})}).prepare();
  assert.equal(connected.prepared,true);assert.equal(connected.operationalCloudConfirmed,false);
  assert.equal(connected.handoffPrepared,true);assert.equal(connected.handoff.plan.cutoverAllowed,false);
  assert.equal(connected.handoff.plan.runtimes[0].content.data.openCashSessionId,'historical-session');
  const connectedSourcePin=structuredClone(pins.get(connected.handoff.plan.sourceHash));
  assert.deepEqual(connected.equality,result.equality);assert.equal(connected.cutoverPerformed,false);
  // A revision alone is not a hash precondition. Simulate authorized external
  // maintenance during the server reread, after the initial revision CAS.
  const drift=structuredClone(rootState);drift.payload.data.products[1].stock=3;drift.payload.data.products[1].qty=3;
  beforePageRead=async()=>{beforePageRead=null;
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`businesses/${ownerUid}/state/main`),drift));};
  try{await assert.rejects(importer.prepareShadow(),/SOURCE_CHANGED_STOP/);}
  finally{beforePageRead=null;await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`businesses/${ownerUid}/state/main`),rootState));}
  await assert.rejects(globalThis.CLICK360_SPARK_IMPORTER.create({...input,deviceId:'different-device'}).prepareShadow(),/ALREADY_CLAIMED/);
  await assert.rejects(globalThis.CLICK360_SPARK_IMPORTER.create({...input,readGuard:async()=>({ownerUid,deviceRevision:'device-43',unknownOperations:0,mutationLockHeld:false})}).prepareShadow(),/DEVICE_GUARD_CHANGED_STOP/);
  // An extra record in a source-empty module must not escape verification.
  const orphanPath=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/customers/orphan`;
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),orphanPath),{unexpected:true}));
  await assert.rejects(importer.prepareShadow(),/REMOTE_COUNT_MISMATCH/);
  await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),orphanPath)));
  assert.deepEqual((await getDocFromServer(doc(client,`businesses/${ownerUid}/state/main`))).data(),rootState);
  await assertFails(setDoc(doc(client,`businesses/${ownerUid}/state/main`),rootState));
  currentUser={uid:'different-owner'};
  await assert.rejects(importer.prepareShadow(),/OWNER_CONTEXT_CHANGED/);currentUser={uid:ownerUid};
  const originalStock=local.products[0].stock;local.products[0].stock=0;local.products[0].qty=0;
  await assert.rejects(importer.prepareShadow(),/ALREADY_CLAIMED/);
  local.products[0].stock=originalStock;local.products[0].qty=originalStock;
  assert.throws(()=>globalThis.CLICK360_SPARK_IMPORTER.create({...input,projectId:'click-360'}),/NONPRODUCTION_ONLY/);
  // The SAME authenticated client prepares derived runtime only after an
  // administrative, source/build/plan/whole-owner approval. No mode changes.
  const handoff=connected.handoff,approval=await CLICK360_SPARK_HANDOFF.runtimeApproval(handoff.plan,input.buildSha);
  assert.equal(approval.captureHash,handoff.captureHash);
  const journalCapture={ownerUid,rows:[],recordCount:0,enumerationComplete:true};
  input.recovery.readHandoff=async captureHash=>({captureHash,durable:true,plan:structuredClone(handoffPins.get(captureHash))});
  const guardBase={ownerUid,deviceRevision:'device-43',unknownOperations:0,mutationLockHeld:true,
    deviceMetadataHash:handoff.plan.deviceMetadataHash,journalCapture};
  input.readGuard=async()=>structuredClone(guardBase);
  const runtimeImporter=CLICK360_SPARK_IMPORTER.create(input),runtimeRequest={captureHash:handoff.captureHash};
  const authorized={enabled:true,pilotOwnerUids:[ownerUid],automaticShadow:true,automaticRuntimePreparation:true};
  const setPolicy=policy=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'storageRollout/sparkV1'),policy));
  const approvalPath=`businesses/${ownerUid}/storageApprovals/runtimePreparation`;
  const setApproval=value=>env.withSecurityRulesDisabled(c=>value===null
    ?deleteDoc(doc(c.firestore(),approvalPath)):setDoc(doc(c.firestore(),approvalPath),value));
  const runtime={...handoff.plan.runtimes.find(row=>row.content.businessId===businessId),content:approval.runtimeRecords[businessId]};
  const runtimeRef=doc(client,runtime.path);
  await assertFails(setDoc(doc(client,'storageRollout/sparkV1'),authorized),'Client cannot approve its own runtime');
  await assertFails(setDoc(doc(client,approvalPath),approval),'Owner cannot self-approve private runtime preparation');
  await assertFails(setDoc(runtimeRef,runtime.content),'Default policy cannot create runtime');
  await assert.rejects(runtimeImporter.prepareRuntime(runtimeRequest),/ADMIN_APPROVAL_REQUIRED/);
  for(const candidate of [
    {policy:{...authorized,automaticRuntimePreparation:false},approval},
    {policy:{...authorized,pilotOwnerUids:['different-owner']},approval},
    {policy:authorized,approval:null},
    ...[{ownerUid:'different-owner'},{sourceHash:'f'.repeat(64)},{buildSha:'f'.repeat(40)},
      {planHash:'f'.repeat(64)},{businessIds:[businessId]},
      {runtimeRecords:{...approval.runtimeRecords,[businessId]:{...runtime.content,dataHash:'f'.repeat(64)}}},
      {runtimeHashes:{...approval.runtimeHashes,[businessId]:'f'.repeat(64)}}]
      .map(delta=>({policy:authorized,approval:{...approval,...delta}}))
  ]){
    await setPolicy(candidate.policy);await setApproval(candidate.approval);
    await assert.rejects(runtimeImporter.prepareRuntime(runtimeRequest),/ADMIN_APPROVAL_REQUIRED/);
    await assertFails(setDoc(runtimeRef,runtime.content),'Server Rules must reject the same mismatched approval independently');
    assert.equal((await getDocFromServer(runtimeRef)).exists(),false);
  }
  await setPolicy(authorized);await setApproval(approval);
  assert.deepEqual((await getDocFromServer(doc(client,approvalPath))).data(),approval);
  const adminClient=env.authenticatedContext('synthetic-storage-administrator',{email:'roddysmithceo@gmail.com'}).firestore();
  assert.deepEqual((await getDocFromServer(doc(adminClient,approvalPath))).data(),approval);
  await setDoc(doc(adminClient,approvalPath),approval);
  await assertFails(setDoc(doc(adminClient,`businesses/${ownerUid}/storageApprovals/unsupported`),approval));
  await assertFails(setDoc(doc(adminClient,'storageRollout/sparkV1'),{...authorized,runtimePreparationApprovals:{[ownerUid]:approval}}));
  const privateWorkerUid='runtime-private-worker';
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),`approvedUsers/${privateWorkerUid}`),{uid:privateWorkerUid,ownerId:ownerUid,
      businessUnitId:businessId,approved:true,status:'active',role:'cashier'});
    await setDoc(doc(c.firestore(),`businesses/${ownerUid}/businessUnits/${businessId}/members/${privateWorkerUid}`),
      {uid:privateWorkerUid,ownerUid,businessId,status:'active',role:'cashier',permissions:{cashSessions:{read:true}}});
  });
  for(const forbidden of [env.authenticatedContext('unrelated-runtime-owner').firestore(),
    env.authenticatedContext(privateWorkerUid).firestore(),env.unauthenticatedContext().firestore()]){
    await assertFails(getDocFromServer(doc(forbidden,approvalPath)));
    await assertFails(setDoc(doc(forbidden,approvalPath),approval));
  }
  const publicFlags=(await getDocFromServer(doc(client,'storageRollout/sparkV1'))).data();
  assert(!Object.hasOwn(publicFlags,'runtimePreparationApprovals')&&!Object.hasOwn(publicFlags,'cutoverApprovals'));
  for(const delta of [{ownerUid:'other-owner'},{dataHash:'f'.repeat(64)},
    {data:{...runtime.content.data,openCashSessionId:'another-session'}}])
    await assertFails(setDoc(runtimeRef,{...runtime.content,...delta}));
  const stranger=env.authenticatedContext('runtime-stranger').firestore();
  await assertFails(setDoc(doc(stranger,runtime.path),runtime.content));
  for(const delta of [{deviceMetadataHash:'f'.repeat(64)},
    {journalCapture:{...journalCapture,rows:[{state:'unknown'}],recordCount:1}},{unknownOperations:1}]){
    const bad=CLICK360_SPARK_IMPORTER.create({...input,readGuard:async()=>({...guardBase,...delta})});
    await assert.rejects(bad.prepareRuntime(runtimeRequest),/DEVICE_OR_JOURNAL_DRIFT_STOP/);
  }
  const runtimeRemoteDrift=structuredClone(rootState);runtimeRemoteDrift.payload.data.products[2].stock=3;runtimeRemoteDrift.payload.data.products[2].qty=3;
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`businesses/${ownerUid}/state/main`),runtimeRemoteDrift));
  try{await assert.rejects(runtimeImporter.prepareRuntime(runtimeRequest),/CONTROL_CONFLICT|SOURCE_CHANGED_STOP/);}
  finally{await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`businesses/${ownerUid}/state/main`),rootState));}
  // A forged summary with the original hash cannot pass Rules: compare the
  // whole admin-approved summary, because Rules cannot calculate SHA-256.
  const sessionRef=doc(client,`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/cashSessions/historical-session`);
  const sessionBefore=(await getDocFromServer(sessionRef)).data();
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),sessionRef.path),{
    ...sessionBefore,operational:{...sessionBefore.operational,saleCount:99}}));
  await assertFails(setDoc(runtimeRef,runtime.content));
  await assert.rejects(runtimeImporter.prepareRuntime(runtimeRequest),/EXACT_SESSION_UNVERIFIED/);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),sessionRef.path),sessionBefore));
  const commerceBefore=[];
  for(const row of result.manifest.records){const s=await getDocFromServer(doc(client,row.path));commerceBefore.push({path:row.path,content:s.data()});}
  let runtimeInterrupted=false;
  const interruptedRuntime=CLICK360_SPARK_IMPORTER.create({...input,onProgress:event=>{
    if(event.phase==='RUNTIME_PREPARING'&&!runtimeInterrupted){runtimeInterrupted=true;throw Error('SIMULATED_RUNTIME_INTERRUPTION');}
  }});
  await assert.rejects(interruptedRuntime.prepareRuntime(runtimeRequest),/SIMULATED_RUNTIME_INTERRUPTION/);
  assert.equal((await getDocFromServer(storageRef)).data().storageMode,'migrating');
  assert.equal((await getDocFromServer(storageRef)).data().phase,'READY_TO_CUTOVER');
  // The exact approved derived record is allowed on shadow resume, while
  // every unrelated orphan remains a semantic-comparison failure.
  assert.deepEqual((await runtimeImporter.prepareShadow()).equality,result.equality);
  const runtimeResult=await runtimeImporter.prepareRuntime(runtimeRequest);
  assert.equal(runtimeResult.status,'RUNTIME_PREPARED');assert.equal(runtimeResult.cutoverPerformed,false);
  assert.deepEqual(await runtimeImporter.prepareRuntime(runtimeRequest),runtimeResult,'Runtime preparation retry creates no duplicate writes');
  for(const row of handoff.plan.runtimes)assert.deepEqual((await getDocFromServer(doc(client,row.path))).data(),approval.runtimeRecords[row.content.businessId]);
  assert.equal(handoff.plan.runtimes.find(row=>row.content.businessId===secondBusinessId).content.data.openCashSessionId,'');
  await assertFails(setDoc(runtimeRef,runtime.content),'Runtime preparation is create-only; existing identical records need no write');
  await assert.rejects(transport.run(()=>{}),/CUTOVER_NOT_VERIFIED/,'Runtime installation is not writer activation');
  const metadataOrphan=doc(client,`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/unapproved`);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),metadataOrphan.path),{unexpected:true}));
  await assert.rejects(runtimeImporter.prepareShadow(),/REMOTE_COUNT_MISMATCH/);
  await env.withSecurityRulesDisabled(c=>deleteDoc(doc(c.firestore(),metadataOrphan.path)));
  const conflicting={...runtime.content,data:{...runtime.content.data,openCashSessionId:'wrong-session'}};
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),runtime.path),conflicting));
  await assert.rejects(runtimeImporter.prepareRuntime(runtimeRequest),/EXISTING_CONFLICT/);
  await assert.rejects(runtimeImporter.prepareShadow(),/UNAPPROVED_DERIVED_RECORD/);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),runtime.path),runtime.content));
  assert.deepEqual((await runtimeImporter.prepareShadow()).equality,result.equality);
  for(const row of commerceBefore)assert.deepEqual((await getDocFromServer(doc(client,row.path))).data(),row.content);
  assert.deepEqual((await getDocFromServer(storageRef)).data(),savedControl);
  assert.deepEqual((await getDocFromServer(doc(client,`businesses/${ownerUid}/state/main`))).data(),rootState);
  // A local bootstrap handoff is a READ-ONLY consumer of an ALREADY approved
  // cutover. It must read the private approvals, source pin and every module
  // using the real owner Web SDK, without changing any commercial records.
  for(const manifest of [{...result.manifest,ownerUid:'other-owner'},
    {...result.manifest,records:[{...result.manifest.records[0],path:'businesses/other-owner/legacyConfig/stolen'}]}])
    await assert.rejects(runtimeImporter.readServerRecords(manifest),/READ_SCOPE_INVALID/);
  pins.set(connected.handoff.plan.sourceHash,connectedSourcePin);
  const localRecord={snapshot:local,identity,deviceRevision:'device-43',baseRevision:42,
    pendingRemoteSync:true,cloudCapacityBlocked:true,pendingOperations:['persist-existing']};
  const localHandoff=CLICK360_SPARK_MIGRATION_BOOTSTRAP.create({...input,actorUid:ownerUid,
    resolveContext:()=>({authUid:ownerUid,ownerUid}),leaseHeld:()=>true,readLocal:async()=>structuredClone(localRecord)});
  await assert.rejects(localHandoff.verifyLocalHandoff(),/ADMIN_APPROVAL_REQUIRED/);
  await setPolicy({...authorized,automaticCutover:true});
  const cutoverApprovalPath=`businesses/${ownerUid}/storageApprovals/cutover`;
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),cutoverApprovalPath),{
    ownerUid,sourceHash:approval.sourceHash,buildSha:input.buildSha,businessIds:approval.businessIds}));
  await assert.rejects(localHandoff.activateApproved(),/AUTOMATIC_ACTIVATION_DISABLED/);
  assert.deepEqual((await getDocFromServer(storageRef)).data(),savedControl);
  await setPolicy({...authorized,automaticCutover:true,automaticMigration:true});
  const cutoverApproval={ownerUid,sourceHash:approval.sourceHash,buildSha:input.buildSha,businessIds:approval.businessIds};
  const firstRuntime=connected.handoff.plan.runtimes[0],originalRuntime=approval.runtimeRecords[firstRuntime.content.businessId];
  for(const [path,value,restore,reason]of [
    [storageRef.path,{...savedControl,recordVersion:savedControl.recordVersion+1},savedControl,/ACTIVATION_CONTROL_CHANGED/],
    [cutoverApprovalPath,{...cutoverApproval,sourceHash:'f'.repeat(64)},cutoverApproval,/ACTIVATION_ADMIN_APPROVAL_CHANGED/],
    [`businesses/${ownerUid}/storageApprovals/runtimePreparation`,null,approval,/ACTIVATION_ADMIN_APPROVAL_CHANGED/],
    [`businesses/${ownerUid}/state/main`,{...rootState,payload:{...rootState.payload,data:{...rootState.payload.data,interruptedMaintenance:true}}},rootState,/ACTIVATION_REMOTE_DRIFT_STOP/],
    [firstRuntime.path,{...originalRuntime,recordVersion:2},originalRuntime,/ACTIVATION_RUNTIME_CHANGED/]
  ]){
    // Authorized synthetic maintenance between the full preflight and commit
    // must not be hidden by a matching old approval/source revision.
    beforeActivationTransaction=()=>env.withSecurityRulesDisabled(c=>value===null
      ?deleteDoc(doc(c.firestore(),path)):setDoc(doc(c.firestore(),path),value));
    await assert.rejects(localHandoff.activateApproved(),reason);
    assert.equal((await getDocFromServer(storageRef)).data().storageMode,'migrating');
    await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),restore));
  }
  const activation=await localHandoff.activateApproved();
  assert.equal(activation.phase,'MODULAR');assert.equal(activation.cutoverPerformed,true);
  assert.equal(activation.operationalCloudConfirmed,false);
  assert.equal((await getDocFromServer(storageRef)).data().recordVersion,savedControl.recordVersion+1);
  const handoffVerified=await localHandoff.verifyLocalHandoff();
  assert.equal(handoffVerified.status,'LOCAL_HANDOFF_VERIFIED');await handoffVerified.assertStable();
  assert.equal(handoffVerified.sourceHash,result.equality.sourceHash);
  assert.deepEqual(handoffVerified.businessIds,approval.businessIds);
  assert.deepEqual(pins.get(approval.sourceHash),connectedSourcePin);
  for(const row of commerceBefore)assert.deepEqual((await getDocFromServer(doc(client,row.path))).data(),row.content);
  const changedProduct=commerceBefore.find(row=>row.content.module==='products');
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),changedProduct.path),{
    ...changedProduct.content,data:{...changedProduct.content.data,stock:0,qty:0}}));
  await assert.rejects(localHandoff.verifyLocalHandoff(),/SERVER_RECORD_DRIFT_STOP/,'New remote operations require a later reconciliation unit, never overwrite');
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),changedProduct.path),changedProduct.content));
  currentUser={uid:'revoked-owner'};await assert.rejects(handoffVerified.assertStable(),/CONTEXT_CHANGED/);currentUser={uid:ownerUid};
  assert.deepEqual(localRecord.pendingOperations,['persist-existing']);
  assert.deepEqual((await getDocFromServer(doc(client,`businesses/${ownerUid}/state/main`))).data(),rootState);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),storageRef.path),savedControl));
  await setPolicy(authorized);
  console.log(JSON.stringify({status:'PASS',clientRules:true,sourceHash:result.equality.sourceHash,reconstructedHash:result.equality.reconstructedHash,
    records:result.manifest.recordCount,interruptedResume:true,idempotent:true,pendingLocalSalePreserved:true,sameRevisionRemoteDriftStops:true,
    runtimePreparation:true,runtimeInterruptedResume:true,runtimeBusinessCoverage:2,approvedDerivedRuntimeOnly:true,
    localPostCutoverHandoff:true,localHandoffServerDriftRejected:true,approvedAutomaticActivation:true,
    commercialRecordsUnchanged:true,legacyUnchanged:true,syntheticCutover:true,productionCutover:false,productionWrites:0}));
}finally{await env.cleanup();}
