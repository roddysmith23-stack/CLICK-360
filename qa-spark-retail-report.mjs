import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync(new URL('./spark-operational-bootstrap.js',import.meta.url),'utf8');
const root={};vm.runInNewContext(source,{window:root});
const aggregate=()=>root.CLICK360_SPARK_BOOTSTRAP.retailAccumulator({businessId:'business',from:'2026-09-01',to:'2026-09-30'});
const sale={id:'sale',businessId:'business',date:'2026-09-03',total:10,received:10,status:'paid',items:[{name:'Camisa',qty:1}]};
{
  const a=aggregate(),s=structuredClone(sale);a.add('sales',s);a.add('movements',{...s,kind:'ingreso',saleId:'older-sale',amount:4});
  a.add('movements',{...s,kind:'ingreso',amount:999});
  const result=a.finish();assert.equal(result.pendingTotal,0);assert.equal(result.collectedTotal,4);assert.equal(result.soldTotal,10);
  assert.deepEqual(s,sale,'Reports cannot rewrite historical source');
  const b=aggregate();b.add('sales',{...s,status:'paid',total:undefined,received:undefined});
  assert.equal(b.finish().pendingTotal,null,'Missing both fields is not proof of zero balance');assert.equal(b.finish().soldTotal,null);
  const c=aggregate();c.add('sales',{...s,storageHistoryReadOnly:true});assert.equal(c.finish().financiallyVerified,false);
  assert.equal(c.finish().soldTotal,10,'Preserved amounts stay visible without pretending reconciled history');
  const d=aggregate();d.add('sales',{...s,status:'cancelled'});d.add('movements',{...s,saleId:s.id,kind:'ingreso',amount:10});
  d.add('movements',{...s,saleId:s.id,kind:'sale_cancellation',amount:10,compensationSign:-1});
  assert.equal(d.finish().collectedTotal,0);assert.equal(d.finish().soldTotal,0);assert.equal(d.finish().tickets,0);
  assert.throws(()=>d.add('movements',{...s,saleId:s.id,kind:'sale_cancellation',amount:10}),/COMPENSATION/);
}
// Execute the actual controller method and actual authoritative server boundary,
// not a reimplementation of pagination/guards. No timers, database writes, or SDK cache acceptance.
function fixture({cache=false,pending=0,concurrent=false,changeActor=false}={}){
  let actor='owner',version=1,reportQueries=0,phase='READY',epoch=0,flight=null;
  const data={sales:Array.from({length:105},(_,i)=>({...sale,id:`sale-${String(i).padStart(3,'0')}`})),
    movements:Array.from({length:105},(_,i)=>({...sale,id:`movement-${String(i).padStart(3,'0')}`,saleId:'sale',kind:'ingreso',amount:10}))};
  const queries=[];
  const metadata=()=>({fromCache:cache,hasPendingWrites:false});
  const db={doc:()=>({get:async options=>{assert.equal(options.source,'server');return {metadata:metadata(),data:()=>({data:{recordVersion:version,openCashSessionId:null}})};}}),
    collection:path=>{
      const module=path.split('/').at(-1);let after=null,n;
      const q={where:()=>q,orderBy:()=>q,limit:value=>{n=value;return q;},startAfter:(...value)=>{after=value;return q;},get:async options=>{
        assert.equal(options.source,'server');assert.equal(n,100);queries.push({module,after,n});reportQueries++;
        if(concurrent&&reportQueries===2)version++;if(changeActor&&reportQueries===2)actor='another';
        const rows=data[module].slice().sort((a,b)=>b.id.localeCompare(a.id)).filter(row=>!after||row.date<after[0]||(row.date===after[0]&&row.id<after[1])).slice(0,n);
        return {metadata:metadata(),docs:rows.map(row=>({id:row.id,data:()=>({data:row})}))};
      }};return q;
    }};
  const scope=vm.createContext({db,ownerUid:'owner',actorUid:'owner',resolveBusiness:()=> 'business',
    awaitStage:(_stage,run)=>run(),
    context:()=>{if(actor!=='owner')throw Error('SPARK_BOOTSTRAP_CONTEXT_CHANGED');},
    session:{isBusy:()=>false,health:async()=>({pendingCount:pending,unknownCount:0,projectionPendingCount:0})},
    codec:{unpack:async raw=>raw.data},api:{hash:async value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')},
    retailAccumulator:root.CLICK360_SPARK_BOOTSTRAP.retailAccumulator,onProgress:()=>{},Date,console,
    publish:value=>{phase=value;scope.phase=value;},phase,epoch,flight});
  const s=source.indexOf('    async function server('),e=source.indexOf('    async function mode()',s);
  const m=source.indexOf('      async readRetailReport('),n=source.indexOf('},async loadMore(',m);
  assert(s>0&&e>s&&m>0&&n>m);
  vm.runInContext(source.slice(s,e)+';globalThis.controller={'+source.slice(m,n)+'}};',scope);
  return {run:options=>scope.controller.readRetailReport({from:'2026-09-01',to:'2026-09-30',...options}),queries,data};
}
{
  const f=fixture(),before=structuredClone(f.data),result=await f.run();
  assert.equal(result.complete,true);assert.equal(result.sales.length,105);assert.equal(result.movements.length,105);
  assert.equal(result.readCount,210);assert.equal(result.pages,4);assert.equal(result.soldTotal,1050);assert.equal(result.collectedTotal,1050);
  assert.equal(f.queries.filter(q=>q.after).length,2);assert.deepEqual(f.data,before);
  await assert.rejects(fixture().run({maxRecords:100}),/READ_BUDGET/);
  await assert.rejects(fixture({cache:true}).run(),/SERVER_REQUIRED/);
  await assert.rejects(fixture({pending:1}).run(),/PENDING_RECONCILIATION/);
  await assert.rejects(fixture({concurrent:true}).run(),/CONCURRENT_WRITE/);
  await assert.rejects(fixture({changeActor:true}).run(),/CONTEXT_CHANGED/);
}
// Run the real cash reducers: mixed tender refunds affect cash only by cash,
// total collections by the whole receipt, and never count a second expense.
{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8'),start=app.indexOf('  function isCashIncomeMovement('),end=app.indexOf('  function isDayStarted()',start);
  const receiptSummary={version:1,cashSessionId:'session',uniformSession:true,cash:3,card:0,transfer:2,receivablePayments:3};
  const cancelled={...sale,status:'cancelled',cashSessionId:'session',received:5,cancelOperationId:'cancel-sale',receiptSummary};
  const reversal={id:'cancel-sale-rev',businessId:'business',date:sale.date,saleId:sale.id,cashSessionId:'session',operationId:'cancel-sale',kind:'sale_cancellation',amount:5,compensationSign:-1,paymentTotals:receiptSummary};
  const scope=vm.createContext({state:{sales:[cancelled],movements:[reversal]}});vm.runInContext(app.slice(start,end),scope);
  assert.equal(scope.isCashIncomeMovement(reversal),true);assert.equal(scope.movementCashIncomeAmount(reversal),-3);assert.equal(scope.movementEffectiveAmount(reversal),-5);
  for(const bad of [{amount:6},{compensationSign:1},{cashSessionId:'other'},{paymentTotals:{...receiptSummary,cash:5}}])
    assert.throws(()=>scope.movementEffectiveAmount({...reversal,...bad}),/COMPENSATION_RELATION/);
  assert(app.includes("m.kind !== 'ingreso' && m.kind !== 'apertura' && m.kind !== 'sale_cancellation'"),'Cash close cannot subtract a refund twice');
}
console.log(JSON.stringify({status:'PASS',retailPeriodServerPages:4,records:210,unknownAmountsNotInvented:true,mixedTenderRefundNet:true,noCommercialWrites:true}));
{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const counterStart=app.indexOf('  function sparkCashCounterView('),counterEnd=app.indexOf('  function isDayStarted()',counterStart);
  const viewStart=app.indexOf('  function cashView()'),viewEnd=app.indexOf('  function labelKind(',viewStart);
  const cash={id:'session',businessId:'business',status:'open',date:'2026-09-03',summaryVersion:1,openingAmount:0,
    cashBalance:117,salesTotal:300,incomeCash:20,expenseCash:3,itemCount:201,taxTotal:2,paymentTotals:{cash:100,card:50,transfer:150,receivablePayments:3}};
  const orphan={id:'refund',businessId:'business',cashSessionId:'session',date:cash.date,kind:'sale_cancellation',amount:5,compensationSign:-1};
  const ctx=vm.createContext({window:{click360SparkOperationalSession:{},click360GetSyncStatus:()=>({status:'modular_confirmed'})},
    tenantDataHydrated:true,state:{sales:[],movements:[orphan],dailyReports:[]},currentBusiness:()=>({id:'business'}),
    currentOpenCashSession:()=>cash,latestCashSession:()=>cash,movementsForBiz:()=>[orphan],today:()=>cash.date,
    staleOpenCashSession:()=>null,hasReadOnlyCashHistory:()=>false,isDayStarted:()=>true,isDayClosed:()=>false,
    authUser:()=>({role:'owner'}),actionId:String,escapeHtml:String,labelKind:String,fmt:value=>`$${value}`,icon:()=>'',sparkHistoryPageControl:()=>''});
  vm.runInContext(app.slice(counterStart,counterEnd)+app.slice(viewStart,viewEnd),ctx);
  const before=JSON.stringify(cash),html=ctx.cashView();assert(html.includes('$117'));assert(html.includes('$120'));
  assert(html.includes('Relación pendiente de consulta del período'),'A paginated missing original cannot crash the cash view');
  ctx.window.click360GetSyncStatus=()=>({status:'modular_pending'});
  for(const pending of [1,2,250]){
    ctx.state.sales=Array.from({length:pending},(_,i)=>({...sale,id:`pending-${i}`}));
    const html=ctx.cashView();assert(html.includes('Pendiente de confirmar'));assert(!html.includes('$117'),'Old counters cannot claim current balance during replay');
  }
  assert.equal(JSON.stringify(cash),before);ctx.window.click360GetSyncStatus=()=>({status:'modular_confirmed'});
  assert(ctx.cashView().includes('$117'),'Confirmed projection restores authoritative counters without summing history');
  Object.assign(ctx,{updateCashCloseDiagnostic:()=>{},safeImageSrc:()=>'',nowLabel:()=>'',saleItems:s=>s.items||[],globalThis:{}});
  const summaryStart=app.indexOf('  function buildCashCloseSummary('),summaryEnd=app.indexOf('  function cashCloseReportHtml(',summaryStart);
  vm.runInContext(app.slice(summaryStart,summaryEnd),ctx);
  const input={basis:{activeSession:cash,businessId:'business',business:{name:'Synthetic'},date:cash.date,closeMovements:[orphan]},cInicial:0,eFisico:117,observations:'',reportId:'report'};
  const summary=ctx.buildCashCloseSummary(input);
  assert.equal(summary.balanceCalculado,117);assert.equal(summary.totalItems,201);assert.equal(summary.salesTransf,150);
  assert.equal(summary.sales.length,0,'Do not label paginated sale IDs as a complete cash report');
  assert.throws(()=>ctx.buildCashCloseSummary({...input,cInicial:9}),/COUNTERS_PENDING_OR_UNVERIFIED/);
  for(const pending of [1,2]){ctx.window.click360GetSyncStatus=()=>({status:'modular_pending'});
    ctx.state.sales=Array.from({length:pending},(_,i)=>({...sale,id:`pending-close-${i}`}));
    assert.throws(()=>ctx.buildCashCloseSummary(input),/COUNTERS_PENDING_OR_UNVERIFIED/);}
}
