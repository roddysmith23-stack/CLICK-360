import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './spark-modular-handoff.js';
const api=globalThis.CLICK360_SPARK_MIGRATION,handoff=globalThis.CLICK360_SPARK_HANDOFF;
const ownerUid='synthetic-handoff-owner',businessIds=['business-a','business-b'];
function source(){return {identity:{ownerUid,ownerId:ownerUid},businesses:businessIds.map(id=>({id})),
  cashSessions:[],sales:[],movements:[],dailyReports:[]};}
function open(snapshot,businessId,id){
  snapshot.cashSessions.push({id,operationId:`opening-${id}`,businessId,date:'2026-09-03',status:'open',openingAmount:0});
  snapshot.movements.push({id:`opening-${id}`,operationId:`opening-${id}`,businessId,cashSessionId:id,
    date:'2026-09-03',kind:'apertura',amount:0});
}
async function input(snapshot,{historicalReadOnly=false}={}){
  const journalCapture={ownerUid,enumerationComplete:true,recordCount:0,rows:[]};
  return {ownerUid,snapshot,sourceHash:await api.hash(snapshot),deviceMetadataHash:await api.hash({deviceRevision:'device-42',baseRevision:41}),
    journalCapture,journalHash:await api.hash(journalCapture),businessIds:[...businessIds],unknownCount:0,conflictCount:0,historicalReadOnly,
    financialProofs:await Promise.all(businessIds.map(async businessId=>({businessId,
      ...await api.deriveCashSummaries({snapshot,businessId,historicalReadOnly})})))};
}
{
  const snapshot=source();open(snapshot,businessIds[0],'historical-exact');
  const before=structuredClone(snapshot),args=await input(snapshot),result=await handoff.plan(args);
  assert.deepEqual(snapshot,before);assert.equal(result.runtimes.length,2);
  assert.equal(result.runtimes[0].content.data.openCashSessionId,'historical-exact');
  assert.equal(result.runtimes[1].content.data.openCashSessionId,'');
  assert.equal(result.runtimes[0].openSessionSummaryHash,args.financialProofs[0].verified['historical-exact'].summaryHash);
  for(const row of result.runtimes){
    assert(!Object.hasOwn(row.content,'sourcePath'),'Derived runtime must not alter semantic source reconstruction');
    const flat=await CLICK360_SPARK_RECORD_CODEC.unpack(row.content,{identity:{ownerUid,businessId:row.content.businessId},moduleName:'metadata',recordId:'runtime'});
    assert.equal(flat.summaryVersion,1);assert.equal(flat.recordVersion,1);
  }
  for(const flag of ['journalReplayAllowed','operationalActivationAllowed','cutoverAllowed'])assert.equal(result[flag],false);
  assert.deepEqual(await handoff.plan(args),result,'Pure deterministic plan, no timestamps or random IDs');
  const {planHash,...material}=result;assert.equal(planHash,await api.hash(material));
  for(const delta of [{businessIds:[businessIds[0]]},{businessIds:[businessIds[0],businessIds[0]]},
    {financialProofs:[args.financialProofs[0]]},{unknownCount:1},{conflictCount:1},{sourceHash:'f'.repeat(64)},
    {journalHash:'f'.repeat(64)},{journalCapture:{...args.journalCapture,enumerationComplete:false}}])
    await assert.rejects(handoff.plan({...args,...delta}),/SPARK_HANDOFF_/);
  const tampered=structuredClone(args);tampered.financialProofs[0].verified['historical-exact'].summary.saleCount=99;
  await assert.rejects(handoff.plan(tampered),/FINANCIAL_PROOF_MISMATCH/);
  for(const count of [1,101,1000]){
    const pending=structuredClone(args);pending.journalCapture.rows=Array.from({length:count},(_,i)=>({operationId:`sale-${i}`,state:'pending'}));
    pending.journalCapture.recordCount=count;pending.journalHash=await api.hash(pending.journalCapture);
    await assert.rejects(handoff.plan(pending),/COMMAND_COVERAGE_REQUIRED/,'Never replay commands already projected into the imported snapshot');
  }
}
{
  const snapshot=source();open(snapshot,businessIds[0],'first');open(snapshot,businessIds[0],'same-date-second');
  const args=await input(snapshot);assert(args.financialProofs[0].canProceed);
  await assert.rejects(handoff.plan(args),/MULTIPLE_OPEN_SESSIONS/,'Valid individual summaries do not authorize two active runtimes');
}
{
  const snapshot=source();open(snapshot,businessIds[0],'unverified');snapshot.movements=[];
  const args=await input(snapshot);await assert.rejects(handoff.plan(args),/FINANCIAL_PROOF_MISMATCH/);
}
{
  const snapshot=source();open(snapshot,businessIds[0],'closed-history');
  Object.assign(snapshot.cashSessions[0],{status:'closed',closedAt:'2026-09-03T23:00:00.000Z'});
  // A reconciliation-only closed session has intentionally no fabricated report.
  const args=await input(snapshot,{historicalReadOnly:true}),before=structuredClone(snapshot);
  const result=await handoff.plan(args),runtime=result.runtimes[0];
  assert.equal(runtime.content.data.openCashSessionId,'');
  assert.deepEqual(runtime.closedReadOnlySessionIds,['closed-history']);
  assert.deepEqual(snapshot,before);assert.equal(snapshot.dailyReports.length,0);
  assert(!Object.hasOwn(runtime.content.data,'salesTotal'),'No invented zero financial summary for immutable history');
  open(snapshot,businessIds[0],'new-session');
  const next=await handoff.plan(await input(snapshot,{historicalReadOnly:true}));
  assert.equal(next.runtimes[0].content.data.openCashSessionId,'new-session');
  assert.deepEqual(next.runtimes[0].closedReadOnlySessionIds,['closed-history']);
}
console.log('PASS Spark read-only owner-wide handoff: source/proof/journal binding, exact runtime, immutable history, no activation or replay');
