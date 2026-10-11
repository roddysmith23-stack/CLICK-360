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
const instalments=structuredClone(source);
instalments.cashSessions[0].status='open';instalments.dailyReports=[];
Object.assign(instalments.sales[0],{method:'Apartado',total:12,received:12,status:'paid',balance:0,
  payments:[{id:'deposit',amount:2,method:'Transferencia'},
    {id:'pay-3',operationId:'pay-3',amount:3,method:'Transferencia',date:'2026-09-03'},
    {id:'pay-7',operationId:'pay-7',amount:7,method:'Transferencia',date:'2026-09-03'}]});
Object.assign(instalments.movements[1],{amount:2,paymentType:'receivable_payment'});
for(const amount of [3,7])instalments.movements.push({...instalments.movements[1],id:`pay-${amount}`,operationId:`pay-${amount}`,amount});
const instalmentsBefore=structuredClone(instalments);
const paidSummary=await api.deriveCashSummaries({snapshot:instalments,businessId});
assert.equal(paidSummary.canProceed,true,JSON.stringify(paidSummary.failures));
assert.equal(paidSummary.verified['exact-session'].summary.salesTotal,12);
assert.equal(paidSummary.verified['exact-session'].summary.paymentTotals.receivablePayments,12);
assert.deepEqual(instalments,instalmentsBefore);
for(const mutate of [s=>{s.movements[2].amount=4;},s=>{s.movements.splice(2,1);},
  s=>{s.sales[0].payments[2].operationId='pay-3';},s=>{s.sales[0].received=11;},
  s=>{s.sales[0].payments[0].method='Efectivo';},
  s=>{s.movements.push({...s.movements[2],id:'extra',operationId:'unmatched-payment'});}]){
  const bad=structuredClone(instalments);mutate(bad);
  assert.equal((await api.deriveCashSummaries({snapshot:bad,businessId})).canProceed,false);
}
const laterSession=structuredClone(instalments);
laterSession.cashSessions.push({...laterSession.cashSessions[0],id:'later-session',operationId:'later-opening',date:'2026-09-04'});
laterSession.movements.push({...laterSession.movements[0],id:'later-opening',operationId:'later-opening',cashSessionId:'later-session',date:'2026-09-04'});
Object.assign(laterSession.movements[3],{cashSessionId:'later-session',date:'2026-09-04'});
laterSession.sales[0].payments[2].date='2026-09-04';
const laterSummary=await api.deriveCashSummaries({snapshot:laterSession,businessId});
assert.equal(laterSummary.canProceed,true,JSON.stringify(laterSummary.failures));
assert.equal(laterSummary.verified['exact-session'].summary.paymentTotals.receivablePayments,5);
assert.equal(laterSummary.verified['later-session'].summary.paymentTotals.receivablePayments,7);
assert.equal(laterSummary.verified['later-session'].summary.saleCount,0);
console.log('PASS imported cash summary derivation: exact IDs, verified opening/payment/report, reused sale references counted once, no default zero, same-date isolation, ambiguous source stops. Pure source validation; no remote initialization/cutover.');
