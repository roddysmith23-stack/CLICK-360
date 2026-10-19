import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import './modular-persistence.js';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:48940') throw new Error('EXACT_LOOPBACK_EMULATOR_REQUIRED');
const projectId='demo-click360-modular-capacity';
const app=initializeApp({projectId});
const db=getFirestore(app);
const api=globalThis.CLICK360_MODULAR_PERSISTENCE;
const firebase={firestore:{FieldValue}};
const owner='synthetic-capacity-owner';
const root=biz=>`businesses/${owner}/businessUnits/${biz}`;
const pending=[];
async function enqueue(path,data) {
  pending.push([path,data]);
  if(pending.length===400) await flush();
}
async function flush(){
  if(!pending.length)return;
  const batch=db.batch();
  pending.splice(0).forEach(([path,data])=>batch.set(db.doc(path),data));
  await batch.commit();
}
const record=(biz,id,extra={})=>({...api.identity(owner,biz),id,recordVersion:1,...extra});
try {
  await db.doc(`businesses/${owner}/featureFlags/modularStorage`).set({enabled:true,writeMode:'modular',schemaVersion:2,businessIds:['alpha','beta']});
  for(const [biz,count] of [['alpha',500],['beta',2000]]) {
    await enqueue(root(biz),record(biz,biz,{status:'CUTOVER_VERIFIED',legacyWriteFence:api.LEGACY_WRITE_FENCE}));
    await enqueue(`${root(biz)}/cashSessions/cash`,record(biz,'cash',{date:'2026-09-03',status:'open',salesTotal:0,saleCount:0}));
    for(let i=0;i<count;i++) await enqueue(`${root(biz)}/products/p-${i}`,record(biz,`p-${i}`,{stock:10,qty:10}));
  }
  for(let i=0;i<5000;i++) {
    await enqueue(`${root('alpha')}/sales/history-${i}`,record('alpha',`history-${i}`,{total:1}));
    await enqueue(`${root('alpha')}/movements/history-${i}`,record('alpha',`history-${i}`,{amount:1}));
    await enqueue(`${root('alpha')}/auditEvents/history-${i}`,record('alpha',`history-${i}`,{action:'legacy'}));
  }
  await flush();
  const legacy=db.doc(`businesses/${owner}/state/main`);
  await legacy.set({revision:12,sentinel:'UNCHANGED'});
  let reads=0,writes=0;
  const instrumented={collection:name=>db.collection(name),runTransaction:callback=>db.runTransaction(tx=>callback({
    get:ref=>{reads++;return tx.get(ref)},set:(...args)=>{writes++;return tx.set(...args)},update:(...args)=>{writes++;return tx.update(...args)}
  }))};
  const repo=biz=>api.createFirestoreRepository({db:instrumented,firebase,user:{uid:owner},ownerUid:owner,businessId:biz,projectId});
  const alpha=repo('alpha'), beta=repo('beta');
  const firstPage=await alpha.readPage('sales',{limit:25});
  const nextPage=await alpha.readPage('sales',{limit:25,afterId:firstPage.nextCursor});
  assert.equal(firstPage.records.length,25);assert.equal(nextPage.records.length,25);
  assert.equal(new Set([...firstPage.records,...nextPage.records].map(r=>r.id)).size,50);
  assert.equal(firstPage.records.every(r=>r.businessId==='alpha'),true);
  assert.equal((await beta.readPage('sales',{limit:25})).records.length,0);
  await assert.rejects(()=>alpha.readPage('sales',{limit:5000}),/LIMIT_INVALID/);
  await assert.rejects(()=>alpha.readPage('operationLedger'),/MODULE_UNSUPPORTED/);
  await assert.rejects(()=>alpha.readPage('sales',{afterId:'other-business/sale'}),/invalido/);
  const input=(operationId,expectedStock=10)=>({operationId,
    sale:{date:'2026-09-03',cashSessionId:'cash',total:30,items:[{productId:'p-0',qty:1,price:30}]},
    movement:{date:'2026-09-03',cashSessionId:'cash',amount:30,kind:'ingreso'},
    productChanges:[{productId:'p-0',quantity:1,expectedStock,expectedRecordVersion:1}]});
  const duplicate=await Promise.all([alpha.commitSale(input('sale-1')),alpha.commitSale(input('sale-1'))]);
  const prepared=await alpha.prepareOperation('sale',input('sale-1'));
  assert.equal((await alpha.lookupOperation('sale-1','sale',prepared.payloadSha256)).exists,true);
  assert.equal((await alpha.lookupOperation('never-applied','sale',prepared.payloadSha256)).exists,false);
  await assert.rejects(()=>alpha.lookupOperation('sale-1','sale','wrong-hash'),/IDEMPOTENCY_KEY_CONFLICT/);
  assert.deepEqual(duplicate.map(r=>r.status).sort(),['already_committed','committed']);
  assert.equal((await db.doc(`${root('alpha')}/products/p-0`).get()).data().stock,9);
  assert.equal((await db.doc(`${root('alpha')}/storageTelemetry/sale-sale-1`).get()).data().documentsWritten,7);
  assert.equal((await db.doc(`${root('beta')}/products/p-0`).get()).data().stock,10);
  const race=await Promise.allSettled([beta.commitSale(input('race-a')),beta.commitSale(input('race-b'))]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.doc(`${root('beta')}/products/p-0`).get()).data().stock,9);
  const close={operationId:'close-1',cashSessionId:'cash',report:{date:'2026-09-03',saleIds:['sale-1'],total:30}};
  const closes=await Promise.all([alpha.closeCashSession(close),alpha.closeCashSession(close)]);
  assert.deepEqual(closes.map(r=>r.status).sort(),['already_committed','committed']);
  assert.equal((await db.collection(`${root('alpha')}/dailyReports`).get()).size,1);
  assert.deepEqual((await legacy.get()).data(),{revision:12,sentinel:'UNCHANGED'});
  assert.equal((await db.doc(`${root('alpha')}/products/p-0`).get()).data().stock,9);
  await assert.rejects(()=>alpha.commitSale({...input('after-close',9),productChanges:[{productId:'p-0',quantity:1,expectedStock:9,expectedRecordVersion:2}]}),/SESSION_NOT_OPEN/);
  await assert.rejects(()=>alpha.commitSale({...input('duplicate-product'),productChanges:[input('x').productChanges[0],input('y').productChanges[0]]}),/DUPLICATE_PRODUCT/);
  const disabled=repo('unapproved');
  await assert.rejects(()=>disabled.readPage('sales'),/BUSINESS_FLAG_DISABLED/);
  await assert.rejects(()=>disabled.commitSale(input('no-flag')),/BUSINESS_FLAG_DISABLED/);
  console.log(JSON.stringify({status:'PASS',projectId,productionRequests:0,products:[500,2000],historicalSales:5000,historicalMovements:5000,historicalAudit:5000,
    scenarios:['real transaction retries','duplicate sale','same-product race','duplicate close','sale after close denied','two businesses isolation','business flag denied','bounded server pages','pagination cursor/limit validation','legacy unchanged'],reads,writes}));
} finally { await db.terminate(); await deleteApp(app); }
