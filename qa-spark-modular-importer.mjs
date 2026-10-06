import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,deleteDoc,getDocFromServer,getDocsFromServer,collection,query,orderBy,documentId,limit,startAfter,runTransaction,serverTimestamp} from 'firebase/firestore';
import './spark-modular-migration.js';
import './spark-modular-importer.js';
import './spark-modular-record-codec.js';
import './spark-modular-transaction-transport.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular',ownerUid='spark-import-owner',businessId='import-business';
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules:await readFile('firestore.spark.rules','utf8')}});
const client=env.authenticatedContext(ownerUid).firestore();
const wrap=snap=>({exists:snap.exists(),data:()=>snap.data()});
// SDK-shape compatibility only: all reads, transactions and Rules are executed
// by the real authenticated Web client, never an Admin transport.
const db={app:{options:{projectId}},doc:path=>doc(client,path),
  collection:path=>({orderBy:field=>{
    const constraints=[orderBy(field)];
    const page={limit:n=>{constraints.push(limit(n));return page;},startAfter:id=>{constraints.push(startAfter(id));return page;},
      get:async options=>{assert.equal(options.source,'server');return getDocsFromServer(query(collection(client,path),...constraints));}};
    return page;}}),
  runTransaction:callback=>runTransaction(client,tx=>callback({get:async ref=>wrap(await tx.get(ref)),set:(ref,data)=>tx.set(ref,data),update:(ref,data)=>tx.update(ref,data)}))};
const firebase={firestore:{FieldValue:{serverTimestamp},FieldPath:{documentId}}};
const api=globalThis.CLICK360_SPARK_MIGRATION;
const identity={ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,schemaVersion:10};
const remote={identity,businesses:[{id:businessId,name:'Synthetic import'}],products:Array.from({length:30},(_,i)=>({id:`p-${i}`,businessId,stock:2,qty:2})),sales:[],movements:[],cashSessions:[],dailyReports:[],invoices:[],auditLogs:[],deletedProducts:[],settings:{workers:[],labelTemplates:[]}};
const local=structuredClone(remote);local.products[0].stock=1;local.products[0].qty=1;
local.sales.push({id:'historical-sale',operationId:'historical-sale',businessId,total:30,businessDate:'2026-09-03',items:[{id:'p-0',qty:1}]});
local.movements.push({id:'historical-movement',businessId,saleId:'historical-sale',amount:30});
// Match the real published envelope: identity is outside the commercial body.
delete remote.identity;delete local.identity;
const rootState={...identity,revision:42,payload:{schemaVersion:10,identity,data:remote}};
const pins=new Map();let interrupt=true,currentUser={uid:ownerUid};
const input={db,firebase,projectId,ownerUid,buildSha:'21409a1d2dc710315ab8c3c27e5da566f004cc8e',deviceId:'synthetic-device',resolveUser:()=>currentUser,
  readGuard:async()=>({ownerUid,deviceRevision:'device-43',unknownOperations:0,mutationLockHeld:true}),
  readSource:async()=>{const snap=await getDocFromServer(doc(client,`businesses/${ownerUid}/state/main`));return {remote:{source:'server',identity:snap.data().payload.identity,revision:snap.data().revision,snapshot:snap.data().payload.data},
    local:{identity,durable:true,snapshot:local,deviceRevision:'device-43',baseRevision:42,pendingRemoteSync:true,pendingOperations:[{operationId:'persist-existing'}]},unknownOperations:0};},
  // Synthetic recovery adapter here; physical IndexedDB belongs to PWA E2E.
  recovery:{pin:async row=>pins.set(row.sourceHash,structuredClone(row)),read:async key=>({...structuredClone(pins.get(key)),durable:true})},
  onProgress:event=>{if(interrupt&&event.completed===25){interrupt=false;throw Error('SIMULATED_INTERRUPTED_UPLOAD');}}};
try{
  await env.withSecurityRulesDisabled(async c=>{
    await setDoc(doc(c.firestore(),`approvedUsers/${ownerUid}`),{uid:ownerUid,ownerId:ownerUid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(c.firestore(),`businesses/${ownerUid}/state/main`),rootState);
    await setDoc(doc(c.firestore(),'storageRollout/sparkV1'),{enabled:true,pilotOwnerUids:[ownerUid]});
  });
  const importer=globalThis.CLICK360_SPARK_IMPORTER.create(input);
  await assert.rejects(importer.prepareShadow(),/SIMULATED_INTERRUPTED_UPLOAD/);
  const result=await importer.prepareShadow();
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
  assert.equal((await getDocFromServer(doc(client,`businesses/${ownerUid}/businessUnits/${businessId}/products/p-0`))).data().data.stock,1);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),storageRef.path),savedControl));
  const retry=await importer.prepareShadow();assert.deepEqual(retry.equality,result.equality);
  await assert.rejects(globalThis.CLICK360_SPARK_IMPORTER.create({...input,deviceId:'different-device'}).prepareShadow(),/ALREADY_CLAIMED/);
  await assert.rejects(globalThis.CLICK360_SPARK_IMPORTER.create({...input,readGuard:async()=>({ownerUid,deviceRevision:'device-43',unknownOperations:0,mutationLockHeld:false})}).prepareShadow(),/DEVICE_GUARD_CHANGED_STOP/);
  // An extra record in a source-empty module must not escape verification.
  const orphanPath=`businesses/${ownerUid}/businessUnits/${businessId}/customers/orphan`;
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
  console.log(JSON.stringify({status:'PASS',clientRules:true,sourceHash:result.equality.sourceHash,reconstructedHash:result.equality.reconstructedHash,
    records:result.manifest.recordCount,interruptedResume:true,idempotent:true,pendingLocalSalePreserved:true,legacyUnchanged:true,cutover:false,productionWrites:0}));
}finally{await env.cleanup();}
