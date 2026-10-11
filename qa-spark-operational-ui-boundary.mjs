import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import './spark-operational-ui-runtime.js';
import './modular-ui-adapter.js';
const runtime=globalThis.CLICK360_SPARK_OPERATIONAL_UI;
await assert.rejects(()=>runtime.create({projectId:'click-360',syntheticCertification:true}),/CERTIFICATION_ONLY/);
await assert.rejects(()=>runtime.create({projectId:'click360-staging-7620168025'}),/CERTIFICATION_ONLY/);
await assert.rejects(()=>runtime.create({projectId:'click360-staging-7620168025',syntheticCertification:true}),/MIXED_RELEASE/);
const product={id:'p',businessId:'b',stock:2,qty:2,name:'Perfume',price:30},identity={ownerUid:'a',businessId:'b'};
const adapt=input=>globalThis.CLICK360_MODULAR_UI_ADAPTER.productMutationCommand({identity,operationId:'stable-product',date:'2026-09-03',...input});
assert.equal(adapt({product}).kind,'product_create');
assert.equal(adapt({product:{...product,name:'Nuevo'},previous:product}).kind,'product_edit');
assert.equal(adapt({product:{...product,stock:3,qty:3},previous:product}).input.quantityDelta,1);
assert.throws(()=>adapt({product:{...product,stock:3,qty:3,name:'Nuevo'},previous:product}),/COMPOUND/);
assert.throws(()=>adapt({product:{...product,businessId:'other'}}),/CONTEXT/);
// Extract the real PWA commit entry point: Spark never falls through to save,
// legacy sync or legacy refresh, including an unsupported command and failure.
const source=await readFile('app.js','utf8');
const start=source.indexOf('  async function commitCriticalMutation('),end=source.indexOf('  // Action Guardian:',start);
assert(start>0&&end>start);
let saved=0,synced=0,restored=0,released=0,request;
const context={tenantKey:'owner:a:business:a',ownerUid:'a'},state={identity:context};
const sandbox={window:{click360SparkOperationalSession:{identity:{ownerUid:'a',businessId:'b'},commit:async r=>{request=r;return {ok:true,pending:true};}},click360SyncNow:async()=>{synced++;}},
  currentBusiness:()=>({id:'b'}),
  state,activeTenantContext:context,uid:()=> 'device-persist-id',cloneState:structuredClone,
  acquireCriticalAction:()=>({acquired:true,release:()=>{released++;}}),
  restoreCriticalSnapshot:()=>{restored++;},toast:()=>{},save:()=>{saved++;return true;},navigator:{onLine:true}};
vm.createContext(sandbox);vm.runInContext(`${source.slice(start,end)};globalThis.commit=commitCriticalMutation`,sandbox);
const command={kind:'cash_open',input:{operationId:'stable-open',cashSessionId:'exact',date:'2026-09-03',openingAmount:0}};
assert.equal((await sandbox.commit(state,'cash_opened',()=>false,{sparkCommand:()=>command})).pending,true);
assert.equal(request.command,command);assert.equal(saved,0);assert.equal(synced,0);assert.equal(released,1);
sandbox.window.click360SparkOperationalSession.commit=async()=>({ok:false,pending:false,notQueued:true,reason:'spark_ui_flow_not_certified'});
await sandbox.commit(state,'customer_created',()=>false,{});
assert.equal(restored,1);assert.equal(saved,0);assert.equal(synced,0);
await sandbox.commit(state,'sale_created',()=>false,{sparkCommand:()=>{throw Error('invalid explicit command');}});
assert.equal(restored,2);assert.equal(released,3);assert.equal(saved,0);
sandbox.currentBusiness=()=>({id:'other-business'});
assert.equal((await sandbox.commit(state,'cash_opened',()=>false,{sparkCommand:command})).reason,'spark_ui_business_context_changed');
assert.equal(restored,3);assert.equal(saved,0);
let renders=0,durable;
sandbox.currentBusiness=()=>({id:'b'});sandbox.location={hash:'#sell'};
sandbox.renderApp=route=>{assert.equal(route,'sell');renders++;};
sandbox.window.click360DebugCriticalActionGate=()=>({size:1});
sandbox.window.click360PersistSparkCandidate=async next=>{durable=next;};
sandbox.window.click360SparkOperationalSession.identity.tenantKey='owner:a:business:b';
sandbox.state.products=[{id:'p',businessId:'b',stock:2},{id:'other',businessId:'second',stock:9}];
const projectionFunction=source.match(/window\.click360ProjectSparkOperation = async function[\s\S]*?\n  };/)?.[0];
assert(projectionFunction);vm.runInContext(projectionFunction,sandbox);
const projection={source:'server',operationId:'op',identity:{tenantKey:'owner:a:business:b',businessId:'b'},records:{products:[{id:'p',businessId:'b',stock:1}]}};
await sandbox.window.click360ProjectSparkOperation(projection);
assert.equal(renders,0,'Projection cannot detach live checkout controls');
assert.equal(durable.products[0].stock,1);assert.equal(durable.products[1].stock,9);
sandbox.window.click360DebugCriticalActionGate=()=>({size:0});
await sandbox.window.click360ProjectSparkOperation(projection);assert.equal(renders,1,'Restart replay refreshes the actual route');
console.log(JSON.stringify({status:'PASS',actualPWACommit:true,noLegacyFallback:true,invalidCommandPreservesPrevious:true,
  productionActivationDenied:true,mixedBuildDenied:true,productionWrites:0}));
