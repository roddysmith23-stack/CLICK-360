import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the guard extracted from the real editor, not a duplicate model.
const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const editor=source.slice(source.indexOf('function openProductModal('));
const baseline=editor.slice(editor.indexOf('const modalTenantKey ='),editor.indexOf('const linkedRecipe ='));
const submit=editor.slice(editor.indexOf("$('#productForm').onsubmit=async e=>{"));
const guard=submit.slice(submit.indexOf('if (activeTenantContext?.tenantKey !=='),submit.indexOf("const name=$('#pName')"));
assert(baseline.includes('const editOpenBaseline =')&&guard.includes('product = liveProduct;'),'real editor guard must be present');
const original={id:'product-1',businessId:'business-1',code:'SYNTHETIC',name:'Synthetic product',stock:5,qty:5,price:12};
const context={tenantKey:'synthetic-owner:business-1'};
function run({record=original,tenantKey=context.tenantKey,businessId='business-1'}={}){
  const sandbox={original:structuredClone(original),record:record&&structuredClone(record),context,tenantKey,businessId,
    cloneState:structuredClone,window:{},toast:(message)=>({rejected:message}),writeBlockMessage:gate=>gate.reason};
  vm.createContext(sandbox);
  return vm.runInContext(`(()=>{
    let product=original,activeTenantContext=context;
    const b={id:'business-1'};
    ${baseline}
    const state={products:record?[record]:[],sales:[{id:'sale-1'}],movements:[{id:'movement-1'}]};
    const before=JSON.stringify(state);
    activeTenantContext={tenantKey};
    const currentBusiness=()=>({id:businessId});
    const result=(()=>{${guard} return product;})();
    return {result,state,before,diagnostics:window.CLICK360_LAST_CONFIRMATION_DIAGNOSTICS,
      currentReference:result===state.products[0]};
  })()`,sandbox);
}
const rebound=run();
assert.equal(rebound.currentReference,true,'identical rehydration must bind current state, not the old object');
rebound.result.stock=rebound.result.qty=6;
assert.equal(rebound.state.products[0].stock,6);
for(const input of [{record:{...original,stock:7,qty:7}},{record:{...original,price:15}},{record:null}]){
  const rejected=run(input);
  assert.equal(rejected.result.rejected,'sync_conflict');
  assert.equal(rejected.diagnostics.outcome,'safe_conflict');
  assert.equal(rejected.diagnostics.retryAttempted,false);
  assert.equal(JSON.stringify(rejected.state),rejected.before,'rejection must not mutate any material record');
}
for(const input of [{tenantKey:'other-owner:business-1'},{businessId:'business-2'}]){
  const rejected=run(input);
  assert.match(rejected.result.rejected,/negocio activo cambió/);
  assert.equal(JSON.stringify(rejected.state),rejected.before);
}
console.log('PASS real product editor: identical rehydration/current reference, stock/price conflict, deletion, tenant/business isolation, no commercial replay');
