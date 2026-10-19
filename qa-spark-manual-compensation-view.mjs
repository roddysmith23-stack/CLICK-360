import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import './spark-modular-migration.js';
import './modular-ui-adapter.js';
const source=await readFile('app.js','utf8');
const start=source.indexOf('function movementEffectiveAmount(m,sales=state.sales,movements=state.movements) {'),end=source.indexOf('function isDayStarted()',start);
assert(start>0&&end>start);
const original={id:'original',businessId:'alpha',cashSessionId:'exact-session',date:'2026-09-03',
  kind:'egreso',amount:3,compensatedByOperationId:'correction',reversalMovementId:'correction-rev'};
const reversal={...original,id:'correction-rev',operationId:'correction',compensationSign:-1,compensatesMovementId:'original'};
delete reversal.compensatedByOperationId;delete reversal.reversalMovementId;
const context={state:{sales:[],movements:[original]}};
const effective=vm.runInNewContext(`(${source.slice(start,end).trim()})`,context);
assert.equal(effective(original),3);assert.equal(effective(reversal),-3);
assert.equal([original,reversal].reduce((sum,row)=>sum+effective(row),0),0);
for(const delta of [{compensationSign:1},{businessId:'foreign'},{cashSessionId:'other-session'},
  {date:'2026-09-04'},{amount:99},{kind:'ingreso'},{operationId:'other'},{compensatesMovementId:'missing'}])
  assert.throws(()=>effective({...reversal,...delta}),/CASH_COMPENSATION_RELATION_INVALID/);
for(const key of ['saleId','paymentType','productId','compensationSign']){
  original[key]='forbidden';assert.throws(()=>effective(reversal),/CASH_COMPENSATION_RELATION_INVALID/);delete original[key];
}
const assignment='window.click360ProjectSparkOperation = ';
const projectionStart=source.indexOf(assignment)+assignment.length;
const projectionEnd=source.indexOf('\n  };\n  window.click360PersistTenantState',projectionStart)+4;
assert(projectionStart>assignment.length&&projectionEnd>projectionStart);
const scope={...original,businessId:'alpha'},identity={businessId:'alpha',tenantKey:'owner:synthetic:business:alpha'};
const replacement={id:'correction-new',businessId:'alpha',operationId:'correction',kind:'egreso',amount:4};
const projectionContext={state:{movements:[scope,reversal,replacement],sales:[]},activeTenantContext:{},
  currentBusiness:()=>({id:'alpha'}),cloneState:structuredClone,renderApp:()=>{},location:{hash:'#cash'},
  window:{click360SparkOperationalSession:{identity},click360DebugCriticalActionGate:()=>({size:1})}};
projectionContext.window.click360PersistSparkCandidate=async next=>{projectionContext.state=next;};
const project=vm.runInNewContext(`(${source.slice(projectionStart,projectionEnd).trim()})`,projectionContext);
await project({source:'server',identity,operationId:'correction',records:{movements:[reversal,scope,replacement]}});
assert.equal(new Set(projectionContext.state.movements.map(row=>row.id)).size,3);
assert.equal(projectionContext.state.movements.find(row=>row.id==='correction-new').compensationSign,undefined,
  'Distinct records sharing an operation ID must never inherit reversal fields');
projectionContext.state={movements:[{id:'legacy-local-alias',businessId:'alpha',operationId:'receipt',amount:2}],sales:[]};
await project({source:'server',identity,operationId:'receipt',records:{movements:[{id:'receipt',businessId:'alpha',operationId:'receipt',amount:2}]}});
assert.equal(projectionContext.state.movements.length,1);assert.equal(projectionContext.state.movements[0].id,'receipt');
const handlerStart=source.indexOf('async function commitSparkManualMovementCorrection(');
const handlerEnd=source.indexOf('\n\t  window.editMovement',handlerStart);
assert(handlerStart>0&&handlerEnd>handlerStart);
const captured={id:'live-manual',businessId:'alpha',cashSessionId:'exact-session',date:'2026-09-03',
  kind:'egreso',amount:3,recordVersion:1,operationId:'original-op'};
let durable=null,commitCount=0;
const handlerContext={state:{movements:[structuredClone(captured)],cashSessions:[{id:'exact-session',businessId:'alpha',
  status:'open',summaryVersion:1,incomeCash:0,expenseCash:3,cashBalance:-3}]},
  currentBusiness:()=>({id:'alpha'}),cloneState:structuredClone,uid:()=> 'live-correction',authUser:()=>({name:'Synthetic'}),
  nowLabel:()=> 'Synthetic',addAudit:()=>{},closeModal:()=>{},renderApp:()=>{},toast:()=>{},
  window:{CLICK360_SPARK_MIGRATION:globalThis.CLICK360_SPARK_MIGRATION,CLICK360_MODULAR_UI_ADAPTER:globalThis.CLICK360_MODULAR_UI_ADAPTER,
    click360SparkOperationalSession:{identity:{ownerUid:'synthetic-owner',businessId:'alpha'}},click360Auth:{currentUser:{uid:'synthetic-owner'}}}};
handlerContext.commitCriticalMutation=async(previous,reason,predicate,{sparkCommand})=>{
  assert.equal(sparkCommand.kind,'manual_movement_correct');assert(predicate(handlerContext.state));
  durable=structuredClone(handlerContext.state);commitCount++;return {ok:true,pending:true};
};
const correct=vm.runInNewContext(`(${source.slice(handlerStart,handlerEnd).trim()})`,handlerContext);
await correct(captured,{kind:'egreso',amount:4,note:'Replacement'});
assert.equal(durable.movements[0].compensatedByOperationId,'live-correction');
assert.equal(durable.movements[0].amount,3);assert.equal(durable.cashSessions[0].expenseCash,4);
assert.equal(durable.movements.find(row=>row.id==='live-correction-rev').compensatesMovementId,captured.id);
const stable=JSON.stringify(handlerContext.state);
await correct({...captured,recordVersion:0},{kind:'egreso',amount:4,note:'Stale'});
assert.equal(commitCount,1);assert.equal(JSON.stringify(handlerContext.state),stable,'Stale modal cannot enqueue or mutate');
console.log(JSON.stringify({status:'PASS',actualPWAViewReducer:true,originalAmountPreserved:true,
  exactCompensationRelation:true,multiRecordOperationProjection:true,singleReceiptAliasPreserved:true,
  durableModalReferenceRebound:true,staleModalCannotEnqueue:true,
  crossBusinessAndSessionDenied:true,noSaleOrStockEffect:true,productionWrites:0}));
