import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDocFromServer,runTransaction,serverTimestamp,writeBatch} from 'firebase/firestore';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './spark-modular-transaction-transport.js';
import './modular-operation-journal.js';
import './modular-persistence.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular',ownerUid='cancellation-owner',businessId='cancellation-business',workerUid='cancellation-worker';
const api=globalThis.CLICK360_MODULAR_PERSISTENCE,codec=globalThis.CLICK360_SPARK_RECORD_CODEC,identity=api.identity(ownerUid,businessId);
let rules=await readFile('firestore.spark.rules','utf8');const sourceRulesSha256=createHash('sha256').update(rules).digest('hex');
const headroom=process.env.SPARK_RULES_HEADROOM_PROBE==='true';
if(headroom){const marker='&& d.recordVersion is int';assert.equal(rules.split(marker).length,2);
  rules=rules.replace(marker,`${marker}\n        ${Array.from({length:16},(_,i)=>`&& d.recordVersion + ${i+1} >= ${i+2}`).join('\n        ')}`);}
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules}});
const client=env.authenticatedContext(ownerUid).firestore(),worker=env.authenticatedContext(workerUid).firestore();
const base=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2`;
const raw=async(module,id)=>{const snapshot=await getDocFromServer(doc(client,`${base}/${module}/${id}`));assert.equal(snapshot.metadata.fromCache,false);return snapshot.exists()?snapshot.data():null;};
const get=async(module,id)=>codec.unpack(await raw(module,id),{identity,moduleName:module,recordId:id});
let lastWrites=[];
function repository({omit='',transform=null,extra=null,readTransform=null}={}){
  const db={app:{options:{projectId}},doc:path=>doc(client,path),runTransaction:callback=>runTransaction(client,tx=>{
    const staged=[];
    return callback({get:async ref=>{const snapshot=await tx.get(ref),data=readTransform?await readTransform(ref,snapshot.data()):snapshot.data();return {exists:snapshot.exists(),data:()=>data};},
      set:(ref,data)=>{if(ref.path.endsWith(omit)&&omit)return;const value=transform?transform(ref,data):data;
        staged.push({path:ref.path,data:value});tx.set(ref,value);
        if(extra&&ref.path.includes('/operationLedger/'))tx.set(doc(client,extra.path),extra.data);
      }}).then(result=>{if(staged.length)lastWrites=staged;return result;});
  })};
  const transport=globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({db,projectId,ownerUid,businessId,actorUid:ownerUid,resolveUser:()=>({uid:ownerUid})});
  return api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,transport,serverTimestamp});
}
const repo=repository();
try{
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,`approvedUsers/${ownerUid}`),{uid:ownerUid,ownerId:ownerUid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(db,`businesses/${ownerUid}/featureFlags/workers`),{enabled:true});
    await setDoc(doc(db,`businesses/${ownerUid}/businessUnits/${businessId}/members/${workerUid}`),{
      uid:workerUid,ownerUid,businessId,tenantKey:identity.tenantKey,boundarySchemaVersion:1,status:'active',role:'supervisor',
      permissions:{sales:{read:true,create:true,delete:true},products:{read:true,update:true},cashSessions:{read:true,close:true},layaways:{read:true,payment:true}}});
    await setDoc(doc(db,`businesses/${ownerUid}/metadata/storage`),{ownerUid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:'a'.repeat(64),reconstructedHash:'a'.repeat(64),businessIds:[businessId]});
    await setDoc(doc(db,`${base}/metadata/runtime`),await codec.pack({id:'runtime',...identity,module:'metadata',recordVersion:1,summaryVersion:1,openCashSessionId:''},{identity,moduleName:'metadata',recordId:'runtime'}));
  });
  await repo.commitOperation('cash_open',{operationId:'opening',cashSessionId:'session',date:'2026-09-03',openingAmount:0});
  for(let i=0;i<12;i++)await repo.commitOperation('product_create',{operationId:`create-${i}`,date:'2026-09-03',product:{id:`p${i}`,businessId,name:'Synthetic',stock:5,qty:5,price:5}});
  const before=await get('cashSessions','session');
  const saleInput={operationId:'sale',sale:{id:'legacy-sale',businessId,cashSessionId:'session',date:'2026-09-03',total:60,received:20,iva:0,
    method:'Apartado',items:Array.from({length:12},(_,i)=>({id:`p${i}`,qty:1}))},
    paymentMethod:'Transferencia',layaway:{id:'reservation',businessId,total:60,paid:20,balance:40,status:'active'}};
  const forgedInitial=repository({transform:(ref,data)=>ref.path.endsWith('/sales/forged-summary-sale')?{...data,data:{...data.data,receiptSummary:{...data.data.receiptSummary,cash:999}}}:data});
  await assertFails(forgedInitial.commitOperation('sale',{...saleInput,operationId:'forged-summary-sale',layaway:{...saleInput.layaway,id:'forged-reservation'}}));
  await repo.commitOperation('sale',saleInput);
  await assertFails(repository({transform:(ref,data)=>ref.path.endsWith('/sales/sale')?{...data,data:{...data.data,
    receiptSummary:{...data.data.receiptSummary,cash:data.data.receiptSummary.cash+1}}}:data}).commitOperation('receivable_payment',{
      operationId:'forged-receipt-summary',saleId:'sale',layawayId:'reservation',expectedRecordVersion:1,
      cashSessionId:'session',date:'2026-09-03',amount:1,method:'Efectivo'}));
  for(const [i,amount,method]of [[0,5,'Efectivo'],[1,10,'Tarjeta'],[2,25,'Transferencia']]){
    const sale=await get('sales','sale');
    await repo.commitOperation('receivable_payment',{operationId:`receipt-${i}`,saleId:'sale',layawayId:'reservation',expectedRecordVersion:sale.recordVersion,
      cashSessionId:'session',date:'2026-09-03',amount,method});
  }
  const sale=await get('sales','sale'),saleRaw=await raw('sales','sale');
  assert.deepEqual(sale.receiptSummary,{version:1,cashSessionId:'session',uniformSession:true,cash:5,card:10,transfer:45,receivablePayments:60});
  const command={operationId:'cancel-sale',saleId:'sale',expectedRecordVersion:sale.recordVersion,cashSessionId:'session',reason:'Synthetic correction'};
  await assert.rejects(repo.commitOperation('sale_cancel',{...command,operationId:'stale-cancellation-intention',
    expectedRecordVersion:command.expectedRecordVersion-1}),/REVISION_CONFLICT/);
  assert.equal(await raw('operationLedger','stale-cancellation-intention'),null);
  const originals=new Map(await Promise.all(['sale','receipt-0','receipt-1','receipt-2'].map(async id=>[id,await raw('movements',id)])));
  for(const [label,options]of [
    ['omitted-stock',{omit:'/products/p11'}],
    ['extra-stock',{transform:(ref,data)=>ref.path.endsWith('/products/p0')?{...data,data:{...data.data,stock:data.data.stock+1,qty:data.data.qty+1}}:data}],
    ['sale-payment-tamper',{transform:(ref,data)=>ref.path.endsWith('/sales/sale')?{...data,data:{...data.data,payments:[]}}:data}],
    ['summary-tamper',{transform:(ref,data)=>ref.path.endsWith('/sales/sale')?{...data,data:{...data.data,receiptSummary:{...data.data.receiptSummary,cash:999}}}:data}],
    ['cash-tamper',{transform:(ref,data)=>ref.path.endsWith('/cashSessions/session')?{...data,operational:{...data.operational,salesTotal:999}}:data}],
    ['foreign-business',{transform:(ref,data)=>ref.path.endsWith('/sales/sale')?{...data,businessId:'foreign'}:data}],
    ['reversal-tamper',{transform:(ref,data)=>ref.path.endsWith('/movements/cancel-reversal-tamper-rev')?{...data,data:{...data.data,amount:1}}:data}]
  ]){
    const op=`cancel-${label}`;await assertFails(repository(options).commitOperation('sale_cancel',{...command,operationId:op}));
    assert.equal(await raw('operationLedger',op),null);assert.deepEqual(await raw('sales','sale'),saleRaw);
  }
  // Re-sign a complete, captured atomic cancellation as a worker. The client
  // repository owner guard cannot stand in for this actual server denial.
  const batch=writeBatch(worker);
  for(const row of lastWrites)batch.set(doc(worker,row.path),{...row.data,updatedBy:workerUid,
    ...(row.path.includes('/operationLedger/')||row.path.includes('/movements/cancel-')?{createdBy:workerUid}:{})});
  await assertFails(batch.commit());
  const changedOriginal={...originals.get('receipt-0'),recordVersion:2,lastOperationId:'cancel-original-tamper',updatedAt:serverTimestamp(),updatedBy:ownerUid,
    data:{...originals.get('receipt-0').data,amount:0}};
  changedOriginal.dataHash=await globalThis.CLICK360_SPARK_MIGRATION.hash(changedOriginal.data);
  await assertFails(repository({extra:{path:`${base}/movements/receipt-0`,data:changedOriginal}}).commitOperation('sale_cancel',{...command,operationId:'cancel-original-tamper'}));
  assert.deepEqual(await raw('movements','receipt-0'),originals.get('receipt-0'));
  await repo.commitOperation('sale_cancel',command);
  assert.equal((await repo.commitOperation('sale_cancel',command)).status,'already_committed');
  await assert.rejects(repo.commitOperation('sale_cancel',{...command,reason:'Conflicting reason'}),/IDEMPOTENCY_KEY_CONFLICT/);
  const after=await get('cashSessions','session'),cancelled=await get('sales','sale');
  for(const key of ['saleCount','salesTotal','itemCount','taxTotal','cashBalance','paymentTotals'])assert.deepEqual(after[key],before[key]);
  assert.equal(cancelled.status,'cancelled');assert.deepEqual(cancelled.payments,sale.payments);
  for(const [id,data]of originals)assert.deepEqual(await raw('movements',id),data);
  for(let i=0;i<12;i++)assert.equal((await get('products',`p${i}`)).stock,5);
  assert.equal((await get('movements','cancel-sale-rev')).amount,60);
  assert.equal((await get('layaways','reservation')).status,'cancelled');
  // Ordinary cents must not depend on binary floating-point map equality.
  await repo.commitOperation('sale',{operationId:'decimal-sale',sale:{businessId,cashSessionId:'session',date:'2026-09-03',
    total:0.3,received:0.1,iva:0,method:'Apartado',items:[{id:'p0',qty:1}]},paymentMethod:'Efectivo',
    layaway:{id:'decimal-reservation',businessId,total:0.3,paid:0.1,balance:0.2,status:'active'}});
  await repo.commitOperation('receivable_payment',{operationId:'decimal-receipt',saleId:'decimal-sale',expectedRecordVersion:1,
    cashSessionId:'session',date:'2026-09-03',amount:0.2,method:'Efectivo',layawayId:'decimal-reservation'});
  const decimal=await get('sales','decimal-sale');assert.equal(decimal.receiptSummary.cash,0.3);
  await repo.commitOperation('sale_cancel',{...command,operationId:'cancel-decimal',saleId:decimal.id,expectedRecordVersion:decimal.recordVersion});
  assert.deepEqual((await get('cashSessions','session')).paymentTotals,before.paymentTotals);
  assert.equal((await get('products','p0')).stock,5);
  await repo.commitOperation('sale',{operationId:'closed-source-sale',sale:{businessId,cashSessionId:'session',date:'2026-09-03',
    total:5,received:5,iva:0,method:'Transferencia',items:[{id:'p0',qty:1}]}});
  await repo.commitOperation('sale',{operationId:'cross-session-sale',sale:{businessId,cashSessionId:'session',date:'2026-09-03',
    total:5,received:0,iva:0,method:'Pendiente',items:[{id:'p1',qty:1}]}});
  await repo.commitOperation('cash_close',{operationId:'closed-source-close',cashSessionId:'session',date:'2026-09-03',declaredCash:0});
  await repo.commitOperation('cash_open',{operationId:'next-opening',cashSessionId:'next-session',date:'2026-09-04',openingAmount:0});
  await repo.commitOperation('receivable_payment',{operationId:'cross-session-receipt',saleId:'cross-session-sale',expectedRecordVersion:1,
    cashSessionId:'next-session',date:'2026-09-04',amount:2,method:'Transferencia'});
  const cross=await get('sales','cross-session-sale');assert.equal(cross.receiptSummary.uniformSession,false);
  await assert.rejects(repo.commitOperation('sale_cancel',{...command,operationId:'cross-session-cancel',saleId:cross.id,expectedRecordVersion:cross.recordVersion}),/RECEIPTS_PROOF_REQUIRED/);
  await assert.rejects(repo.commitOperation('sale_cancel',{...command,operationId:'closed-source-cancel',saleId:'closed-source-sale',expectedRecordVersion:1}),/SESSION_PROTECTED/);
  // A malicious browser can lie to its JS kernel about downloaded documents;
  // the Rules must still evaluate the actual closed/cross-session resources.
  const lieAboutClosed=async(ref,data)=>{
    if(!data?.data)return data;
    const next={...data,data:structuredClone(data.data)};
    if(ref.path.endsWith('/cashSessions/session')){
      next.data.status='open';
      next.operational={...data.operational,paymentTotals:{...data.operational.paymentTotals,
        receivablePayments:data.operational.paymentTotals.receivablePayments+2}};
      next.operationalHash=await globalThis.CLICK360_SPARK_MIGRATION.hash(next.operational);
    }
    if(ref.path.endsWith('/metadata/runtime'))next.data.openCashSessionId='session';
    if(ref.path.endsWith('/sales/cross-session-sale'))next.data.receiptSummary.uniformSession=true;
    next.dataHash=await globalThis.CLICK360_SPARK_MIGRATION.hash(next.data);return next;
  };
  await assertFails(repository({readTransform:lieAboutClosed}).commitOperation('sale_cancel',{
    ...command,operationId:'forged-closed-source',saleId:'closed-source-sale',expectedRecordVersion:1}));
  await assertFails(repository({readTransform:lieAboutClosed}).commitOperation('sale_cancel',{
    ...command,operationId:'forged-cross-session',saleId:cross.id,expectedRecordVersion:cross.recordVersion}));
  assert.equal((await get('sales','closed-source-sale')).status,'paid');
  assert.equal((await get('sales',cross.id)).receiptSummary.uniformSession,false);
  assert.equal((await get('cashSessions','session')).status,'closed');
  console.log(JSON.stringify({status:'PASS',scope:'sale_cancellation_real_client_rules',twelveStockLines:true,
    mixedReceipts:true,initialSummaryProtected:true,compensationAtomic:true,originalReceiptsUnchanged:true,
    omittedStockDenied:true,stockInflationDenied:true,workerDenied:true,foreignIdentityDenied:true,receiptTamperDenied:true,
    closedSessionDenied:true,crossSessionReceiptDenied:true,forgedClientReadDenied:true,
    headroomProbeAdditionalPredicates:headroom?16:0,sourceRulesSha256,testedRulesSha256:createHash('sha256').update(rules).digest('hex'),productionWrites:0}));
}finally{await env.cleanup();}
