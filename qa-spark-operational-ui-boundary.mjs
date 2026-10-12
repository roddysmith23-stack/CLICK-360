import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
import {createEmulatorIsolation} from './qa/emulator-network-isolation.mjs';
import './spark-operational-ui-runtime.js';
import './modular-ui-adapter.js';
const runtime=globalThis.CLICK360_SPARK_OPERATIONAL_UI;
for(const file of ['qa/r38-commerce-core-e2e.mjs','qa/r38-restaurant-authoritative-e2e.mjs']){
  assert.match(await readFile(file,'utf8'),/http-server\x27\),\x27dist\x27/,'SW-controlled commerce must serve the stamped build, not unbuilt source');
}
assert.match(JSON.parse(await readFile('package.json','utf8')).scripts['qa:r38:e2e'],/npm run build:static && node qa\/r38-commerce-core-e2e/);
await assert.rejects(()=>runtime.create({projectId:'click-360',syntheticCertification:true}),/CERTIFICATION_ONLY/);
await assert.rejects(()=>runtime.create({projectId:'click360-staging-7620168025'}),/CERTIFICATION_ONLY/);
await assert.rejects(()=>runtime.create({projectId:'click360-staging-7620168025',syntheticCertification:true}),/MIXED_RELEASE/);
const product={id:'p',businessId:'b',stock:2,qty:2,name:'Perfume',price:30},identity={ownerUid:'a',businessId:'b'};
const adapt=input=>globalThis.CLICK360_MODULAR_UI_ADAPTER.productMutationCommand({identity,operationId:'stable-product',date:'2026-09-03',...input});
assert.equal(adapt({product}).kind,'product_create');
assert.equal(adapt({product:{...product,name:'Nuevo'},previous:product}).kind,'product_edit');
assert.equal(adapt({product:{...product,stock:3,qty:3},previous:product}).input.quantityDelta,1);
const compound=adapt({product:{...product,stock:3,qty:3,name:'Nuevo'},previous:product});
assert.equal(compound.kind,'inventory_adjust');assert.equal(compound.input.quantityDelta,1);assert.equal(compound.input.changes.name,'Nuevo');
assert.throws(()=>adapt({product:{...product,businessId:'other'}}),/CONTEXT/);
const report={id:'report-exact-1',businessId:'b',cashSessionId:'exact',status:'closed',openingAmount:0,
  declaredCash:5,theoreticalCash:5,difference:0,saleCount:3,total:54,totalItems:3,totalIva:0,incomeCash:5,expenseCash:0,
  paymentTotals:{cash:0,card:0,transfer:32,receivablePayments:2}};
const reportView=globalThis.CLICK360_MODULAR_UI_ADAPTER.cashReportView(report);
assert.equal(reportView.productQuantity,3);assert.equal(reportView.income,5);
assert.equal(reportView.paymentTotals.transfer,32);assert.equal(reportView.paymentTotals.receivableIncluded,true);
assert.throws(()=>globalThis.CLICK360_MODULAR_UI_ADAPTER.cashReportView({...report,totalItems:undefined}),/AUTHORITATIVE_SUMMARY/);
assert.equal(report.paymentTotals.layawayPayments,undefined,'Derived print view cannot mutate server report');
const helper=await readFile('qa/r38-emulator-support.mjs','utf8');
const firebaseSource=await readFile('firebase-service.js','utf8');
const transportStart=firebaseSource.indexOf('const db = firebase.firestore();');
const transportEnd=firebaseSource.indexOf('window.click360Auth = auth;',transportStart);
assert(transportStart>0&&transportEnd>transportStart);
const calls=[],transportContext={window:{},console,
  firebase:{firestore:()=>({settings:options=>{assert.equal(options.merge,true,'Preserve the configured host/SSL/emulator scope');assert.equal(options.experimentalForceLongPolling,true);assert.equal(options.experimentalAutoDetectLongPolling,false);calls.push('settings');},
    enablePersistence:options=>{assert.equal(options.synchronizeTabs,true);calls.push('persistence');return Promise.resolve();}})}};
vm.createContext(transportContext);vm.runInContext(firebaseSource.slice(transportStart,transportEnd),transportContext);
assert.deepEqual(calls,['settings','persistence'],'Configure transport before opening durable SDK persistence');
assert.equal(transportContext.window.click360FirestoreTransport,'long_polling');
const workerHandlers={},workerContext={URL,location:{origin:'http://127.0.0.1:4798'},
  self:{addEventListener:(name,fn)=>{workerHandlers[name]=fn;}},
  caches:{open:()=>{throw Error('Authenticated traffic must never touch SW cache');}},
  fetch:()=>{throw Error('Streaming network must not be rewrapped by the SW');}};
vm.createContext(workerContext);vm.runInContext(await readFile('service-worker.js','utf8'),workerContext);
for(const url of ['http://127.0.0.1:48098/google.firestore.v1.Firestore/Listen/channel','https://firestore.googleapis.com/v1/projects/synthetic',
  'http://127.0.0.1:49108/identitytoolkit.googleapis.com/v1/accounts:lookup']) {
  workerHandlers.fetch({request:{method:'GET',url},respondWith:()=>{throw Error('Cross-origin response buffering');}});
}
assert(!helper.includes('page.route('+'externalRequestPattern()'),'No browser interception of emulator streams');
let upstreamResponse,hits=0;
const upstream=http.createServer((request,response)=>{hits++;upstreamResponse=response;response.writeHead(200);response.write('first');});
await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
const allowedOrigin=`http://127.0.0.1:${upstream.address().port}`;
const isolation=await createEmulatorIsolation([allowedOrigin]);
try {
  const proxy=new URL(isolation.server);
  const received=await new Promise((resolve,reject)=>{
    const request=http.request({hostname:proxy.hostname,port:proxy.port,path:`${allowedOrigin}/Listen/channel`},response=>{
      let body='';response.on('data',chunk=>{body+=chunk;if(body==='first')upstreamResponse.end('last');});
      response.on('end',()=>resolve(body));response.on('error',reject);
    });request.on('error',reject);request.end();
  });
  assert.equal(received,'firstlast','First WebChannel bytes arrive before upstream finishes');
  for(const target of ['https://firestore.googleapis.com/v1/projects/click-360',`${allowedOrigin}.evil.test/`,
    allowedOrigin.replace('127.0.0.1','user@127.0.0.1')+'/']) {
    const status=await new Promise((resolve,reject)=>{
      const request=http.request({hostname:proxy.hostname,port:proxy.port,path:target},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
      request.on('error',reject);request.end();
    });assert([400,403].includes(status),'External/credential-bearing targets denied before upstream');
  }
  assert.equal(hits,1,'Blocked requests never contact upstream');
} finally {await isolation.close();await new Promise(resolve=>upstream.close(resolve));}
// Disposing a browser proxy must also dispose its idle upstream connection.
// An owned lifecycle prevents a prior device from retaining emulator handles.
{
  let peerClosed;
  const closed=new Promise(resolve=>{peerClosed=resolve;});
  const peer=http.createServer((_request,response)=>response.end('done'));
  peer.on('connection',socket=>socket.once('close',peerClosed));
  await new Promise(resolve=>peer.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${peer.address().port}`,isolated=await createEmulatorIsolation([origin]),proxy=new URL(isolated.server);
  let deadline;
  try{
    await new Promise((resolve,reject)=>{const request=http.request({hostname:proxy.hostname,port:proxy.port,path:origin+'/idle'},response=>{
      response.resume();response.on('end',resolve);response.on('error',reject);
    });request.on('error',reject);request.end();});
    await isolated.close();
    await Promise.race([closed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('PROXY_IDLE_UPSTREAM_NOT_DISPOSED')),2000);})]);
    await isolated.close(); // Disposal must be idempotent.
  }finally{clearTimeout(deadline);await isolated.close();await new Promise(resolve=>peer.close(resolve));}
}
// Extract the real PWA commit entry point: Spark never falls through to save,
// legacy sync or legacy refresh, including an unsupported command and failure.
const source=await readFile('app.js','utf8');
// An unsupported generic save must not contaminate the next typed candidate.
// Restore only the latest DEVICE-durable state, including its pending delta;
// never the older remote stock. This executes the actual save branch.
const saveStart=source.indexOf('  function save(options = {})'),saveEnd=source.indexOf('    if (!activeTenantContext || !stateStorageKey())',saveStart);
const restoreStart=source.indexOf('  function cloneState(value)'),restoreEnd=source.indexOf('  function cacheMetaKey',restoreStart);
assert(saveStart>0&&saveEnd>saveStart&&restoreStart>0&&restoreEnd>restoreStart);
const pendingDevice={products:[{id:'pending-stock',stock:5}],pendingOperationIds:['protected-offline-sale'],settings:{name:'Durable'}};
const genericSave={window:{click360SparkOperationalSession:{}},lastPersistedState:structuredClone(pendingDevice),
  state:{products:[{id:'pending-stock',stock:0}],settings:{name:'Unsupported unsaved change'}},publishSaveFailure:()=>{}};
vm.createContext(genericSave);
vm.runInContext(`${source.slice(restoreStart,restoreEnd)}${source.slice(saveStart,saveEnd)}throw Error('LEGACY_SAVE_FALLTHROUGH');}
  globalThis.save=save;`,genericSave);
assert.equal(genericSave.save(),false);
assert.equal(JSON.stringify(genericSave.state),JSON.stringify(pendingDevice),'Rejected save preserves the latest pending durable device state');
// Execute the actual PWA's session-revocation paths, not a stand-alone helper.
// Logout/actor changes close the old connection without deleting device data.
const clearStart=source.indexOf('  window.click360ClearTenantContext = function()'),clearEnd=source.indexOf('  window.click360IsTenantStateDeferred',clearStart);
assert(clearStart>0&&clearEnd>clearStart);
const lifecycle={window:{click360SparkOperationalSession:{close:()=>{lifecycle.closed++;}},CLICK360_RUNTIME_GUARD:{clearContext:()=>{}}},closed:0,
  stopScanner:()=>{},seed:()=>({}),publishStorageState:()=>{},resolveCriticalActionGate:()=>({clear:()=>{}}),app:null,
  onlineOnlyCommitCheckpoints:new Map(),activeTenantContext:{tenantKey:'owner:alpha',authUid:'worker-a'}};
vm.createContext(lifecycle);
vm.runInContext(`let activeSellDraft,onboardingPrompted,state,tenantDataHydrated,tenantStateProvenance,lastPersistedState,
  indexedTenantCacheMeta,lastSavePersistence,lastAutoSaveHash,session,route,workingDate,tenantStateDeferred;
  ${source.slice(clearStart,clearEnd)}`,lifecycle);
lifecycle.window.click360ClearTenantContext();
assert.equal(lifecycle.closed,1);
assert.equal(lifecycle.window.click360SparkOperationalSession,null,'Logout revokes the old modular writer');
assert.equal(lifecycle.activeTenantContext,null);
assert(!source.slice(clearStart,clearEnd).includes('deleteDatabase'),'Session revocation preserves IndexedDB and journal');
const setStart=source.indexOf('  window.click360SetTenantContext = function('),setCut=source.indexOf('    if (activeTenantContext?.tenantKey !== context.tenantKey) activeSellDraft',setStart);
assert(setStart>0&&setCut>setStart);
vm.runInContext(`${source.slice(setStart,setCut)}return true;};`,lifecycle);
const contextA={authUid:'worker-a',ownerId:'owner',businessId:'alpha',tenantKey:'owner:alpha'};
for(const context of [contextA,{...contextA,authUid:'worker-b'},{...contextA,tenantKey:'owner:beta',businessId:'beta'}]){
  lifecycle.activeTenantContext=contextA;
  lifecycle.window.click360SparkOperationalSession={close:()=>{lifecycle.closed++;}};
  const before=lifecycle.closed;
  lifecycle.window.click360SetTenantContext(context);
  assert.equal(lifecycle.closed-before,context===contextA?0:1,'Revoke only a changed actor/tenant context');
}
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
sandbox.state.settings={customers:[{id:'customer-other',businessId:'second',name:'Other business'}]};
await sandbox.window.click360ProjectSparkOperation({...projection,records:{customers:[{id:'customer-current',businessId:'b',name:'Synthetic',phone:'',notes:'',recordVersion:1}]}});
assert.equal(durable.settings.customers.length,2,'Customer projection stays in the existing UI settings location');
assert.equal(durable.settings.customers[0].name,'Other business','Projection preserves the other business');
// Exact preflight recovers the immutable pending close, not a replacement
// command and not an unrelated outbox entry. This also covers a closed local
// candidate while the server is still open (lost request/response).
const runtimeSource=await readFile('spark-operational-ui-runtime.js','utf8');
const verifyStart=runtimeSource.indexOf('    async function verifyCashClose(target)'),verifyEnd=runtimeSource.indexOf('    return Object.freeze',verifyStart);
assert(verifyStart>0&&verifyEnd>verifyStart);
const exactSession={id:'session-exact',date:'2026-09-03',summaryVersion:1,closeCycle:1,status:'open'};
const closeId='report-session-exact-1',closeHash='a'.repeat(64);
const immutableRow={payloadHash:closeHash,payload:{kind:'cash_close',payload:{cashSessionId:exactSession.id,date:exactSession.date,declaredCash:5}}};
let financialCommits=0,closedProjection=0;
const remote=new Map([['cashSessions/session-exact',exactSession]]);
const verifySandbox={assertActive:()=>{},businessId:'b',identity:{businessId:'b'},
  transport:{run:async callback=>callback({get:async(moduleName,id)=>remote.get(`${moduleName}/${id}`)||null})},
  journal:{get:async()=>immutableRow,countPending:async()=>({pendingCount:0,unknownCount:0}),countProjectionPending:async()=>0},
  adapter:{reconcileOperation:async id=>{
    assert.equal(id,closeId);
    if(exactSession.status==='open'){
      financialCommits++;exactSession.status='closed';exactSession.reportId=closeId;
      remote.set(`dailyReports/${closeId}`,{cashSessionId:exactSession.id,status:'closed',operationId:closeId});
      remote.set(`operationLedger/${closeId}`,{kind:'cash_close',status:'committed',payloadHash:closeHash,result:{cashSessionId:exactSession.id,reportId:closeId}});
    }
    return {status:'CONFIRMED'};
  }},repository:{readOperationProjection:async()=>({source:'server'}),ensureDerivedAudit:async()=>{}},projectConfirmed:async()=>{closedProjection++;}};
vm.createContext(verifySandbox);vm.runInContext(`${runtimeSource.slice(verifyStart,verifyEnd)};globalThis.verify=verifyCashClose`,verifySandbox);
const exactTarget={businessId:'b',cashSessionId:exactSession.id,date:exactSession.date};
assert.equal((await verifySandbox.verify(exactTarget)).closed,true);assert.equal(financialCommits,1);
assert.equal((await verifySandbox.verify(exactTarget)).closed,true);assert.equal(financialCommits,1,'Confirmed close cannot be repeated');
verifySandbox.journal.get=async()=>null;
await verifySandbox.verify(exactTarget);assert.equal(closedProjection,1,'Other-device confirmed close is projected durably');
verifySandbox.journal.countPending=async()=>({pendingCount:1,unknownCount:0});
await assert.rejects(()=>verifySandbox.verify(exactTarget),/PENDING_OVERLAY_REQUIRED/);
assert.equal(closedProjection,1,'Server read cannot overwrite a different pending local operation');
const unknownDialog=source.slice(source.indexOf('  function showCashCloseUnknown('),source.indexOf('  let cashCloseSessionOverride'));
assert(unknownDialog.includes('click360SparkOperationalSession?.verifyCashClose'),'Unknown modal must not fall back to legacy cloud for a modular session');
console.log(JSON.stringify({status:'PASS',actualPWACommit:true,noLegacyFallback:true,invalidCommandPreservesPrevious:true,
  writerRevokedOnActorOrTenantChange:true,logoutPreservesJournal:true,
  productionActivationDenied:true,mixedBuildDenied:true,productionWrites:0}));
