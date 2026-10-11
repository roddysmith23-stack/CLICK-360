import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,getDocFromServer,runTransaction,serverTimestamp,collection,query,orderBy,documentId,limit,startAfter,getDocsFromServer} from 'firebase/firestore';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './spark-modular-transaction-transport.js';
import './modular-operation-journal.js';
import './modular-persistence.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular',ownerUid='operational-rules-owner',businessId='operational-business';
const secondBusinessId='operational-second-business';
let candidateRules=await readFile('firestore.spark.rules','utf8');
const sourceRulesSha256=createHash('sha256').update(candidateRules).digest('hex');
const headroomProbe=process.env.SPARK_RULES_HEADROOM_PROBE==='true';
if(headroomProbe){
  // QA-only stricter Rules. Every added predicate depends on request data;
  // this tests additional expression work without granting any new access.
  // Never write or deploy the instrumented source.
  const marker='&& d.recordVersion is int';
  assert.equal(candidateRules.split(marker).length,2);
  candidateRules=candidateRules.replace(marker,`${marker}\n        ${Array.from({length:16},(_,i)=>`&& d.recordVersion + ${i+1} >= ${i+2}`).join('\n        ')}`);
}
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules:candidateRules}});
const client=env.authenticatedContext(ownerUid).firestore(),other=env.authenticatedContext('other-owner').firestore();
const workerUid='operational-worker',worker=env.authenticatedContext(workerUid).firestore();
const base=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2`,control=`businesses/${ownerUid}/metadata/storage`;
const api=globalThis.CLICK360_MODULAR_PERSISTENCE,codec=globalThis.CLICK360_SPARK_RECORD_CODEC,identity=api.identity(ownerUid,businessId);
function transportFor(c,actorUid=ownerUid,omitProduct='',transformRecord=null){
  const db={app:{options:{projectId}},doc:path=>doc(c,path),collection:path=>{
    const constraints=[];
    const bounded={orderBy:field=>{assert.equal(field,'__name__');constraints.push(orderBy(documentId()));return bounded;},
      limit:n=>{constraints.push(limit(n));return bounded;},startAfter:id=>{constraints.push(startAfter(id));return bounded;},
      get:options=>{assert.deepEqual(options,{source:'server'});return getDocsFromServer(query(collection(c,path),...constraints));}};
    return bounded;
  },runTransaction:callback=>runTransaction(c,tx=>callback({
    get:async ref=>{try{const s=await tx.get(ref);return {exists:s.exists(),data:()=>s.data()};}
      catch(error){console.log(JSON.stringify({failedSyntheticRead:ref.path.slice(base.length+1),actor:actorUid===ownerUid?'owner':'worker'}));throw error;}},
    set:(ref,data)=>{if(ref.path!==`${base}/products/${omitProduct}`){
      const transformed=transformRecord?transformRecord(ref,data):data;
      if(transformed!==null)tx.set(ref,transformed);
    }}}))};
  return globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({db,projectId,ownerUid,businessId,actorUid,resolveUser:()=>({uid:actorUid})});
}
const repo=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,transport:transportFor(client),serverTimestamp});
const get=async(moduleName,id)=>{const s=await getDocFromServer(doc(client,`${base}/${moduleName}/${id}`));return codec.unpack(s.data(),{identity,moduleName,recordId:id});};
let priorCoverage=new Map();
async function budgetObservation(stage){
  if(process.env.SPARK_RULES_TRACE!=='true')return;
  const log=await readFile('firestore-debug.log','utf8');
  console.log(JSON.stringify({stage,evaluationLimitErrors:(log.match(/maximum of 1000 expressions/g)||[]).length}));
  if(['before_omission','omitted_p2'].includes(stage)){
    const response=await fetch(`http://127.0.0.1:48944/emulator/v1/projects/${projectId}:ruleCoverage`);
    if(!response.ok)throw Error('RULE_BUDGET_TRACE_UNAVAILABLE');
    const coverage=await response.json(),source=coverage.rules.files[0].content,counts=new Map();
    const visit=node=>{
      const p=node.sourcePosition;
      if(p){const key=`${p.line}:${p.column}`,count=(node.values||[]).reduce((n,value)=>n+value.count,0);
        const existing=counts.get(key);counts.set(key,{line:p.line,count:count+(existing?.count||0),expression:source.slice(p.currentOffset,p.endOffset+1).slice(0,90)});}
      for(const child of node.children||[])visit(child);
    };
    for(const node of coverage.report)visit(node);
    if(stage==='omitted_p2')console.log(JSON.stringify({ruleCostDelta:[...counts.entries()].map(([key,row])=>({...row,count:row.count-(priorCoverage.get(key)?.count||0)})).sort((a,b)=>b.count-a.count).slice(0,25)}));
    priorCoverage=counts;
  }
}
try{
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,`approvedUsers/${ownerUid}`),{uid:ownerUid,ownerId:ownerUid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(db,`businesses/${ownerUid}/featureFlags/workers`),{enabled:true});
    await setDoc(doc(db,`businesses/${ownerUid}/businessUnits/${businessId}/members/${workerUid}`),{
      uid:workerUid,ownerUid,businessId,tenantKey:`owner:${ownerUid}:business:${businessId}`,boundarySchemaVersion:1,
      status:'active',role:'cashier',permissions:{products:{read:true},sales:{read:true,create:true},cashSessions:{read:true}}});
    await setDoc(doc(db,control),{ownerUid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:'a'.repeat(64),reconstructedHash:'a'.repeat(64),businessIds:[businessId,secondBusinessId]});
    await setDoc(doc(db,`businesses/${ownerUid}/businessUnits/${secondBusinessId}/storage/v2/products/isolated`),
      await codec.pack({id:'isolated',...api.identity(ownerUid,secondBusinessId),module:'products',recordVersion:1,stock:9,qty:9},
        {identity:{ownerUid,businessId:secondBusinessId},moduleName:'products',recordId:'isolated'}));
    await setDoc(doc(db,`${base}/metadata/runtime`),await codec.pack({id:'runtime',...identity,module:'metadata',recordVersion:1,summaryVersion:1,openCashSessionId:''},{identity,moduleName:'metadata',recordId:'runtime'}));
  });
  const open={operationId:'open-1',cashSessionId:'session-03',date:'2026-09-03',openingAmount:0};
  const customerCreate={operationId:'customer-create',customerId:'synthetic-customer',changes:{name:'Synthetic',phone:'',notes:''}};
  await repo.commitOperation('customer_create',customerCreate);
  assert.equal((await repo.commitOperation('customer_create',customerCreate)).status,'already_committed');
  const customerEdit={operationId:'customer-edit',customerId:customerCreate.customerId,expectedRecordVersion:1,changes:{name:'Synthetic edited',phone:'000',notes:'Synthetic only'}};
  await repo.commitOperation('customer_edit',customerEdit);
  assert.equal((await get('customers',customerCreate.customerId)).recordVersion,2);
  const missingCustomer=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path.endsWith('/customers/omitted-customer')?null:data),serverTimestamp});
  await assertFails(missingCustomer.commitOperation('customer_create',{...customerCreate,operationId:'customer-omitted',customerId:'omitted-customer'}));
  assert.equal((await getDocFromServer(doc(client,`${base}/operationLedger/customer-omitted`))).exists(),false);
  const forgedCustomer=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path.endsWith('/customers/forged-customer')?{...data,data:{...data.data,stock:999}}:data),serverTimestamp});
  await assertFails(forgedCustomer.commitOperation('customer_create',{...customerCreate,operationId:'customer-forged',customerId:'forged-customer'}));
  assert.equal((await getDocFromServer(doc(client,`${base}/operationLedger/customer-forged`))).exists(),false);
  await budgetObservation('customer_create_edit_and_denials');
  await repo.commitOperation('cash_open',open);
  await budgetObservation('cash_open');
  console.log('PASS operational Rules: cash opening');
  await repo.commitOperation('product_create',{operationId:'create-1',date:open.date,product:{id:'p1',name:'Synthetic',businessId,stock:2,price:30}});
  for(const id of ['p2','p3','p4'])await repo.commitOperation('product_create',{operationId:`create-${id}`,date:open.date,product:{id,name:'Synthetic chain',businessId,stock:2,price:30}});
  const chainSale={sale:{businessId,cashSessionId:open.cashSessionId,date:open.date,total:90,received:90,method:'Transferencia',items:['p2','p3','p4'].map(id=>({id,qty:1}))}};
  await budgetObservation('before_omission');
  for(const omitted of ['p2','p3','p4']){
    const forgedRepo=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,transport:transportFor(client,ownerUid,omitted),serverTimestamp});
    const operationId=`omit-stock-${omitted}`;
    await assertFails(forgedRepo.commitSale({...chainSale,operationId}));
    assert.equal((await getDocFromServer(doc(client,`${base}/operationLedger/${operationId}`))).exists(),false);
    assert.equal((await getDocFromServer(doc(client,`${base}/sales/${operationId}`))).exists(),false);
    for(const id of ['p2','p3','p4'])assert.equal((await get('products',id)).stock,2);
    assert.equal((await get('cashSessions',open.cashSessionId)).saleCount,0);
    await budgetObservation(`omitted_${omitted}`);
  }
  await repo.commitSale({...chainSale,operationId:'valid-stock-chain'});
  for(const id of ['p2','p3','p4'])assert.equal((await get('products',id)).stock,1);
  await budgetObservation('stock_chain');
  console.log('PASS operational Rules: missing first/middle/last stock write rejected atomically; complete three-product sale accepted');
  await budgetObservation('product_create');
  const sale={operationId:'sale-1',sale:{id:'sale-1',businessId,cashSessionId:open.cashSessionId,date:open.date,total:30,received:30,method:'Transferencia',items:[{id:'p1',qty:1}]}};
  const priorSessionOperation=(await getDocFromServer(doc(client,`${base}/cashSessions/${open.cashSessionId}`))).data().lastOperationId;
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),`${base}/cashSessions/${open.cashSessionId}`),{lastOperationId:'missing-session-update'}));
  const missingSession=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path===`${base}/cashSessions/${open.cashSessionId}`?null:data),serverTimestamp});
  await assertFails(missingSession.commitSale({...sale,operationId:'missing-session-update'}));
  assert.equal((await get('products','p1')).stock,2);
  for(const moduleName of ['operationLedger','sales','movements'])assert.equal(
    (await getDocFromServer(doc(client,`${base}/${moduleName}/missing-session-update`))).exists(),false);
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),`${base}/cashSessions/${open.cashSessionId}`),{lastOperationId:priorSessionOperation}));
  const missingLedger=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path===`${base}/operationLedger/missing-new-ledger`?null:data),serverTimestamp});
  await assertFails(missingLedger.commitSale({...sale,operationId:'missing-new-ledger'}));
  assert.equal((await get('products','p1')).stock,2);
  for(const moduleName of ['operationLedger','sales','movements'])assert.equal(
    (await getDocFromServer(doc(client,`${base}/${moduleName}/missing-new-ledger`))).exists(),false);
  const forgedCash=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path===`${base}/cashSessions/${open.cashSessionId}`
      ?{...data,operational:{...data.operational,cashBalance:data.operational.cashBalance+1}}:data),serverTimestamp});
  await assertFails(forgedCash.commitSale({...sale,operationId:'forged-cash-balance'}));
  assert.equal((await get('products','p1')).stock,2);
  assert.equal((await get('cashSessions',open.cashSessionId)).cashBalance,0);
  await budgetObservation('forged_cash_balance');
  for(const attack of ['amount','date','session','method','type','ledger_session']){
    const operationId=`forged-payment-${attack}`;
    const attacker=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
      transport:transportFor(client,ownerUid,'',(ref,record)=>{
        if(ref.path===`${base}/movements/${operationId}`){
          const field={amount:'amount',date:'date',session:'cashSessionId',method:'paymentMethod',type:'paymentType'}[attack];
          if(field)return {...record,data:{...record.data,[field]:{amount:31,date:'2026-09-04',session:'different-session',method:'Efectivo',type:'receivable_payment'}[attack]}};
        }
        if(ref.path===`${base}/operationLedger/${operationId}`&&attack==='ledger_session')return {...record,
          data:{...record.data,result:{...record.data.result,cashSessionId:'different-session'}}};
        if(ref.path===`${base}/cashSessions/${open.cashSessionId}`){
          const operational=structuredClone(record.operational);
          if(attack==='amount')operational.paymentTotals.transfer++;
          if(attack==='method'){operational.paymentTotals.transfer-=30;operational.paymentTotals.cash+=30;operational.cashBalance+=30;}
          if(attack==='type')operational.paymentTotals.receivablePayments+=30;
          return {...record,operational};
        }
        return record;
      }),serverTimestamp});
    await assertFails(attacker.commitSale({...sale,operationId}));
    for(const moduleName of ['operationLedger','sales','movements'])assert.equal(
      (await getDocFromServer(doc(client,`${base}/${moduleName}/${operationId}`))).exists(),false);
    assert.equal((await get('products','p1')).stock,2);
  }
  console.log('PASS operational Rules: missing ledger and forged payment amount/date/session/method/type/ledger-session reject the whole commit');
  await repo.commitSale(sale);
  await budgetObservation('sale');
  console.log('PASS operational Rules: historical sale');
  assert.equal((await repo.commitSale(sale)).status,'already_committed');
  const prepared=await repo.prepareOperation('sale',sale);
  assert.equal((await repo.lookupOperation(sale.operationId,'sale',prepared.payloadSha256)).record.status,'committed');
  assert.equal((await get('products','p1')).stock,1);
  await assertFails(transportFor(client).run(async tx=>{
    const p=await tx.get('products','p1');
    tx.update('products','p1',{...p,recordVersion:p.recordVersion+1,stock:9,qty:9,
      updatedAt:serverTimestamp(),updatedBy:ownerUid,lastOperationId:'sale-1'});
  }));
  assert.equal((await get('products','p1')).stock,1);
  await assertFails(updateDoc(doc(client,`${base}/products/p1`),{'data.stock':9,'data.qty':9}));
  await budgetObservation('stock_negatives');
  console.log('PASS operational Rules: reject unpaired stock writes');
  await assertFails(setDoc(doc(other,`${base}/products/evil`),{ownerUid,businessId}));
  await assertFails(setDoc(doc(client,`${base}/operationLedger/forged`),{ownerUid,businessId}));
  await assertFails(updateDoc(doc(client,`${base}/operationLedger/sale-1`),{'data.payloadHash':'b'.repeat(64)}));
  await assertFails(getDocFromServer(doc(worker,control)));
  const workerRepo=api.createSparkRepository({ownerUid,businessId,actorUid:workerUid,transport:transportFor(worker,workerUid),serverTimestamp});
  await assertFails(workerRepo.commitOperation('customer_create',{...customerCreate,operationId:'worker-customer-denied',customerId:'worker-customer-denied'}));
  const workerSale={...sale,operationId:'worker-sale',sale:{...sale.sale,id:'worker-sale'}};
  assert.equal((await workerRepo.commitSale(workerSale)).auditPending,false);
  const workerPrepared=await workerRepo.prepareOperation('sale',workerSale);
  assert.equal((await workerRepo.lookupOperation('worker-sale','sale',workerPrepared.payloadSha256)).exists,true);
  assert.equal((await get('products','p1')).stock,0);
  await assertFails(workerRepo.commitOperation('product_create',{operationId:'worker-forbidden-product',date:open.date,
    product:{id:'worker-forbidden',businessId,name:'Denied',stock:0}}));
  await assertFails(getDocFromServer(doc(worker,`${base}/operationLedger/sale-1`)));
  await assertFails(getDocFromServer(doc(worker,`${base}/movements/sale-1`)));
  await assertFails(getDocFromServer(doc(worker,`businesses/${ownerUid}/businessUnits/${secondBusinessId}/storage/v2/products/isolated`)));
  await assertFails(getDocFromServer(doc(other,`${base}/products/p1`)));
  await repo.commitOperation('inventory_adjust',{operationId:'race-restock',productId:'p1',quantityDelta:1,date:open.date});
  const outcomes=await Promise.allSettled(['race-a','race-b'].map(operationId=>repo.commitSale({...sale,operationId})));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  const rejected=outcomes.find(x=>x.status==='rejected');
  console.log(JSON.stringify({raceRejection:{code:rejected.reason.code||null,message:rejected.reason.message}}));
  assert.match(rejected.reason.message,/INSUFFICIENT_STOCK/,'A permission/budget error is not successful concurrency certification');
  assert.equal((await get('products','p1')).stock,0);
  await budgetObservation('stock_race');
  console.log('PASS operational Rules: last-stock race');
  await repo.commitOperation('cash_movement',{operationId:'cash-income',cashSessionId:open.cashSessionId,date:open.date,movementKind:'ingreso',amount:1});
  await repo.commitOperation('cash_movement',{operationId:'cash-expense',cashSessionId:open.cashSessionId,date:open.date,movementKind:'egreso',amount:1});
  const forgedReport=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path.includes('/dailyReports/')
      ?{...data,data:{...data.data,paymentTotals:{...data.data.paymentTotals,cash:999}}}:data),serverTimestamp});
  await assertFails(forgedReport.closeCashSession({operationId:'forged-report',cashSessionId:open.cashSessionId,date:open.date,declaredCash:0}));
  assert.equal((await get('cashSessions',open.cashSessionId)).status,'open');
  assert.equal((await getDocFromServer(doc(client,`${base}/dailyReports/report-session-03-1`))).exists(),false);
  await budgetObservation('forged_report');
  await repo.closeCashSession({operationId:'close-1',cashSessionId:open.cashSessionId,date:open.date,declaredCash:0});
  assert.equal((await get('cashSessions',open.cashSessionId)).status,'closed');
  assert.equal((await get('dailyReports','report-session-03-1')).saleCount,4);
  await budgetObservation('cash_close');
  await repo.commitOperation('cash_reopen',{operationId:'reopen-1',cashSessionId:open.cashSessionId,date:open.date,reason:'Synthetic recovery'});
  await repo.closeCashSession({operationId:'close-2',cashSessionId:open.cashSessionId,date:open.date,declaredCash:0});
  assert.equal((await get('dailyReports','report-session-03-1')).status,'reopened');
  assert.equal((await get('dailyReports','report-session-03-2')).saleCount,4);
  await repo.commitOperation('inventory_adjust',{operationId:'adjust-1',productId:'p1',quantityDelta:1,date:open.date});
  await repo.commitOperation('product_edit',{operationId:'edit-1',productId:'p1',changes:{name:'Edited'}});
  assert.equal((await get('products','p1')).name,'Edited');
  assert.equal((await get('products','p1')).stock,1);
  assert.equal((await getDocFromServer(doc(client,`businesses/${ownerUid}/businessUnits/${secondBusinessId}/storage/v2/products/isolated`))).data().data.stock,9);
  await repo.commitOperation('product_create',{operationId:'compound-create',date:open.date,product:{id:'compound-product',businessId,name:'Before',stock:2,price:1}});
  const compound={operationId:'compound-edit',productId:'compound-product',quantityDelta:3,date:open.date,expectedRecordVersion:1,changes:{name:'After',price:12}};
  await repo.commitOperation('inventory_adjust',compound);
  assert.equal((await repo.commitOperation('inventory_adjust',compound)).status,'already_committed');
  assert.equal((await get('products','compound-product')).stock,5);
  assert.equal((await get('products','compound-product')).name,'After');
  assert.equal((await get('products','compound-product')).recordVersion,2);
  assert.equal((await get('movements','compound-edit')).quantityDelta,3);
  const omitMovement=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path.endsWith('/movements/compound-omit')?null:data),serverTimestamp});
  await assertFails(omitMovement.commitOperation('inventory_adjust',{...compound,operationId:'compound-omit',expectedRecordVersion:2}));
  assert.equal((await get('products','compound-product')).stock,5);
  assert.equal((await get('products','compound-product')).recordVersion,2);
  assert.equal((await getDocFromServer(doc(client,`${base}/operationLedger/compound-omit`))).exists(),false);
  const forgeProduct=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(client,ownerUid,'',(ref,data)=>ref.path.endsWith('/products/compound-product')?{...data,data:{...data.data,unapprovedField:true}}:data),serverTimestamp});
  await assertFails(forgeProduct.commitOperation('inventory_adjust',{...compound,operationId:'compound-forged',expectedRecordVersion:2}));
  assert.equal((await get('products','compound-product')).stock,5);
  assert.equal((await getDocFromServer(doc(client,`${base}/movements/compound-forged`))).exists(),false);
  await assertFails(workerRepo.commitOperation('inventory_adjust',{...compound,operationId:'compound-worker-denied',expectedRecordVersion:2,quantityDelta:-1,changes:{name:'Worker edit'}}));
  assert.equal((await get('products','compound-product')).stock,5);
  assert.equal((await getDocFromServer(doc(client,`businesses/${ownerUid}/businessUnits/${secondBusinessId}/storage/v2/products/isolated`))).data().data.stock,9);
  await budgetObservation('compound_product_and_stock');
  await repo.commitOperation('cash_open',{operationId:'open-multiline',cashSessionId:'multiline-session',date:'2026-10-06',openingAmount:0});
  for(const lines of [4,8,12]){
    const ids=Array.from({length:lines},(_,index)=>`multiline-${lines}-${index}`);
    for(const id of ids)await repo.commitOperation('product_create',{operationId:`create-${id}`,date:'2026-10-06',
      product:{id,businessId,name:'Synthetic budget fixture',stock:3,price:1}});
    const multiSale={businessId,cashSessionId:'multiline-session',date:'2026-10-06',total:lines,received:lines,
      method:'Transferencia',items:ids.map(id=>({id,qty:1,price:1}))};
    await repo.commitSale({operationId:`owner-multiline-${lines}`,sale:multiSale});
    const result=await workerRepo.commitSale({operationId:`worker-multiline-${lines}`,sale:multiSale});
    assert.equal(result.auditPending,false);
    for(const id of ids)assert.equal((await get('products',id)).stock,1);
    await budgetObservation(`worker_multiline_${lines}`);
  }
  assert.equal((await get('cashSessions','multiline-session')).saleCount,6);
  assert.equal((await get('cashSessions','multiline-session')).salesTotal,48);
  for(const lines of [1,4,8,12]){
    const manualLines=Array.from({length:lines},(_,index)=>({id:`manual-budget-${lines}-${index}`,qty:1,isCustom:true,price:1}));
    const manualBudgetSale={businessId,cashSessionId:'multiline-session',date:'2026-10-06',total:lines,received:lines,
      method:'Transferencia',items:manualLines};
    await repo.commitSale({operationId:`owner-manual-${lines}`,sale:manualBudgetSale});
    await budgetObservation(`owner_manual_${lines}`);
    await workerRepo.commitSale({operationId:`worker-manual-${lines}`,sale:manualBudgetSale});
    await budgetObservation(`worker_manual_${lines}`);
  }
  assert.equal((await get('cashSessions','multiline-session')).saleCount,14);
  assert.equal((await get('cashSessions','multiline-session')).salesTotal,98);
  // Exercise every boundary of the distributed manual-line proof. Keep the
  // aggregate quantity consistent so rejection proves the line invariant,
  // rather than accidentally relying on a mismatching session counter.
  const manualAttackSale={businessId,cashSessionId:'multiline-session',date:'2026-10-06',total:12,received:12,
    method:'Transferencia',items:Array.from({length:12},(_,index)=>({id:`attack-manual-${index}`,qty:1,isCustom:true,price:1}))};
  for(const index of Array.from({length:12},(_,index)=>index)){
    const operationId=`invalid-manual-quantity-${index}`;
    const attacker=api.createSparkRepository({ownerUid,businessId,actorUid:workerUid,
      transport:transportFor(worker,workerUid,'',(ref,record)=>{
        if(ref.path===`${base}/sales/${operationId}`){
          const items=record.data.items.map((item,i)=>i===index?{...item,qty:0}:item);
          return {...record,data:{...record.data,items,itemCount:11}};
        }
        if(ref.path===`${base}/cashSessions/multiline-session`)return {...record,
          operational:{...record.operational,itemCount:record.operational.itemCount-1}};
        return record;
      }),serverTimestamp});
    await assertFails(attacker.commitSale({operationId,sale:manualAttackSale}));
    for(const moduleName of ['operationLedger','sales','movements'])assert.equal(
      (await getDocFromServer(doc(client,`${base}/${moduleName}/${operationId}`))).exists(),false);
    assert.equal((await get('cashSessions','multiline-session')).saleCount,14);
    assert.equal((await get('cashSessions','multiline-session')).salesTotal,98);
    await budgetObservation(`invalid_manual_quantity_${index}`);
  }
  for(const mutation of ['custom_flag','index_alias','line_identity','item_count','tax_counter',
    'raw_operation_alias','cash_numeric_string','payment_numeric_string','fractional_cash_counter']){
    const operationId=`invalid-manual-${mutation}`;
    const attacker=api.createSparkRepository({ownerUid,businessId,actorUid:workerUid,
      transport:transportFor(worker,workerUid,'',(ref,record)=>{
        if(ref.path===`${base}/sales/${operationId}`){
          if(mutation==='raw_operation_alias')return {...record,lastOperationId:'unrelated-operation'};
          const data={...record.data};
          if(mutation==='custom_flag')data.items=data.items.map((item,i)=>i===11?{...item,isCustom:false}:item);
          if(mutation==='index_alias')data.customItemIndices={...data.customItemIndices,'attack-manual-11':0};
          if(mutation==='line_identity')data.items=data.items.map((item,i)=>i===11?{...item,id:'different-id'}:item);
          if(mutation==='item_count')data.itemCount++;
          return {...record,data};
        }
        if(ref.path===`${base}/cashSessions/multiline-session`&&['item_count','tax_counter'].includes(mutation))return {...record,
          operational:{...record.operational,[mutation==='item_count'?'itemCount':'taxTotal']:
            record.operational[mutation==='item_count'?'itemCount':'taxTotal']+1}};
        if(ref.path===`${base}/cashSessions/multiline-session`){
          if(mutation==='cash_numeric_string')return {...record,operational:{...record.operational,cashBalance:String(record.operational.cashBalance)}};
          if(mutation==='payment_numeric_string')return {...record,operational:{...record.operational,
            paymentTotals:{...record.operational.paymentTotals,cash:String(record.operational.paymentTotals.cash)}}};
          if(mutation==='fractional_cash_counter')return {...record,operational:{...record.operational,cashBalance:record.operational.cashBalance+0.0001}};
        }
        return record;
      }),serverTimestamp});
    await assertFails(attacker.commitSale({operationId,sale:manualAttackSale}));
    assert.equal((await getDocFromServer(doc(client,`${base}/operationLedger/${operationId}`))).exists(),false);
    assert.equal((await get('cashSessions','multiline-session')).saleCount,14);
    await budgetObservation(`invalid_manual_${mutation}`);
  }
  console.log('PASS operational Rules: all distributed manual-line boundaries, index/identity/provenance and authoritative counter attacks rejected atomically');
  const pendingSale={...manualAttackSale,total:30,received:0,method:'Pendiente',items:[manualAttackSale.items[0]]};
  await workerRepo.commitSale({operationId:'pending-payment-real-sdk',sale:pendingSale});
  assert.equal((await get('movements','pending-payment-real-sdk')).amount,0);
  assert.equal((await get('cashSessions','multiline-session')).paymentTotals.transfer,98);
  const layawaySale={...manualAttackSale,total:30,received:5,method:'Apartado',items:[manualAttackSale.items[0]]};
  const layawayCommand={operationId:'layaway-real-sdk',sale:layawaySale,paymentMethod:'Efectivo',
    layaway:{id:'reservation-real-sdk',businessId,total:30,paid:5,balance:25}};
  // Sale permission alone must not grant reservation access.
  await assertFails(workerRepo.commitSale(layawayCommand));
  assert.equal((await getDocFromServer(doc(client,`${base}/sales/${layawayCommand.operationId}`))).exists(),false);
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),`businesses/${ownerUid}/businessUnits/${businessId}/members/${workerUid}`),
    {'permissions.layaways':{read:true,create:true}}));
  await workerRepo.commitSale(layawayCommand);
  assert.equal((await workerRepo.commitSale(layawayCommand)).status,'already_committed');
  assert.equal((await get('layaways','reservation-real-sdk')).saleId,'layaway-real-sdk');
  assert.equal((await get('movements','layaway-real-sdk')).amount,5);
  assert.equal((await get('cashSessions','multiline-session')).cashBalance,5);
  assert.equal((await get('cashSessions','multiline-session')).paymentTotals.receivablePayments,5);
  for(const field of ['total','paid','balance','saleId']){
    const operationId=`forged-layaway-${field}`,layawayId=`reservation-forged-${field}`;
    const attacker=api.createSparkRepository({ownerUid,businessId,actorUid:workerUid,
      transport:transportFor(worker,workerUid,'',(ref,record)=>ref.path===`${base}/layaways/${layawayId}`
        ?{...record,data:{...record.data,[field]:field==='saleId'?'different-sale':record.data[field]+1}}:record),serverTimestamp});
    await assertFails(attacker.commitSale({...layawayCommand,operationId,layaway:{...layawayCommand.layaway,id:layawayId}}));
    for(const moduleName of ['operationLedger','sales','movements'])assert.equal(
      (await getDocFromServer(doc(client,`${base}/${moduleName}/${operationId}`))).exists(),false);
    assert.equal((await getDocFromServer(doc(client,`${base}/layaways/${layawayId}`))).exists(),false);
  }
  assert.equal((await get('cashSessions','multiline-session')).saleCount,16);
  assert.equal((await get('cashSessions','multiline-session')).cashBalance,5);
  await budgetObservation('pending_and_layaway');
  console.log('PASS operational Rules: pending zero-payment marker, authorized reservation deposit, exactly-once retry and forged reservation rollback');
  const secondDevice=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,
    transport:transportFor(env.authenticatedContext(ownerUid).firestore()),serverTimestamp});
  const page=await secondDevice.readPage('sales',{limit:2});
  assert.equal(page.source,'server');assert.equal(page.records.length,2);assert(page.nextCursor);
  const nextPage=await secondDevice.readPage('sales',{limit:2,afterId:page.nextCursor});
  assert.equal(nextPage.records.length,2);assert(nextPage.records.every(row=>!page.records.some(previous=>previous.id===row.id)));
  const sessions=await secondDevice.readPage('cashSessions',{limit:10});
  assert.equal(sessions.records.find(row=>row.id==='multiline-session').saleCount,16);
  assert.equal(sessions.records.find(row=>row.id==='multiline-session').cashBalance,5);
  assert.equal((await workerRepo.readPage('products',{limit:2})).records.length,2);
  console.log('PASS operational Rules: bounded server pages and independent second-device session totals');
  // Certify the full supported worker cart, not only a one-line deposit.
  // The same atomic commit keeps reservation, receipt, stock and cash intact.
  const stockLines=Array.from({length:12},(_,index)=>({id:`multiline-12-${index}`,qty:1,price:1}));
  const mixedLines=Array.from({length:12},(_,index)=>index<6
    ?{id:`multiline-8-${index}`,qty:1,price:1}
    :{id:`mixed-manual-${index}`,qty:1,price:1,isCustom:true});
  await workerRepo.commitSale({operationId:'worker-mixed-12',sale:{...manualAttackSale,items:mixedLines}});
  await workerRepo.commitSale({operationId:'worker-stock-layaway-12',paymentMethod:'Tarjeta',
    sale:{...manualAttackSale,items:stockLines,method:'Apartado',received:3},
    layaway:{id:'worker-stock-reservation-12',businessId,total:12,paid:3,balance:9}});
  await workerRepo.commitSale({operationId:'worker-manual-layaway-12',paymentMethod:'Efectivo',
    sale:{...manualAttackSale,method:'Apartado',received:3},
    layaway:{id:'worker-manual-reservation-12',businessId,total:12,paid:3,balance:9}});
  await workerRepo.commitSale({operationId:'worker-pending-12',sale:{...manualAttackSale,method:'Pendiente',received:0}});
  for(const line of stockLines)assert.equal((await get('products',line.id)).stock,0);
  for(const line of mixedLines.filter(line=>!line.isCustom))assert.equal((await get('products',line.id)).stock,0);
  assert.equal((await get('movements','worker-stock-layaway-12')).amount,3);
  assert.equal((await get('movements','worker-manual-layaway-12')).amount,3);
  assert.equal((await get('movements','worker-pending-12')).amount,0);
  assert.equal((await get('cashSessions','multiline-session')).saleCount,20);
  assert.equal((await get('cashSessions','multiline-session')).cashBalance,8);
  await budgetObservation('worker_worst_case_mixed_deposit_pending_12');
  const workerClose={operationId:'worker-close-multiline',cashSessionId:'multiline-session',date:'2026-10-06',declaredCash:8};
  await assertFails(workerRepo.closeCashSession(workerClose));
  assert.equal((await get('cashSessions','multiline-session')).status,'open');
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),`businesses/${ownerUid}/businessUnits/${businessId}/members/${workerUid}`),
    {'permissions.cashSessions':{read:true,create:true,close:true,update:true},'permissions.products':{read:true,create:true,update:true},
      'permissions.customers':{read:true,create:true,update:true}}));
  await workerRepo.commitOperation('customer_create',{...customerCreate,operationId:'worker-customer-create',customerId:'worker-customer'});
  await workerRepo.commitOperation('customer_edit',{...customerEdit,operationId:'worker-customer-edit',customerId:'worker-customer'});
  assert.equal((await get('customers','worker-customer')).recordVersion,2);
  await budgetObservation('authorized_worker_customer_create_edit');
  await workerRepo.closeCashSession(workerClose);
  assert.equal((await workerRepo.closeCashSession(workerClose)).status,'already_committed');
  assert.equal((await get('dailyReports','report-multiline-session-1')).saleCount,20);
  const workerOpen={operationId:'worker-open-historical',cashSessionId:'worker-exact-session',date:'2026-09-04',openingAmount:0};
  await workerRepo.commitOperation('cash_open',workerOpen);
  await workerRepo.commitOperation('product_create',{operationId:'worker-create',date:workerOpen.date,
    product:{id:'worker-product',businessId,name:'Worker synthetic product',stock:2,price:1}});
  await workerRepo.commitOperation('product_edit',{operationId:'worker-edit',productId:'worker-product',changes:{name:'Worker edited'}});
  await workerRepo.commitOperation('inventory_adjust',{operationId:'worker-adjust',productId:'worker-product',quantityDelta:1,date:workerOpen.date});
  await workerRepo.commitOperation('inventory_adjust',{...compound,operationId:'compound-worker',expectedRecordVersion:2,quantityDelta:-1,changes:{name:'Worker edit'}});
  assert.equal((await get('products','compound-product')).stock,4);
  assert.equal((await get('products','compound-product')).name,'Worker edit');
  assert.equal((await get('products','worker-product')).stock,3);
  await workerRepo.closeCashSession({operationId:'worker-close-historical',cashSessionId:workerOpen.cashSessionId,date:workerOpen.date,declaredCash:0});
  assert.equal((await get('cashSessions',workerOpen.cashSessionId)).status,'closed');
  await budgetObservation('worker_cash_inventory');
  console.log('PASS operational Rules: worker 12-line mixed/stock/manual reservation/pending transactions and permission-scoped cash/product/inventory');
  await assertFails(updateDoc(doc(client,`${base}/auditEvents/audit-sale-1`),{'data.payloadHash':'f'.repeat(64)}));
  const fakeAudit=await codec.pack({id:'audit-uncommitted',...identity,module:'auditEvents',storageSchemaVersion:2,
    recordVersion:1,operationId:'uncommitted',action:'sale',actorUid:ownerUid,payloadHash:'a'.repeat(64),lastOperationId:'uncommitted',
    createdBy:ownerUid,updatedBy:ownerUid,createdAt:serverTimestamp(),updatedAt:serverTimestamp()},
    {identity,moduleName:'auditEvents',recordId:'audit-uncommitted'});
  await assertFails(setDoc(doc(client,`${base}/auditEvents/audit-uncommitted`),fakeAudit));
  assert.equal((await getDocFromServer(doc(client,`${base}/auditEvents/audit-uncommitted`))).exists(),false);
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),`businesses/${ownerUid}/businessUnits/${businessId}/members/${workerUid}`),{status:'inactive'}));
  await assertFails(workerRepo.lookupOperation('worker-sale','sale',workerPrepared.payloadSha256));
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),`businesses/${ownerUid}/businessUnits/${businessId}/members/${workerUid}`),{status:'active'}));
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),`businesses/${ownerUid}/featureFlags/workers`),{enabled:false}));
  await assertFails(workerRepo.lookupOperation('worker-sale','sale',workerPrepared.payloadSha256));
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),`accountAccess/${ownerUid}`),{uid:ownerUid,businessId:ownerUid,status:'expired',plan:'pro'}));
  await assertFails(repo.commitOperation('product_edit',{operationId:'expired-owner-edit',productId:'p1',changes:{name:'Must not persist'}}));
  assert.equal((await get('products','p1')).name,'Edited');
  await budgetObservation('final');
  const proof={status:'PASS',clientRules:true,historicalSale:true,idempotency:true,stockRace:true,exactSession:true,reopen:true,
    workerSale:true,workerProductDenied:true,ownReceiptOnly:true,ownerMetadataPrivate:true,twoBusinessIsolation:true,
    membershipRevocation:true,featureFlagRevocation:true,expiredOwnerReadOnly:true,immutableLedger:true,
    pendingPayment:true,layawayDeposit:true,serverPagination:true,secondDevice:true,
    workerTwelveLineMixed:true,workerTwelveLineReservations:true,workerTwelveLinePending:true,
    workerCashOpenClose:true,workerProductCreateEditAdjust:true,compoundProductAndStock:true,
    compoundMovementRequired:true,compoundFieldsEnforced:true,compoundWorkerPermissionEnforced:true,allManualQuantityIndices:12,
    headroomProbeAdditionalPredicates:headroomProbe?16:0,productionWrites:0,
    sourceRulesSha256,testedRulesSha256:createHash('sha256').update(candidateRules).digest('hex'),
    source:process.env.GITHUB_ACTIONS==='true'?'github-actions':'working-tree',
    sourceCommitSha:process.env.CLICK360_QA_SOURCE_SHA||null,
    physicalDeviceAcceptance:false,publicOperationalUI:false,checkedAt:new Date().toISOString()};
  await mkdir('artifacts/spark-rules-proof',{recursive:true});
  await writeFile(`artifacts/spark-rules-proof/${headroomProbe?'headroom':'exact-source'}.json`,JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
  if(process.env.SPARK_RULES_COVERAGE==='true'){
    const response=await fetch(`http://127.0.0.1:48944/emulator/v1/projects/${projectId}:ruleCoverage`);
    if(!response.ok)throw Error('SPARK_RULE_COVERAGE_UNAVAILABLE');
    const coverage=await response.json();
    const source=coverage.rules.files[0].content,rows=[];
    const visit=node=>{
      const p=node.sourcePosition;
      if(p&&((p.line>=405&&p.line<=422)||(p.line>=1835&&p.line<=1852)))rows.push({line:p.line,column:p.column,
        expression:source.slice(p.currentOffset,p.endOffset+1).slice(0,120),
        values:(node.values||[]).map(v=>({count:v.count,bool:v.value?.boolValue,type:Object.keys(v.value||{})}))});
      for(const child of node.children||[])visit(child);
    };
    for(const row of coverage.report)visit(row);
    console.log(JSON.stringify({ruleGuardCoverage:rows.filter(r=>r.values.some(v=>v.type.includes('boolValue')))}));
  }
}finally{await env.cleanup();}
