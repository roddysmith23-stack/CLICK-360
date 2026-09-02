'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.env.CLICK360_CHECKOUT_SOURCE||'app.js','utf8');
const start=source.indexOf("function renderApp(r='home')"),end=source.indexOf('function homeView()',start),render=source.slice(start,end);
for(const scenario of ['cart','busy','focused','typed','noncash','empty','other-tenant','closed-day','not-hydrated','legal-gate','permission-revoked','modal','modal-other-tenant','modal-explicit-render','modal-legal-gate','modal-permission-revoked','modal-not-hydrated']){
  let rendered=false,ready=false;
  const route=scenario.startsWith('modal')?'inventory':'sell';
  const sandbox={console,route,clockTimer:null,tenantDataHydrated:!scenario.includes('not-hydrated'),document:{activeElement:scenario==='focused'?{tagName:'INPUT',closest:()=>({})}:null},
    $:id=>id==='#modalRoot .modalOverlay.show'?{dataset:{businessId:'synthetic-A'}}:id==='#payMethod'?{dataset:{businessId:'synthetic-A'},value:scenario==='noncash'?'Transferencia':'Efectivo'}:id==='#manualCode'?{value:scenario==='typed'?'R38-CORE':''}:id==='#chargeBtn'?{disabled:scenario==='busy'}:null,
    currentBusiness:()=>({id:scenario.includes('other-tenant')?'synthetic-B':'synthetic-A'}),
    window:{click360SellCartCount:()=>scenario==='empty'||scenario==='busy'?0:1},
    isDayStarted:()=>true,isDayClosed:()=>scenario==='closed-day',checkAuth:()=>true,can:()=>!scenario.includes('permission-revoked'),
    requiresLegalHardGate:()=>scenario.includes('legal-gate'),requiresWorkerAccessGate:()=>false,
    stopScanner(){},closeModal(){},clearInterval(){},history:{replaceState(){}},shell:x=>x,bindShell(){},bindView(){},checkDueReminders(){},setTimeout(){},
    showOnboardingForNewAccount(){},maybeShowLegalGraceBanner(){},startInactivityWatch(){},publishCustomerHealthSnapshot(){},markAppReady(){ready=true;},refreshIcons(){},
    app:{set innerHTML(_value){rendered=true;}}};
  for(const name of render.match(/const views=\{([^}]+)\}/)[1].split(',').map(pair=>pair.split(':')[1]))sandbox[name]=()=> 'synthetic-view';
  vm.createContext(sandbox);vm.runInContext(render,sandbox);sandbox.renderApp(route,{preserveActiveModal:scenario.startsWith('modal')&&scenario!=='modal-explicit-render'});
  assert.equal(rendered,!['cart','busy','focused','typed','noncash','modal'].includes(scenario),scenario+' preserves only eligible active checkout or background modal');
  if(scenario!=='modal')assert(ready);
}
assert(source.includes("$('#payMethod').onchange = renderCart;\n    renderCart();"),'initial cash fields reflect selected tender immediately');
console.log('PASS checkout refresh: typed/focused draft, cart, tender and in-flight lock survive; tenant, hydration, cash-day, access and legal gates take precedence');
