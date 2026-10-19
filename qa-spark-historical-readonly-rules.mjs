import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,deleteDoc,getDocFromServer,runTransaction,serverTimestamp} from 'firebase/firestore';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './spark-modular-transaction-transport.js';
import './modular-persistence.js';
import './modular-operation-journal.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular',ownerUid='historical-readonly-owner',businessId='historical-business';
const migration=globalThis.CLICK360_SPARK_MIGRATION,codec=globalThis.CLICK360_SPARK_RECORD_CODEC;
const api=globalThis.CLICK360_MODULAR_PERSISTENCE,identity=api.identity(ownerUid,businessId),sourceHash='c'.repeat(64);
const base=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2`,control=`businesses/${ownerUid}/metadata/storage`;
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules:await readFile('firestore.spark.rules','utf8')}});
const client=env.authenticatedContext(ownerUid).firestore(),other=env.authenticatedContext('historical-intruder').firestore();
const raw=async(module,id,data)=>({id,ownerUid,businessId,schemaVersion:2,module,sourceHash,sourcePath:[module,0],data,
  dataHash:await migration.hash(data),historyPolicy:{version:1,mode:'CLOSED_READ_ONLY',sourceHash,
    recordHash:await migration.hash(data),reason:'MIGRATION_CASH_HISTORICAL_COMPONENT_UNVERIFIED'}});
try{
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,`approvedUsers/${ownerUid}`),{uid:ownerUid,ownerId:ownerUid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(db,control),{ownerUid,schemaVersion:2,storageMode:'migrating',phase:'SHADOW_WRITING',sourceHash,businessIds:[businessId]});
    await setDoc(doc(db,'storageRollout/sparkV1'),{enabled:true,pilotOwnerUids:[ownerUid]});
  });
  const session=await raw('cashSessions','historic-session',{id:'historic-session',businessId,date:'2026-09-03',
    status:'closed',closedAt:'2026-09-04T00:00:00Z',openingAmount:0,reportId:'historic-report'});
  const report=await raw('dailyReports','historic-report',{id:'historic-report',businessId,cashSessionId:'historic-session',
    date:'2026-09-03',status:'closed',saleIds:['historic-sale']});
  const sale=await raw('sales','historic-sale',{id:'historic-sale',businessId,cashSessionId:'historic-session',total:30,
    received:30,method:'Transferencia',payments:[{id:'legacy-payment',amount:30,method:{0:{},1:{},2:{}}}]});
  for(const row of [session,report,sale])await setDoc(doc(client,`${base}/${row.module}/${row.id}`),row);
  const verified=structuredClone(session);delete verified.historyPolicy;
  verified.id='verified-shadow';verified.data.id=verified.id;
  verified.dataHash=await migration.hash(verified.data);
  verified.operational={summaryVersion:1,saleCount:1,salesTotal:30,itemCount:1,taxTotal:0,cashBalance:0,
    openingAmount:0,incomeCash:0,expenseCash:0,paymentTotals:{cash:0,card:0,transfer:30,receivablePayments:0},closeCycle:1};
  verified.operationalHash=await migration.hash(verified.operational);
  await setDoc(doc(client,`${base}/cashSessions/${verified.id}`),verified);
  const wrongSummary=structuredClone(verified);wrongSummary.id='wrong-summary';wrongSummary.data.id=wrongSummary.id;
  wrongSummary.operational.saleCount=-1;
  await assertFails(setDoc(doc(client,`${base}/cashSessions/${wrongSummary.id}`),wrongSummary));
  for(const change of [r=>{r.historyPolicy.mode='WRITABLE';},r=>{r.historyPolicy.version=2;},
    r=>{r.historyPolicy.recordHash='f'.repeat(64);},r=>{r.historyPolicy.sourceHash='f'.repeat(64);},
    r=>{r.data.status='open';},r=>{r.operational={summaryVersion:1,saleCount:0};}]){
    const forged=structuredClone(session);forged.id='forged-session';forged.data.id=forged.id;change(forged);
    await assertFails(setDoc(doc(client,`${base}/cashSessions/${forged.id}`),forged));
  }
  await assertFails(setDoc(doc(other,`${base}/cashSessions/other`),{...session,id:'other'}));
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await updateDoc(doc(db,control),{storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',reconstructedHash:sourceHash});
    await setDoc(doc(db,`${base}/metadata/runtime`),await codec.pack({id:'runtime',...identity,module:'metadata',recordVersion:1,
      summaryVersion:1,openCashSessionId:''},{identity,moduleName:'metadata',recordId:'runtime'}));
  });
  for(const row of [session,report,sale]){
    const path=`${base}/${row.module}/${row.id}`;
    await assertFails(updateDoc(doc(client,path),{historyPolicy:{...row.historyPolicy,mode:'WRITABLE'}}));
    const replacement={...row,recordVersion:2,updatedAt:serverTimestamp(),createdAt:serverTimestamp(),updatedBy:ownerUid,
      createdBy:ownerUid,lastOperationId:'forged-reopen',data:{...row.data,status:'open'},
      operational:{summaryVersion:1,saleCount:0,salesTotal:0,cashBalance:0,closeCycle:2,paymentTotals:{}}};
    delete replacement.historyPolicy;
    await assertFails(setDoc(doc(client,path),replacement));
    await assertFails(deleteDoc(doc(client,path)));
    assert.deepEqual((await getDocFromServer(doc(client,path))).data(),row);
  }
  const db={app:{options:{projectId}},doc:path=>doc(client,path),runTransaction:fn=>runTransaction(client,tx=>fn({
    get:async ref=>{const s=await tx.get(ref);return {exists:s.exists(),data:()=>s.data()};},set:(ref,data)=>tx.set(ref,data)}))};
  const transport=globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({db,projectId,ownerUid,businessId,actorUid:ownerUid,resolveUser:()=>({uid:ownerUid})});
  const repo=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,transport,serverTimestamp});
  await repo.commitOperation('cash_open',{operationId:'new-independent-opening',cashSessionId:'new-independent-session',date:'2026-10-16',openingAmount:0});
  const fresh=await getDocFromServer(doc(client,`${base}/cashSessions/new-independent-session`));
  assert.equal(fresh.metadata.fromCache,false);assert.equal(fresh.data().data.status,'open');
  assert.equal(fresh.data().operational.saleCount,0);
  for(const row of [session,report,sale])assert.deepEqual((await getDocFromServer(doc(client,`${base}/${row.module}/${row.id}`))).data(),row);
  console.log(JSON.stringify({status:'PASS',scope:'historical_readonly_client_rules',clientWebSDK:true,
    immutableHistory:true,shadowOnlyPolicy:true,fakeCountersDenied:true,sourceHashBound:true,newIndependentCashOpen:true,
    productionWrites:0,financialCorrections:0}));
}finally{await env.cleanup();}
