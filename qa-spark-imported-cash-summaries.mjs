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
for(const module of ['sales','movements','dailyReports']){
  const altered=structuredClone(source),row=structuredClone(altered[module].at(-1));
  row.id='orphan-record';row.date='2026-08-01';delete row.cashSessionId;
  if(module==='movements'){row.operationId='unmatched-operation';row.kind='ingreso';}
  altered[module].push(row);
  assert.equal((await api.deriveCashSummaries({snapshot:altered,businessId})).canProceed,false,
    'Unattached financial rows cannot disappear from the operational proof just because their date differs');
}
{
  const legacy=structuredClone(source);
  legacy.movements.push({id:'zero-note',businessId,kind:'egreso',amount:0,cashSessionId:'',date:'2026-08-01'});
  assert.equal((await api.deriveCashSummaries({snapshot:legacy,businessId})).canProceed,false);
  const proof=await api.deriveCashSummaries({snapshot:legacy,businessId,historicalReadOnly:true});
  assert.equal(proof.canProceed,true);
  assert(proof.historyPlan.historyPolicies['movements/zero-note']);
  assert.deepEqual(proof.verified,result.verified,'A zero historical note cannot change any session counter');
  for(const delta of [{amount:1},{cashSessionId:'missing'},{saleId:'sale-30'},{operationId:'unknown-command'}]){
    const bad=structuredClone(legacy);Object.assign(bad.movements.at(-1),delta);
    assert.equal((await api.deriveCashSummaries({snapshot:bad,businessId,historicalReadOnly:true})).canProceed,false);
  }
}
{
  const unscoped=structuredClone(source);
  for(const module of ['cashSessions','sales','movements','dailyReports'])for(const row of unscoped[module])delete row.businessId;
  const proof=await api.deriveCashSummaries({snapshot:unscoped,businessId});
  assert.equal(proof.canProceed,true);
  assert.equal(Object.keys(proof.verified).length,1,'Financial proof must cover the same records as the planner, not ignore unscoped legacy history');
  unscoped.businesses.push({id:'another-business'});
  await assert.rejects(api.deriveCashSummaries({snapshot:unscoped,businessId}),/AMBIGUOUS_BUSINESS_STOP/);
  unscoped.settings={legacyDataBusinessId:businessId};
  assert.equal((await api.deriveCashSummaries({snapshot:unscoped,businessId})).canProceed,true);
  assert.equal(Object.keys((await api.deriveCashSummaries({snapshot:unscoped,businessId:'another-business'})).verified).length,0);
}
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
// A preservation proof is NOT a financial summary or permission to cut over.
// These shapes are historical compatibility cases, not customer fixtures.
const historicalCases=[
  s=>{s.sales[0].payments=[{id:'legacy-payment',amount:30,method:{0:{},1:{},2:{}}}];
    s.movements[1].paymentMethod={0:{},1:{},2:{}};},
  s=>{s.sales=[];s.movements=s.movements.slice(0,1);s.dailyReports=[];
    s.cashSessions[0].reconciliationReason='closed-empty-orphan';},
  s=>{s.dailyReports=s.dailyReports.slice(0,1);},
  s=>{s.movements[1].operationId='different-operation';s.movements[1].amount=0;},
  s=>{s.sales=[];s.movements=s.movements.slice(0,1);
    s.dailyReports[1].saleIds=['sale-in-another-exact-session'];}
];
for(const change of historicalCases){
  const original=structuredClone(source);original.cashSessions[0].closedAt='2026-09-04T01:00:00Z';change(original);
  const before=structuredClone(original),proof=await api.deriveCashSummaries({snapshot:original,businessId});
  assert.equal(proof.canProceed,false,'Unproven history must not bypass migration gates');
  assert.equal(proof.historicalPreservationReady,true);
  assert.equal(proof.requiresHistoricalReadOnlyFence,true);
  assert.equal(Object.keys(proof.verified).length,0);
  const history=proof.unverifiedHistory['exact-session'];
  assert.equal(history.financiallyVerified,false);assert.equal(history.operational,false);assert.equal(history.reopenAllowed,false);
  assert.equal(Object.hasOwn(history,'summary'),false,'Do not manufacture zero counters');
  const optIn=await api.deriveCashSummaries({snapshot:original,businessId,historicalReadOnly:true});
  assert.equal(optIn.canProceed,!original.dailyReports.some(row=>row.saleIds?.includes('sale-in-another-exact-session')));
  assert.deepEqual(optIn.verified,proof.verified,'An explicit immutable-history contract must not fabricate counters');
  assert.deepEqual(optIn.unverifiedHistory,proof.unverifiedHistory);
  assert.equal(history.sessionHash,await api.hash(original.cashSessions[0]));
  assert.match(history.sourceHash,/^[a-f0-9]{64}$/);
  assert.deepEqual(original,before,'Original payment corruption, report references and history are immutable');
  const same=await api.deriveCashSummaries({snapshot:structuredClone(original),businessId});
  assert.deepEqual(same.unverifiedHistory,proof.unverifiedHistory);
  const changed=structuredClone(original);changed.movements[0].notes='different source';
  const different=await api.deriveCashSummaries({snapshot:changed,businessId});
  assert.notEqual(different.unverifiedHistory['exact-session'].sourceHash,history.sourceHash);
  const open=structuredClone(original);open.cashSessions[0].status='open';open.movements[0].amount=1;
  const denied=await api.deriveCashSummaries({snapshot:open,businessId});
  assert.equal(denied.canProceed,false);assert.equal(denied.historicalPreservationReady,false);
  assert.deepEqual(denied.unverifiedHistory,{},'An open financial conflict can never be archived away');
  assert.equal((await api.deriveCashSummaries({snapshot:open,businessId,historicalReadOnly:true})).canProceed,false);
  const missingClosure=structuredClone(original);delete missingClosure.cashSessions[0].closedAt;
  assert.equal((await api.deriveCashSummaries({snapshot:missingClosure,businessId})).historicalPreservationReady,false);
}
console.log('PASS imported cash summary derivation: exact IDs, verified opening/payment/report, reused sale references counted once, no default zero, same-date isolation, ambiguous source stops. Pure source validation; no remote initialization/cutover.');
console.log('PASS historical preservation classification: source-bound immutable evidence, no inferred payment method/counters, no operational authorization, no open-session bypass.');
{
  const original=structuredClone(source);original.cashSessions[0].closedAt='2026-09-04T01:00:00Z';
  original.sales=[];original.dailyReports=[];original.movements=original.movements.slice(0,1);
  delete original.movements[0].cashSessionId;
  const history=await api.historicalReadOnlyPlan({snapshot:original,businessId,sourceHash:await api.hash(original)});
  assert.equal(history.canProceed,true);
  assert(history.historyPolicies['movements/opening'],'Exact legacy opening must be fenced even without cashSessionId');
}
