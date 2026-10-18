import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const moneySource=source.slice(source.indexOf('function parseMoney(value)'),source.indexOf('  function fmt(value)'));
const helperStart=source.indexOf('  function hasReadOnlyCashHistory('),helperEnd=source.indexOf('\t  async function reopenCashDay(',helperStart);
assert(helperStart>0&&helperEnd>helperStart);
function harness({owner=true,modular=true,amount=''}={}){
  const businessId='synthetic-business',date='2026-09-03';
  const oldSession={id:'old-session',businessId,date,status:'closed',storageHistoryReadOnly:true,reportId:'old-report'};
  const oldReport={id:'old-report',businessId,cashSessionId:oldSession.id,date,status:'closed',storageHistoryReadOnly:true};
  const state={cashSessions:[structuredClone(oldSession)],dailyReports:[structuredClone(oldReport)],movements:[],sales:[{id:'historic-sale',total:30}],products:[{id:'p1',stock:7}]};
  const nodes=new Map([['#independentCashOpenForm',{}],['#independentCashDate',{value:date}],['#independentCashAmount',{value:amount}],['#independentCashConfirm',{disabled:false}]]);
  const messages=[],commits=[];let sequence=0,release,wait=false;
  const scope=vm.createContext({state,window:{click360SparkOperationalSession:modular?{identity:{ownerUid:'owner',businessId}}:null,
    click360User:{uid:'owner'},click360Auth:{currentUser:{uid:'owner'}}},
    currentBusiness:()=>({id:scope.businessId}),today:()=>scope.date,isOwnerUser:()=>scope.owner,
    latestCashSession:()=>state.cashSessions.at(-1),currentOpenCashSession:()=>state.cashSessions.find(row=>row.status==='open')||null,
    toast:message=>messages.push(message),showModal:html=>scope.html=html,$:id=>nodes.get(id),
    escapeHtml:String,parseMoney:v=>v===''?0:Number(v),cloneState:structuredClone,uid:prefix=>`${prefix}-${++sequence}`,
    nowLabel:()=>date,authUser:()=>({name:'Synthetic',role:'owner'}),addAudit:()=>{},closeModal:()=>{},renderApp:()=>{},
    commitCriticalMutation:async(previous,reason,verify,options)=>{
      commits.push({previous,reason,command:options.sparkCommand});assert.equal(verify(state),true);
      if(wait)await new Promise(resolve=>release=resolve);
      return {ok:true,pending:false};
    }});
  Object.assign(scope,{businessId,date,owner});vm.runInContext(moneySource,scope);vm.runInContext(source.slice(helperStart,helperEnd),scope);
  const submit=()=>nodes.get('#independentCashOpenForm').onsubmit({preventDefault(){}});
  return {scope,state,nodes,messages,commits,oldSession,oldReport,submit,hold:()=>wait=true,release:()=>release?.()};
}
for(const amount of ['0','17.25']){
  const h=harness({amount}),before=structuredClone(h.state);
  h.scope.openIndependentCashDayDialog();assert(h.scope.html.includes('readonly'));assert(!h.scope.html.includes('value="0.00"'));
  await h.submit();assert.equal(h.commits.length,1);
  const command=h.commits[0].command;assert.equal(command.kind,'cash_open');
  assert.deepEqual(Object.keys(command.input).sort(),['cashSessionId','date','openingAmount','operationId']);
  assert.equal(command.input.openingAmount,Number(amount));assert.equal(command.input.date,h.scope.date);
  assert.notEqual(command.input.cashSessionId,h.oldSession.id);
  assert.equal(Object.hasOwn(command.input,'previousReportId'),false);
  assert.deepEqual(h.state.cashSessions[0],before.cashSessions[0]);assert.deepEqual(h.state.dailyReports,before.dailyReports);
  assert.deepEqual(h.state.sales,before.sales);assert.deepEqual(h.state.products,before.products);
  assert.equal(h.state.cashSessions[1].status,'open');assert.equal(h.state.cashSessions[1].openingAmount,Number(amount));
  assert.equal(Object.hasOwn(h.state.cashSessions[1],'reopened'),false);
}
for(const amount of ['', '-1','not-money','abc','$','USD 0','x17','-0']){
  const h=harness({amount}),before=structuredClone(h.state);h.scope.openIndependentCashDayDialog();await h.submit();
  assert.equal(h.commits.length,0);assert.deepEqual(h.state,before,'Invalid/absent fund must never invent zero or mutate protected data');
}
for(const mutate of [h=>h.scope.owner=false,h=>h.scope.businessId='other',h=>h.scope.date='2026-09-04',
  h=>h.scope.window.click360Auth.currentUser.uid='other-owner',h=>h.scope.window.click360SparkOperationalSession.identity.businessId='other',
  h=>h.nodes.get('#independentCashDate').value='2026-09-04',h=>h.scope.window.click360SparkOperationalSession=null]){
  const h=harness({amount:'0'});h.scope.openIndependentCashDayDialog();const before=structuredClone(h.state);mutate(h);await h.submit();
  assert.equal(h.commits.length,0);assert.deepEqual(h.state,before,'A stale modal cannot write for another user/business/date');
}
for(const options of [{owner:false},{modular:false}]){
  const h=harness(options);h.scope.openIndependentCashDayDialog();assert.equal(h.scope.html,undefined);assert.equal(h.commits.length,0);
}
{
  const h=harness({amount:'0'});h.scope.openIndependentCashDayDialog();h.hold();const pending=h.submit();await h.submit();
  assert.equal(h.commits.length,1);h.release();await pending;
}
// Execute the real renderer, proving routing is exclusive to protected Spark
// history; ordinary successor/legacy actions remain the original UI.
const cashStart=source.indexOf('function cashView()'),cashEnd=source.indexOf('function labelKind(',cashStart);
for(const modular of [false,true])for(const protectedHistory of [false,true]){
  const h=harness({modular});h.state.cashSessions[0].storageHistoryReadOnly=protectedHistory;h.state.dailyReports[0].storageHistoryReadOnly=protectedHistory;
  Object.assign(h.scope,{tenantDataHydrated:true,movementsForBiz:()=>[],isCashIncomeMovement:()=>false,staleOpenCashSession:()=>null,
    isDayStarted:()=>false,isDayClosed:()=>true,icon:()=>'',fmt:String,actionId:String,sparkHistoryPageControl:()=>''});
  vm.runInContext(source.slice(cashStart,cashEnd),h.scope);const html=h.scope.cashView();
  assert.equal(html.includes('id="independentCashOpenBtn"'),modular&&protectedHistory);
  assert.equal(html.includes('id="reopenCashBtn"'),!(modular&&protectedHistory));
  assert.equal(html.includes('id="startDayBtnCash"'),false);
}
assert(source.includes("$('#independentCashOpenBtn')?.addEventListener('click',openIndependentCashDayDialog)"));
console.log('PASS actual protected-history cash UI: explicit owner fund (including typed zero), exact date/context, new independent cash_open IDs, no predecessor/counter inference, old report/session/sale/stock preserved, double submit denied, legacy unchanged. VM handler coverage; real served browser certification remains separate.');
