'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf("function renderApp(r='home')"),end=source.indexOf('function homeView()',start);
const render=source.slice(start,end);
for(const scenario of ['typed','input-focused','button-focused','busy','empty','explicit-render','other-business','started','closed','not-hydrated','legal-gate','worker-gate','permission-revoked']){
  let rendered=false,ready=false;
  const input={value:scenario==='typed'?'50':'0.00',dataset:{businessId:'synthetic-A'},focus(){}};
  const button={disabled:scenario==='busy'};
  const sandbox={route:'cash',clockTimer:null,tenantDataHydrated:scenario!=='not-hydrated',console,
    document:{activeElement:scenario==='input-focused'?input:scenario==='button-focused'?button:null},
    $:id=>id==='#apertureAmountInput'?input:id==='#startDayBtnCash'?button:null,
    currentBusiness:()=>({id:scenario==='other-business'?'synthetic-B':'synthetic-A'}),
    checkAuth:()=>true,can:()=>scenario!=='permission-revoked',
    requiresLegalHardGate:()=>scenario==='legal-gate',requiresWorkerAccessGate:()=>scenario==='worker-gate',
    isDayStarted:()=>scenario==='started',isDayClosed:()=>scenario==='closed',
    stopScanner(){},closeModal(){},clearInterval(){},history:{replaceState(){}},shell:x=>x,bindShell(){},bindView(){},
    checkDueReminders(){},setTimeout(){},showOnboardingForNewAccount(){},maybeShowLegalGraceBanner(){},startInactivityWatch(){},
    publishCustomerHealthSnapshot(){},markAppReady(){ready=true;},refreshIcons(){},
    app:{set innerHTML(_){rendered=true;}}};
  for(const name of render.match(/const views=\{([^}]+)\}/)[1].split(',').map(pair=>pair.split(':')[1]))sandbox[name]=()=>'';
  vm.createContext(sandbox);vm.runInContext(render,sandbox);
  sandbox.renderApp('cash',{preserveActiveModal:scenario!=='explicit-render'});
  assert.equal(rendered,!['typed','input-focused','button-focused','busy','empty'].includes(scenario),scenario);
  assert(ready,scenario+' remains ready');
}
console.log('PASS cash opening draft/gesture refresh: same-business access events preserve handler; explicit render, session state, hydration and permission/legal gates still win');
