'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(process.env.CLICK360_COMMERCE_APP_SOURCE||'app.js','utf8');
const start=source.indexOf('function bindInventoryActions(){'),end=source.indexOf('function openProductModal(',start);
assert(start>=0&&end>start);
const products=Array.from({length:436},(_,i)=>({id:'synthetic-'+i,businessId:'fixture',name:'Synthetic '+i,code:'SYN-'+i}));
const list={},calls=[];
let currentButtons;
const context={state:{products},currentBusiness:()=>({id:'fixture'}),$:(selector)=>selector==='#productList'?list:null,
  $$:selector=>[currentButtons[selector]],refreshIcons:root=>calls.push(['icons',root]),openProductModal:p=>calls.push(['edit',p]),
  openLabelModal:p=>calls.push(['qr',p]),runQuickLabelPrintFlow:job=>calls.push(['print',job.product]),deleteProduct:id=>calls.push(['delete',id]),window:{click360GuardedAction:(_b,fn)=>fn()}};
vm.runInNewContext(source.slice(start,end),context);
for(const index of [435,0,317]){
  const id=products[index].id;
  currentButtons={'[data-edit]':{dataset:{edit:id}},'[data-del]':{dataset:{del:id}},'[data-label]':{dataset:{label:id}},'[data-quick-print]':{dataset:{quickPrint:id}}};
  context.bindInventoryActions();
  assert.equal(calls.at(-1)[0],'icons','fresh innerHTML icon placeholders rehydrated');
  assert.equal(calls.at(-1)[1],list);
  for(const [selector,type]of [['[data-edit]','edit'],['[data-label]','qr'],['[data-quick-print]','print'],['[data-del]','delete']]){
    currentButtons[selector].onclick();assert.equal(calls.at(-1)[0],type);assert.equal(type==='delete'?calls.at(-1)[1]:calls.at(-1)[1].id,id);
  }
}
console.log('PASS Inventory search actual handler: 436 catalog, three re-renders, QR/PRINT/EDIT/DELETE correctly rebound and icons refreshed');
