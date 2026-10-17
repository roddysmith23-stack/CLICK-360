import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './spark-modular-transaction-transport.js';
import './modular-operation-journal.js';
import './modular-persistence.js';
import './modular-operation-coordinator.js';
const api=globalThis.CLICK360_MODULAR_PERSISTENCE,codec=globalThis.CLICK360_SPARK_RECORD_CODEC;
const ownerUid='operation-owner',businessId='business-alpha',projectId='demo-click360-spark-modular',identity=api.identity(ownerUid,businessId);
const base=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2`,rows=new Map();let reads=0,lastReads=0,queue=Promise.resolve();
let writeFaults=[];const transactions=[],transactionMetrics=[];
rows.set(`businesses/${ownerUid}/metadata/storage`,{ownerUid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:'a'.repeat(64),reconstructedHash:'a'.repeat(64),businessIds:[businessId]});
rows.set(`${base}/metadata/runtime`,await codec.pack({id:'runtime',...identity,module:'metadata',recordVersion:1,summaryVersion:1,openCashSessionId:''},{identity,moduleName:'metadata',recordId:'runtime'}));
const db={app:{options:{projectId}},doc:path=>({path}),runTransaction:callback=>{
  const run=async()=>{const staged=[],start=reads;let writing=false;
    const result=await callback({get:async ref=>{assert(!writing);reads++;return {exists:rows.has(ref.path),data:()=>rows.get(ref.path)};},set:(ref,value)=>{writing=true;staged.push([ref.path,value]);}});
    const fault=staged.length?writeFaults.shift():null;
    transactions.push(staged.length?'write':'read');
    if(!fault||fault.afterCommit)for(const [key,value]of staged)rows.set(key,value);
    lastReads=reads-start;
    transactionMetrics.push({reads:lastReads,core:staged.some(([path])=>path.startsWith(`${base}/operationLedger/`)),
      modules:[...new Set(staged.map(([path])=>path.slice(base.length+1).split('/')[0]))]});
    if(fault){fault.onFailure?.();const error=Error('SYNTHETIC_PERMISSION_RESPONSE');error.code='permission-denied';throw error;}
    return result;};
  const result=queue.then(run,run);queue=result.catch(()=>{});return result;
}};
const transport=globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({db,projectId,ownerUid,businessId,resolveUser:()=>({uid:ownerUid})});
const repo=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,transport,serverTimestamp:()=> 'server-timestamp'});
const runtimeFixture=rows.get(`${base}/metadata/runtime`);
assert.equal((await repo.readCurrentCashSession()).session,null,'Verified empty runtime is not an invented historical session');
rows.delete(`${base}/metadata/runtime`);
await assert.rejects(()=>repo.readCurrentCashSession(),/CASH_RUNTIME_NOT_VERIFIED/);
rows.set(`${base}/metadata/runtime`,runtimeFixture);
// A restart on a shared terminal must not adopt another issuer's pending
// request, including pre-issuer DEV rows. Same business is not same actor.
const replayInput={operationId:'issuer-bound-command',customerId:'issuer-customer',changes:{name:'Synthetic',phone:'',notes:''}};
const ownerRequest=await repo.prepareOperation('customer_create',replayInput);
const nextActorRepo=api.createSparkRepository({ownerUid,businessId,actorUid:'next-worker',transport,serverTimestamp:()=> 'server-timestamp'});
const nextRequest=await nextActorRepo.prepareOperation('customer_create',replayInput);
assert.equal(ownerRequest.envelope.actorUid,ownerUid);
assert.notEqual(ownerRequest.payloadSha256,nextRequest.payloadSha256,'Issuer is part of the immutable hash');
for(const state of ['queued','inflight','unknown']){
  for(const actor of [ownerUid,undefined]){
    const payload=structuredClone(ownerRequest.envelope);
    if(actor===undefined)delete payload.actorUid;
    const row={state,operationId:replayInput.operationId,payload,payloadHash:ownerRequest.payloadSha256};
    let touched=0;
    const journal={get:async()=>structuredClone(row),claim:async()=>{touched++;throw Error('WRONG_ACTOR_CLAIM');}};
    const guardedRepo={...nextActorRepo,lookupOperation:async()=>{touched++;throw Error('WRONG_ACTOR_LOOKUP');},commitOperation:async()=>{touched++;throw Error('WRONG_ACTOR_SEND');}};
    const coordinator=globalThis.CLICK360_MODULAR_COORDINATOR.create({journal,repository:guardedRepo,deviceId:'shared-device'});
    await assert.rejects(()=>coordinator.process(row.operationId),/OUTBOX_ACTOR_RECONCILIATION_REQUIRED/);
    assert.equal(touched,0,'Actor change cannot claim, resend or alter the original command');
    assert.equal(row.state,state,'Recovery retains the original state for authoritative reconciliation');
  }
}
const get=async(moduleName,id)=>codec.unpack(rows.get(`${base}/${moduleName}/${id}`),{identity,moduleName,recordId:id});
await repo.commitOperation('product_create',{operationId:'catalog-create',date:'2026-09-03',product:{id:'catalog-product',businessId,name:'Retained history',stock:8}});
const deleteProduct={operationId:'catalog-delete',productId:'catalog-product',expectedRecordVersion:1};
await assert.rejects(()=>repo.commitOperation('product_delete',{...deleteProduct,expectedRecordVersion:2}),/REVISION_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('product_delete',{...deleteProduct,stock:0}),/FIELDS_INVALID/);
await repo.commitOperation('product_delete',deleteProduct);
assert.equal((await repo.commitOperation('product_delete',deleteProduct)).status,'already_committed');
assert.equal((await get('products','catalog-product')).deleted,true);
assert.equal((await get('products','catalog-product')).stock,8);
assert.equal((await get('products','catalog-product')).name,'Retained history');
assert(!rows.has(`${base}/movements/catalog-delete`),'Logical deletion is not a financial or stock movement');
await assert.rejects(()=>repo.commitOperation('product_edit',{operationId:'catalog-resurrect',productId:'catalog-product',changes:{name:'Forbidden'}}),/PRODUCT_DELETED/);
await assert.rejects(()=>repo.commitOperation('inventory_adjust',{operationId:'catalog-adjust',productId:'catalog-product',date:'2026-09-03',quantityDelta:-1}),/PRODUCT_DELETED/);
const customerCreate={operationId:'customer-create',customerId:'synthetic-customer',changes:{name:'Synthetic',phone:'',notes:''}};
await repo.commitOperation('customer_create',customerCreate);
assert.equal((await repo.commitOperation('customer_create',customerCreate)).status,'already_committed');
const customerEdit={operationId:'customer-edit',customerId:customerCreate.customerId,expectedRecordVersion:1,changes:{name:'Synthetic edited',phone:'000',notes:'Synthetic only'}};
await repo.commitOperation('customer_edit',customerEdit);
assert.equal((await repo.readOperationProjection('customer-edit','customer_edit',(await repo.prepareOperation('customer_edit',customerEdit)).payloadSha256)).records.customers[0].recordVersion,2);
await assert.rejects(()=>repo.commitOperation('customer_edit',{...customerEdit,operationId:'stale-customer'}),/REVISION_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('customer_create',{...customerCreate,operationId:'invalid-customer',customerId:'invalid',changes:{...customerCreate.changes,stock:50}}),/FIELDS_INVALID/);
await assert.rejects(()=>repo.commitOperation('customer_create',{...customerCreate,changes:{...customerCreate.changes,name:'Different'}}),/IDEMPOTENCY_KEY_CONFLICT/);
assert.equal(rows.has(`${base}/operationLedger/invalid-customer`),false);
const customerDelete={operationId:'customer-delete',customerId:customerCreate.customerId,expectedRecordVersion:2};
await assert.rejects(()=>repo.commitOperation('customer_delete',{...customerDelete,operationId:'stale-delete',expectedRecordVersion:1}),/REVISION_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('customer_delete',{...customerDelete,operationId:'extra-delete',changes:{name:'discard'}}),/DELETE_FIELDS_INVALID/);
writeFaults=[{afterCommit:true}];
const deleteMetricStart=transactionMetrics.length;
assert.equal((await repo.commitOperation('customer_delete',customerDelete)).status,'already_committed');
assert(transactionMetrics.slice(deleteMetricStart).every(tx=>tx.modules.every(moduleName=>['customers','operationLedger','auditEvents'].includes(moduleName))));
assert.equal((await repo.commitOperation('customer_delete',customerDelete)).status,'already_committed');
const preservedCustomer=await get('customers',customerCreate.customerId);
assert.equal(preservedCustomer.deleted,true);assert.equal(preservedCustomer.recordVersion,3);
assert.equal(preservedCustomer.name,customerEdit.changes.name);assert.equal(preservedCustomer.notes,customerEdit.changes.notes);
await assert.rejects(()=>repo.commitOperation('customer_edit',{...customerEdit,operationId:'resurrect-customer',expectedRecordVersion:3}),/CUSTOMER_DELETED/);
await assert.rejects(()=>repo.commitOperation('customer_delete',{...customerDelete,expectedRecordVersion:3}),/IDEMPOTENCY_KEY_CONFLICT/);
assert.equal((await repo.lookupOperation(customerDelete.operationId,'customer_delete',(await repo.prepareOperation('customer_delete',customerDelete)).payloadSha256)).exists,true);
const open={operationId:'open-1',cashSessionId:'session-sep03',date:'2026-09-03',openingAmount:0};
await repo.commitOperation('cash_open',open);assert.equal((await get('cashSessions',open.cashSessionId)).status,'open');
await assert.rejects(()=>repo.commitOperation('cash_open',{...open,operationId:'open-second',cashSessionId:'other-session'}),/ALREADY_HAS_OPEN/);
await repo.commitOperation('product_create',{operationId:'create-1',date:open.date,product:{id:'p1',businessId,name:'Perfume',stock:2,price:30}});
assert.equal((await get('movements','create-1')).quantityDelta,2);
const sale={operationId:'sale-1',sale:{id:'legacy-sale-1',cashSessionId:open.cashSessionId,date:open.date,businessId,total:30,received:30,iva:0,method:'Transferencia',items:[{id:'p1',qty:1,name:'Perfume'}]}};
await assert.rejects(()=>repo.commitSale({...sale,operationId:'duplicate-lines',sale:{...sale.sale,items:[sale.sale.items[0],sale.sale.items[0]]}}),/DUPLICATE_LINE_ID/);
await assert.rejects(()=>repo.commitSale({...sale,operationId:'over-line-budget',sale:{...sale.sale,
  items:Array.from({length:13},(_,i)=>({id:`manual-${i}`,qty:1,isCustom:true}))}}),/LINE_BUDGET_EXCEEDED/);
await assert.rejects(()=>repo.commitSale({...sale,operationId:'conflicting-line-id',sale:{...sale.sale,
  items:[{id:'p1',productId:'p2',qty:1}]}}),/LINE_ID_CONFLICT/);
assert.equal(rows.has(`${base}/operationLedger/over-line-budget`),false);
assert.equal((await get('products','p1')).stock,2);
await repo.commitSale(sale);const saleReads=transactionMetrics.findLast(metric=>metric.core).reads;
assert(transactionMetrics.at(-1).modules.includes('auditEvents'));
assert.equal((await get('products','p1')).stock,1);assert.equal((await get('cashSessions',open.cashSessionId)).paymentTotals.transfer,30);
// An apparently open historical session must not authorize a sale when the
// authoritative runtime points elsewhere. Failed validation stages no writes.
const runtimePath=`${base}/metadata/runtime`,verifiedRuntime=rows.get(runtimePath);
const conflictingRuntime=await get('metadata','runtime');
rows.set(runtimePath,await codec.pack({...conflictingRuntime,recordVersion:conflictingRuntime.recordVersion+1,openCashSessionId:'different-session'},
  {identity,moduleName:'metadata',recordId:'runtime',previous:verifiedRuntime}));
await assert.rejects(()=>repo.commitSale({...sale,operationId:'stale-open-sale'}),/RUNTIME_SESSION_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('cash_movement',{operationId:'stale-open-movement',cashSessionId:open.cashSessionId,
  date:open.date,movementKind:'ingreso',amount:1}),/RUNTIME_SESSION_CONFLICT/);
assert.equal((await get('products','p1')).stock,1);
assert.equal(rows.has(`${base}/sales/stale-open-sale`),false);
assert.equal(rows.has(`${base}/operationLedger/stale-open-sale`),false);
assert.equal(rows.has(`${base}/movements/stale-open-movement`),false);
rows.set(runtimePath,verifiedRuntime);
const first=await repo.prepareOperation('sale',sale);assert.equal((await repo.lookupOperation('sale-1','sale',first.payloadSha256)).exists,true);
const projection=await repo.readOperationProjection('sale-1','sale',first.payloadSha256);
assert.equal(projection.source,'server');assert.equal(projection.identity.tenantKey,identity.tenantKey);
assert.equal(projection.records.products[0].stock,1);assert.equal(projection.records.sales[0].legacyId,'legacy-sale-1');
assert.equal(projection.records.movements[0].saleId,'sale-1');
assert.equal(projection.records.cashSessions[0].paymentTotals.transfer,30);
await assert.rejects(()=>repo.readOperationProjection('sale-1','sale','b'.repeat(64)),/PROJECTION_LEDGER_CONFLICT/);
assert.equal((await repo.commitSale(sale)).status,'already_committed');assert.equal((await get('products','p1')).stock,1);
await assert.rejects(()=>repo.commitSale({...sale,sale:{...sale.sale,total:31,received:31}}),/IDEMPOTENCY_KEY_CONFLICT/);
const race=await Promise.allSettled([repo.commitSale({...sale,operationId:'sale-race-a'}),repo.commitSale({...sale,operationId:'sale-race-b'})]);
assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal((await get('products','p1')).stock,0);
const manual={operationId:'manual-1',sale:{cashSessionId:open.cashSessionId,date:open.date,businessId,total:8,received:8,iva:0,method:'Efectivo',items:[{id:'manual-item',isCustom:true,qty:1}]}};
await repo.commitSale(manual);assert.equal((await get('cashSessions',open.cashSessionId)).cashBalance,8);
const pending={...manual,operationId:'pending-1',sale:{...manual.sale,total:10,received:0,method:'Pendiente'}};
await repo.commitSale(pending);assert.equal((await get('movements','pending-1')).amount,0);
const layaway={...manual,operationId:'layaway-1',paymentMethod:'Tarjeta',sale:{...manual.sale,total:20,received:5,method:'Apartado'}};
await assert.rejects(()=>repo.commitSale(layaway),/layawayId/);
layaway.layaway={id:'layaway-record',businessId,total:20,paid:5,balance:15};
await repo.commitSale(layaway);assert.equal((await get('movements','layaway-1')).amount,5);
assert.equal((await get('layaways','layaway-record')).saleId,'layaway-1');
assert.equal((await get('layaways','layaway-record')).balance,15);
assert.equal((await get('cashSessions',open.cashSessionId)).paymentTotals.receivablePayments,5);
await repo.commitOperation('cash_movement',{operationId:'expense-1',cashSessionId:open.cashSessionId,date:open.date,movementKind:'egreso',amount:3});
const close={operationId:'close-1',cashSessionId:open.cashSessionId,date:open.date,declaredCash:5};
await repo.closeCashSession(close);const report=await get('dailyReports',`report-${open.cashSessionId}-1`);
assert.equal(report.theoreticalCash,5);assert.equal(report.total,98);assert.equal(report.saleCount,5);assert(!Object.hasOwn(report,'html'));
assert.equal((await repo.closeCashSession(close)).status,'already_committed');
await assert.rejects(()=>repo.commitSale({...manual,operationId:'closed-sale'}),/SESSION_NOT_OPEN/);
await repo.commitOperation('cash_reopen',{operationId:'reopen-1',cashSessionId:open.cashSessionId,date:open.date,reason:'Authorized correction'});
await repo.closeCashSession({...close,operationId:'close-2'});assert.equal((await get('dailyReports',`report-${open.cashSessionId}-1`)).status,'reopened');
assert.equal((await get('dailyReports',`report-${open.cashSessionId}-2`)).saleCount,5);assert.equal((await get('products','p1')).stock,0);
const oldSession=await get('cashSessions',open.cashSessionId),predecessor=await get('dailyReports',oldSession.reportId);
const successor={operationId:'successor-open',cashSessionId:'successor-session',date:open.date,openingAmount:5,
  previousReportId:predecessor.id,expectedReportVersion:predecessor.recordVersion,reason:'Continue exact day'};
await assert.rejects(()=>repo.commitOperation('cash_open',{...successor,openingAmount:6}),/SUCCESSOR_REPORT_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('cash_open',{...successor,expectedReportVersion:99}),/SUCCESSOR_REPORT_CONFLICT/);
await repo.commitOperation('cash_open',successor);assert.equal((await repo.commitOperation('cash_open',successor)).status,'already_committed');
assert.deepEqual(await get('cashSessions',open.cashSessionId),oldSession,'Preceding closed session is immutable');
assert.equal((await get('dailyReports',predecessor.id)).status,'reopened');
assert.equal((await get('dailyReports',predecessor.id)).total,predecessor.total);
assert.equal((await get('cashSessions',successor.cashSessionId)).saleCount,0);
assert.equal((await get('movements',successor.operationId)).amount,5);
const successorPrepared=await repo.prepareOperation('cash_open',successor);
const successorProjection=await repo.readOperationProjection(successor.operationId,'cash_open',successorPrepared.payloadSha256);
assert.equal(successorProjection.records.dailyReports[0].id,predecessor.id);
await repo.closeCashSession({operationId:'successor-close',cashSessionId:successor.cashSessionId,date:open.date,declaredCash:5});
assert.equal((await get('dailyReports','report-successor-session-1')).saleCount,0);
assert.equal((await get('products','p1')).stock,0);
await repo.commitOperation('inventory_adjust',{operationId:'adjust-1',productId:'p1',quantityDelta:1,date:open.date,reason:'Opening stock correction'});
assert.equal((await get('products','p1')).stock,1);
for(let i=0;i<15000;i++)rows.set(`${base}/sales/history-${i}`,{unused:true});
await repo.commitOperation('cash_open',{...open,operationId:'open-current',cashSessionId:'current-session',date:'2026-10-06'});
await repo.commitSale({...sale,operationId:'current-sale',sale:{...sale.sale,date:'2026-10-06',cashSessionId:'current-session'}});
assert.equal(transactionMetrics.findLast(metric=>metric.core).reads,saleReads);
assert.equal((await get('products','p1')).stock,0);
await assert.rejects(()=>repo.commitOperation('product_edit',{operationId:'bad-edit',productId:'p1',changes:{stock:999}}),/EDIT_FIELDS_INVALID/);
await repo.commitOperation('product_create',{operationId:'compound-create',date:open.date,product:{id:'compound-product',businessId,name:'Before',stock:2,price:1}});
const compound={operationId:'compound-edit',productId:'compound-product',quantityDelta:3,date:open.date,expectedRecordVersion:1,changes:{name:'After',price:12}};
await repo.commitOperation('inventory_adjust',compound);
assert.equal((await repo.commitOperation('inventory_adjust',compound)).status,'already_committed');
assert.equal((await get('products','compound-product')).stock,5);
assert.equal((await get('products','compound-product')).name,'After');
assert.equal((await get('products','compound-product')).recordVersion,2);
assert.equal((await get('movements','compound-edit')).quantityDelta,3);
await assert.rejects(()=>repo.commitOperation('inventory_adjust',{...compound,changes:{name:'Another payload'}}),/IDEMPOTENCY_KEY_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('inventory_adjust',{...compound,operationId:'compound-stale'}),/REVISION_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('inventory_adjust',{...compound,operationId:'compound-invalid',expectedRecordVersion:2,changes:{stock:999}}),/EDIT_FIELDS_INVALID/);
assert.equal(rows.has(`${base}/operationLedger/compound-invalid`),false);
const recoverable={operationId:'recoverable-create',date:open.date,product:{id:'recoverable-product',businessId,name:'Pinned request',stock:0}};
writeFaults=[{afterCommit:false,onFailure:()=>{recoverable.product.name='Caller changed during response';}}];
const retryStart=transactions.length;
await repo.commitOperation('product_create',recoverable);
assert.deepEqual(transactions.slice(retryStart),['write','read','write','write']);
assert.equal((await get('products','recoverable-product')).name,'Pinned request');
writeFaults=[{afterCommit:true}];
const lostStart=transactions.length;
assert.equal((await repo.commitOperation('product_create',{operationId:'lost-response-create',date:open.date,
  product:{id:'lost-response-product',businessId,name:'Response lost',stock:0}})).status,'already_committed');
assert.deepEqual(transactions.slice(lostStart),['write','read','write']);
writeFaults=[{afterCommit:false},{afterCommit:false}];
const deniedStart=transactions.length;
await assert.rejects(()=>repo.commitOperation('product_create',{operationId:'persistent-denial',date:open.date,
  product:{id:'denied-product',businessId,name:'Denied',stock:0}}),e=>e.code==='permission-denied');
assert.deepEqual(transactions.slice(deniedStart),['write','read','write']);
assert.equal(rows.has(`${base}/products/denied-product`),false);
assert.equal(rows.has(`${base}/operationLedger/persistent-denial`),false);
writeFaults=[null,{afterCommit:false}];
const auditInput={operationId:'audit-recovery',date:open.date,product:{id:'audit-product',businessId,name:'Confirmed independently of derived audit',stock:0}};
const auditResult=await repo.commitOperation('product_create',auditInput);
assert.equal(auditResult.status,'committed');assert.equal(auditResult.auditPending,true);
const auditPrepared=await repo.prepareOperation('product_create',auditInput);
assert.equal((await repo.lookupOperation('audit-recovery','product_create',auditPrepared.payloadSha256)).exists,true);
assert.equal(rows.has(`${base}/auditEvents/audit-audit-recovery`),false);
assert.equal((await repo.ensureDerivedAudit('audit-recovery','product_create',auditPrepared.payloadSha256)).status,'materialized');
assert.equal((await repo.ensureDerivedAudit('audit-recovery','product_create',auditPrepared.payloadSha256)).status,'already_materialized');
assert.equal((await get('products','audit-product')).stock,0);
await assert.rejects(()=>repo.ensureDerivedAudit('audit-recovery','product_create','b'.repeat(64)),/CONFIRMED_LEDGER_REQUIRED/);
const paymentSale={operationId:'receivable-sale',sale:{...manual.sale,date:'2026-10-06',cashSessionId:'current-session',total:10,received:0,method:'Pendiente'}};
await repo.commitSale(paymentSale);
const stockBeforePayment=(await get('products','p1')).stock,summaryBeforePayment=await get('cashSessions','current-session');
const paymentOne={operationId:'receipt-one',saleId:'receivable-sale',expectedRecordVersion:1,cashSessionId:'current-session',date:'2026-10-06',amount:2,method:'Transferencia'};
await repo.commitOperation('receivable_payment',paymentOne);
assert(!transactionMetrics.findLast(metric=>metric.core).modules.includes('products'),'Receipt never writes stock');
assert.equal((await repo.commitOperation('receivable_payment',paymentOne)).status,'already_committed');
assert.equal((await get('sales','receivable-sale')).balance,8);
await assert.rejects(()=>repo.commitOperation('receivable_payment',{...paymentOne,amount:1}),/IDEMPOTENCY_KEY_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('receivable_payment',{...paymentOne,operationId:'stale-receipt'}),/REVISION_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('receivable_payment',{...paymentOne,operationId:'overpayment',expectedRecordVersion:2,amount:9}),/AMOUNT_CONFLICT/);
writeFaults=[{afterCommit:true}];
const paymentTwo={...paymentOne,operationId:'receipt-two',expectedRecordVersion:2,amount:8,method:'Efectivo'};
assert.equal((await repo.commitOperation('receivable_payment',paymentTwo)).status,'already_committed');
const paidSale=await get('sales','receivable-sale'),paidSession=await get('cashSessions','current-session');
assert.equal(paidSale.status,'paid');assert.equal(paidSale.payments.length,2);assert.equal(paidSale.received,10);
assert.equal(paidSession.saleCount,summaryBeforePayment.saleCount);assert.equal(paidSession.salesTotal,summaryBeforePayment.salesTotal);
assert.equal(paidSession.cashBalance,summaryBeforePayment.cashBalance+8);assert.equal((await get('products','p1')).stock,stockBeforePayment);
const preparedReceipt=await repo.prepareOperation('receivable_payment',paymentOne);
assert.equal((await repo.lookupOperation('receipt-one','receivable_payment',preparedReceipt.payloadSha256)).exists,true,'Earlier confirmed receipt remains confirmable after a later payment');
const receiptView=await repo.readOperationProjection('receipt-two','receivable_payment',(await repo.prepareOperation('receivable_payment',paymentTwo)).payloadSha256);
assert(!receiptView.records.products,'Receipt projection does not scan original sale stock');
{
  const deferred=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,transport,
    deferDerivedAudit:true,serverTimestamp:()=> 'SERVER_TIMESTAMP'});
  const input={operationId:'deferred-customer',customerId:'deferred-customer',changes:{name:'Recoverable audit',phone:'',notes:''}};
  const prepared=await deferred.prepareOperation('customer_create',input);
  const committed=await deferred.commitOperation('customer_create',input);
  assert.equal(committed.auditPending,true);
  assert(!rows.has(`${base}/auditEvents/audit-deferred-customer`));
  assert(rows.has(`${base}/operationLedger/deferred-customer`));
  const before=transactionMetrics.length;
  const projected=await deferred.readOperationProjection(input.operationId,'customer_create',prepared.payloadSha256,{ensureAudit:true});
  assert.equal(transactionMetrics.length-before,1,'Audit materialization and authoritative projection share ONE transaction');
  assert.equal(projected.records.customers[0].name,'Recoverable audit');
  assert(rows.has(`${base}/auditEvents/audit-deferred-customer`));
  await deferred.readOperationProjection(input.operationId,'customer_create',prepared.payloadSha256,{ensureAudit:true});
  assert.equal((await get('customers','deferred-customer')).recordVersion,1,'Audit/projection retry cannot repeat a commercial mutation');
}
// Independent linked reads remain in ONE server transaction, but need not
// serialize one network round trip per receipt/session. Deterministic barrier,
// not an increased browser timeout or latency-based sleep.
for(const method of ['lookupOperation','readOperationProjection']){
  let started=0,release;
  const barrier=new Promise(resolve=>release=resolve),hash='d'.repeat(64);
  const proofRepo=api.createSparkRepository({ownerUid,businessId,actorUid:ownerUid,serverTimestamp:()=>0,
    transport:{run:callback=>callback({get:async(module,id)=>{
      if(module==='operationLedger')return {kind:'sale',status:'committed',payloadHash:hash,
        result:{saleId:'sale-proof',movementId:'sale-proof',cashSessionId:'session-proof'}};
      if(module!=='products'){started++;await barrier;}
      return {id,operationId:'sale-proof',stockOrder:[]};
    }})}});
  const flight=proofRepo[method]('sale-proof','sale',hash);
  for(let turn=0;turn<20&&started<3;turn++)await Promise.resolve();
  const concurrent=started;release();await flight;
  assert.equal(concurrent,3,`${method} must start all exact linked reads before waiting for the first response`);
}
// Delivery status is not a payment, stock movement, new sale or cash event.
const pendingReservation=await get('layaways','layaway-record');
const pendingSale=await get('sales','layaway-1');
const deliveryBase={operationId:'reservation-ready',saleId:'layaway-1',layawayId:'layaway-record',
  expectedSaleVersion:pendingSale.recordVersion,expectedLayawayVersion:pendingReservation.recordVersion,
  nextStatus:'ready_for_pickup',changedAt:'2026-10-16T12:00:00.000Z'};
await assert.rejects(()=>repo.commitOperation('layaway_status',deliveryBase),/TRANSITION_INVALID/);
await repo.commitOperation('receivable_payment',{operationId:'reservation-final-payment',saleId:'layaway-1',
  expectedRecordVersion:pendingSale.recordVersion,layawayId:'layaway-record',cashSessionId:'current-session',
  date:'2026-10-06',amount:15,method:'Transferencia'});
const fullReservation=await get('layaways','layaway-record'),fullSale=await get('sales','layaway-1');
const financialBefore=new Map([...rows].filter(([path])=>/\/(sales|products|movements|cashSessions|dailyReports)\//.test(path)).map(([path,value])=>[path,structuredClone(value)]));
const readyCommand={...deliveryBase,expectedSaleVersion:fullSale.recordVersion,expectedLayawayVersion:fullReservation.recordVersion};
writeFaults=[{afterCommit:true}];
assert.equal((await repo.commitOperation('layaway_status',readyCommand)).status,'already_committed');
assert.equal((await repo.commitOperation('layaway_status',readyCommand)).status,'already_committed');
assert.equal((await get('layaways','layaway-record')).status,'ready_for_pickup');
await assert.rejects(()=>repo.commitOperation('layaway_status',{...readyCommand,nextStatus:'picked_up'}),/IDEMPOTENCY_KEY_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('layaway_status',{...readyCommand,operationId:'stale-delivery'}),/REVISION_CONFLICT/);
await assert.rejects(()=>repo.commitOperation('layaway_status',{...readyCommand,operationId:'financial-tamper',amount:1}),/FIELDS_INVALID/);
const delivery={...readyCommand,operationId:'reservation-delivered',nextStatus:'picked_up',expectedLayawayVersion:fullReservation.recordVersion+1};
await repo.commitOperation('layaway_status',delivery);
const delivered=await get('layaways','layaway-record');assert.equal(delivered.status,'picked_up');assert.equal(delivered.pickedUpAt,delivery.changedAt);
await assert.rejects(()=>repo.commitOperation('layaway_status',{...delivery,operationId:'second-delivery',expectedLayawayVersion:delivered.recordVersion}),/TRANSITION_INVALID/);
for(const [path,value]of financialBefore)assert.deepEqual(rows.get(path),value,'Delivery must not change existing financial or stock records');
const readyPrepared=await repo.prepareOperation('layaway_status',readyCommand);
assert.equal((await repo.lookupOperation(readyCommand.operationId,'layaway_status',readyPrepared.payloadSha256)).exists,true);
const deliveryProjection=await repo.readOperationProjection(readyCommand.operationId,'layaway_status',readyPrepared.payloadSha256);
assert.deepEqual(Object.keys(deliveryProjection.records).filter(module=>module!=='auditEvents').sort(),['layaways','sales']);
console.log(JSON.stringify({status:'PASS',transport:'synthetic_atomic',historicalDate:true,manualSale:true,partialPayment:true,zeroPayment:true,subsequentReceipts:true,
  layawayDeliveryStatus:true,deliveryNoFinancialWrite:true,deliveryLostResponseIdempotent:true,
  actorBoundReplay:true,productLogicalDelete:true,productDeleteStockPreserved:true,
  idempotent:true,sameProductRace:true,exactCashSession:true,reopenSeparateReport:true,historyIndependentCoreReads:saleReads,
  derivedAuditRecoverable:true,auditFailureDoesNotRepeatCore:true,productionWrites:0}));
