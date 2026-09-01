'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.env.CLICK360_SEARCH_SOURCE||'app.js','utf8');
const start=source.indexOf("function renderApp(r='home')"),end=source.indexOf('function homeView()',start),render=source.slice(start,end);
for(const route of ['inventory','cash'])for(const sameBusiness of [true,false]){
  const previous={value:'R38-CODE',dataset:{businessId:'synthetic-A'},selectionStart:4,selectionEnd:8};
  let current=previous,boundQuery,focused=false,selection;
  const selector=route==='inventory'?'#productSearch':'#apertureAmountInput';
  const sandbox={console,route,clockTimer:null,document:{activeElement:previous},
    $:id=>id===selector?current:null,currentBusiness:()=>({id:sameBusiness?'synthetic-A':'synthetic-B'}),
    checkAuth:()=>true,can:()=>true,requiresLegalHardGate:()=>false,requiresWorkerAccessGate:()=>false,
    stopScanner(){},closeModal(){},clearInterval(){},history:{replaceState(){}},shell:x=>x,
    bindShell(){},bindView(){boundQuery=current.value;},checkDueReminders(){},setTimeout(){},
    maybeShowLegalGraceBanner(){},startInactivityWatch(){},publishCustomerHealthSnapshot(){},markAppReady(){},refreshIcons(){},
    app:{set innerHTML(_value){current={value:'',dataset:{businessId:sameBusiness?'synthetic-A':'synthetic-B'},focus(){focused=true;},setSelectionRange(a,b){selection=[a,b];}};}}};
  const viewNames=render.match(/const views=\{([^}]+)\}/)[1].split(',').map(pair=>pair.split(':')[1]);
  for(const name of viewNames)sandbox[name]=()=> 'synthetic-view';
  vm.createContext(sandbox);vm.runInContext(render,sandbox);sandbox.renderApp(route);
  assert.equal(boundQuery,sameBusiness?'R38-CODE':'','query restored before binding, only within same business');
  assert.equal(focused,sameBusiness);if(sameBusiness&&route==='inventory')assert.deepEqual(selection,[4,8]);
}
console.log('PASS actual renderApp: search and cash opening survive same-business refresh and never cross business context');
