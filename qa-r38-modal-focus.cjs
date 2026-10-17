'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf('function showModal(html)'),end=source.indexOf('function closeModal(',start);
for(const scenario of ['input','select','button','default','closed']){
  const frames=[];
  const heading={id:'',focus(){box.document.activeElement=this;},set tabIndex(_) {}};
  const control={matches:()=>true};
  const dialog={isConnected:true,contains:value=>value===heading||value===control,setAttribute(){}};
  const root={innerHTML:'',addEventListener(){}};
  const box={modalReturnFocus:null,modalKeyHandler:null,uid:()=> 'synthetic',escapeHtml:x=>x,
    currentBusiness:()=>({id:'synthetic-business'}),closeModal(){},refreshIcons(){},
    requestAnimationFrame:cb=>frames.push(cb),
    document:{activeElement:{},body:{classList:{add(){}}},addEventListener(){},
      createElement:()=>root},
    $:selector=>selector==='#modalRoot'?root:selector==='.modal'?dialog:
      selector==='h1,h2,h3'?heading:selector==='.modalOverlay'?root:null,
    $$:()=>[]};
  vm.createContext(box);vm.runInContext(source.slice(start,end),box);
  box.showModal('synthetic');
  // Real caller focuses its input after showModal returns; a customer may
  // focus/select another control before the queued animation frame runs.
  if(['input','select','button'].includes(scenario))box.document.activeElement=control;
  if(scenario==='closed')dialog.isConnected=false;
  const before=box.document.activeElement;frames[0]();
  assert.equal(box.document.activeElement,scenario==='default'?heading:before,scenario);
}
console.log('PASS actual modal focus: deferred heading never steals active form control or focuses a closed dialog; default accessibility focus remains');
