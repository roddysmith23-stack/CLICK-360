'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.CLICK360_COMMERCE_APP_SOURCE || 'app.js', 'utf8');
const view = source.slice(source.indexOf('function debtorsView()'), source.indexOf('  window.viewLayawayDetails'));
const bind = source.slice(source.indexOf('function bindDebtors()'), source.indexOf('  function bindInventory()'));
const sales = [
  {id:'cash-sale',method:'Efectivo',status:'paid',balance:0},
  {id:'pending',method:'Apartado',status:'layaway',balance:10},
  {id:'paid',method:'Apartado',status:'paid',balance:0},
  {id:'ready',method:'Apartado',status:'paid',balance:0},
  {id:'delivered',method:'Apartado',status:'paid',balance:0},
  {id:'cancelled',method:'Apartado',status:'cancelled',balance:0}
].map(s=>({...s,businessId:'synthetic',customer:s.id,total:20,items:[]}));
const status = {pending:'partially_paid',paid:'paid',ready:'ready_for_pickup',delivered:'picked_up',cancelled:'cancelled'};
const context = {tenantDataHydrated:true,currentBusiness:()=>({id:'synthetic'}),salesForBiz:()=>sales,
  state:{layaways:sales.filter(s=>s.method==='Apartado').map(s=>({id:'lay-'+s.id,saleId:s.id,businessId:'synthetic',status:status[s.id]}))},
  window:{},saleItems:s=>s.items,escapeHtml:String,fmt:String,icon:()=>'',actionId:String};
vm.runInNewContext(view+';html=debtorsView();',context);
assert(!context.html.includes('data-layaway-search="cash-sale'), 'paid retail sale must never become a layaway');
assert(context.html.includes('data-layaway-search="cancelled'), 'Todos retains cancelled layaway history');
for(const label of ['Pendientes','Pagados','Listos','Entregados','Todos']) assert(context.html.includes('>'+label+'</button>'), 'visible quick filter '+label);
const rows = Object.entries(status).map(([id,value])=>({dataset:{layawaySearch:id,layawayStatus:value,layawayActive:String(!['picked_up','cancelled'].includes(value))},hidden:false}));
const select={value:'pending',addEventListener:(event,fn)=>{select.change=fn;}};
const search={value:'',addEventListener:(event,fn)=>{search.input=fn;}};
const buttons=['pending','paid','ready_for_pickup','picked_up','all'].map(value=>({dataset:{layawayFilter:value},setAttribute(){},classList:{toggle(){}},addEventListener(event,fn){this.click=fn;}}));
const bindContext={$:s=>s==='#layawayStatusFilter'?select:search,$$:s=>s==='.layawayRow'?rows:buttons};
vm.runInNewContext(bind+';bindDebtors();',bindContext);
assert.deepEqual(rows.filter(r=>!r.hidden).map(r=>r.dataset.layawaySearch),['pending']);
for(const [filter,expected] of [['paid',['paid']],['ready_for_pickup',['ready']],['picked_up',['delivered']],['all',Object.keys(status)]]){
  buttons.find(b=>b.dataset.layawayFilter===filter).click();
  assert.deepEqual(rows.filter(r=>!r.hidden).map(r=>r.dataset.layawaySearch),expected);
}
select.value='pending';search.value='delivered';search.input();
assert.deepEqual(rows.filter(r=>!r.hidden).map(r=>r.dataset.layawaySearch),['delivered'],'search across statuses preserved');
console.log('PASS Apartados UI: paid retail excluded; cancelled history; five filters; search across all statuses');
