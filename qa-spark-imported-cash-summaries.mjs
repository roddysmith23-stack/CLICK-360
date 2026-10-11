import assert from 'node:assert/strict';
import './spark-modular-migration.js';
const api=globalThis.CLICK360_SPARK_MIGRATION,businessId='synthetic-business';
const source={businesses:[{id:businessId}],cashSessions:[{id:'exact-session',operationId:'opening-op',businessId,
  date:'2026-09-03',status:'closed',openingAmount:0}],sales:[{id:'sale-30',operationId:'sale-op',businessId,cashSessionId:'exact-session',
  date:'2026-09-03',total:30,received:30,iva:0,method:'Transferencia',items:[{id:'p1',qty:1}]}],
  movements:[{id:'opening',operationId:'opening-op',businessId,cashSessionId:'exact-session',date:'2026-09-03',kind:'apertura',amount:0},
    {id:'payment',operationId:'sale-op',businessId,cashSessionId:'exact-session',date:'2026-09-03',saleId:'sale-30',
      kind:'ingreso',amount:30,paymentType:'sale',paymentMethod:'Transferencia'}],
  dailyReports:[{id:'previous-report',businessId,cashSessionId:'exact-session',date:'2026-09-03',status:'reopened',saleIds:['sale-30']},
    {id:'current-report',businessId,cashSessionId:'exact-session',date:'2026-09-03',status:'closed',saleIds:['sale-30'],total:30,saleCount:1,theoreticalCash:0}]};
const unchanged=structuredClone(source),result=await api.deriveCashSummaries({snapshot:source,businessId});
assert.equal(result.canProceed,true);assert.deepEqual(source,unchanged);
const summary=result.verified['exact-session'].summary;
assert.equal(summary.salesTotal,30);assert.equal(summary.saleCount,1);assert.equal(summary.paymentTotals.transfer,30);
assert.equal(summary.cashBalance,0);assert.equal(summary.closeCycle,2);assert.equal(summary.itemCount,1);
for(const mutate of [s=>{delete s.sales[0].cashSessionId;},s=>{delete s.cashSessions[0].openingAmount;},
  s=>{s.movements[1].amount=60;},s=>{s.dailyReports[1].total=60;},s=>{s.sales[0].cashSessionId='other-session';},
  s=>{s.movements[1].paymentMethod='Apartado';},s=>{s.sales[0].items[0].qty=0;}]){
  const altered=structuredClone(source);mutate(altered);
  const rejected=await api.deriveCashSummaries({snapshot:altered,businessId});
  assert.equal(rejected.canProceed,false);assert.equal(Object.keys(rejected.verified).length,0);
}
const multiple=structuredClone(source);multiple.cashSessions.push({...multiple.cashSessions[0],id:'same-date-other',operationId:'other-opening',status:'open'});
multiple.movements.push({...multiple.movements[0],id:'other-opening',operationId:'other-opening',cashSessionId:'same-date-other'});
const exact=await api.deriveCashSummaries({snapshot:multiple,businessId});
assert.equal(exact.canProceed,true);assert.equal(exact.verified['same-date-other'].summary.saleCount,0);
assert.equal(exact.verified['exact-session'].summary.saleCount,1);
const published=structuredClone(source);
const prior=published.dailyReports[1];
published.dailyReports[1]={id:prior.id,businessId,cashSessionId:prior.cashSessionId,date:prior.date,status:'closed',
  saleIds:['sale-30'],openingAmount:0,productQuantity:1,taxTotal:0,income:0,expenses:0,expectedCash:0,
  paymentTotals:{cash:0,card:0,transfer:30,layawayPayments:0}};
published.sales.push({...published.sales[0],id:'cancelled-sale',operationId:'cancelled-op',status:'cancelled'});
published.movements.push({...published.movements[1],id:'cancelled-payment',operationId:'cancelled-op',saleId:'cancelled-sale',status:'cancelled'});
const publishedBefore=structuredClone(published),publishedResult=await api.deriveCashSummaries({snapshot:published,businessId});
assert.equal(publishedResult.canProceed,true);assert.deepEqual(publishedResult.verified['exact-session'].summary,summary);
assert.deepEqual(published,publishedBefore);
for(const mutate of [s=>{delete s.dailyReports[1].expectedCash;},s=>{s.dailyReports[1].saleIds.push('sale-30');},
  s=>{s.dailyReports[1].paymentTotals.transfer=60;},s=>{delete s.dailyReports[1].productQuantity;}]){
  const bad=structuredClone(published);mutate(bad);assert.equal((await api.deriveCashSummaries({snapshot:bad,businessId})).canProceed,false);
}
const oldReceipt=structuredClone(published);delete oldReceipt.movements[1].operationId;delete oldReceipt.movements[1].paymentType;
assert.equal((await api.deriveCashSummaries({snapshot:oldReceipt,businessId})).canProceed,true);
const receiptFork=structuredClone(oldReceipt);receiptFork.movements.push({...receiptFork.movements[1],id:'duplicate-receipt'});
assert.equal((await api.deriveCashSummaries({snapshot:receiptFork,businessId})).canProceed,false);
console.log('PASS imported cash summary derivation: exact IDs, verified opening/payment/report, reused sale references counted once, no default zero, same-date isolation, ambiguous source stops. Pure source validation; no remote initialization/cutover.');
