import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
await import('./v16-domain.js');
const app=await readFile('app.js','utf8');
const source=app.slice(app.indexOf('  window.payLayaway ='),app.indexOf('window.showSaleCompleteModal',app.indexOf('  window.payLayaway =')));
for(const mode of ['refresh','concurrent_payment','business_switch','tenant_switch','date_switch','session_switch','session_closed','gate_rejected']) {
  const context={authUid:'owner',tenantKey:'owner:a'};
  const initial={activeBusinessId:'a',sales:[{id:'s',businessId:'a',status:'layaway',total:12,received:2,balance:10,payments:[]}],
    layaways:[{id:'l',businessId:'a',saleId:'s',balance:10,paid:2,status:'partially_paid'}],products:[{id:'p',stock:3,qty:3}],movements:[],operationLedger:[]};
  let committed=0, closed=false;
  const box={state:structuredClone(initial),activeTenantContext:context,route:'debtors',
    window:{CLICK360_V16_DOMAIN:globalThis.CLICK360_V16_DOMAIN,click360User:{uid:'owner'}},
    decodeActionId:x=>x,contextScope:()=>box.activeTenantContext.tenantKey,
    isDayStarted:()=>true,isDayClosed:()=>closed,currentBusiness:()=>({id:box.state.activeBusinessId}),
    salesForBiz:bid=>box.state.sales.filter(s=>s.businessId===bid),
    requestLayawayPayment:async()=>{
      box.state=structuredClone(box.state); // Authoritative refresh replaces object graph while the dialog is open.
      if(mode==='concurrent_payment'){box.state.sales[0].balance=1;box.state.layaways[0].balance=1;}
      if(mode==='business_switch')box.state.activeBusinessId='b';
      if(mode==='tenant_switch')box.activeTenantContext={authUid:'other-owner',tenantKey:'other-owner:a'};
      if(mode==='session_closed')closed=true;
      box.requestFinished=true;
      return {amount:3,method:'Transferencia',operationId:'payment-op'};
    },
    writeGateStatus:()=>({allowed:mode!=='gate_rejected'}),toast(){},cloneState:structuredClone,uid:()=> 'movement-op',
    today:()=>mode==='date_switch' && box.state!==undefined && box.requestFinished?'2026-10-04':'2026-10-03',nowLabel:()=> '12:00',authUser:()=>({name:'Synthetic owner'}),
    currentOpenCashSession:()=>closed?null:{id:mode==='session_switch' && box.requestFinished?'cash-b':'cash-a'},addAudit(){},renderApp(){},fmt:String,
    commitCriticalMutation:async(previous,reason,verify)=>{committed++;return {ok:verify(box.state),pending:false};}
  };
  vm.createContext(box);vm.runInContext(source,box);await box.window.payLayaway('s');
  if(mode==='refresh') {
    assert.equal(box.state.sales[0].balance,7,'refresh must not detach the sale being mutated');
    assert.equal(box.state.sales[0].payments.length,1);
    assert.equal(box.state.layaways[0].balance,7);
    assert.equal(box.state.movements.length,1);
    assert.equal(committed,1);
  } else {
    assert.equal(committed,0,`${mode}: revalidate current business/session/balance before committing`);
    assert.equal(box.state.movements.length,0);
  }
  assert.deepEqual(box.state.products,initial.products,'abono never decrements stock again');
}
console.log('PASS actual payment mutation: refresh during dialog, concurrent payment, business switch, closed session; no detached sale mutation or second stock decrement');
