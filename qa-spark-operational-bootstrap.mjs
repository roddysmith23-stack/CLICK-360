import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('./spark-operational-bootstrap.js',import.meta.url),'utf8');
// Execute the actual worker approval gate, including a late response from the
// preceding actor. Never inherit an old approval or leave the requested route.
{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const start=app.indexOf('let workerAccessGateChecked = false;'),end=app.indexOf('function requiresWorkerAccessGate()',start);
  const renders=[];let release;
  const scope=vm.createContext({activeTenantContext:{authUid:'worker-a'},route:'workerAccessGate',
    window:{click360GetWorkerAccessRequestStatus:()=>new Promise(resolve=>release=resolve)},renderApp:r=>renders.push(r)});
  vm.runInContext(app.slice(start,end)+';globalThis.gate={check:ensureWorkerAccessGateChecked,reset:resetWorkerAccessGate,route:r=>workerAccessRequestedRoute=r,status:()=>workerAccessGateStatus};',scope);
  const old=scope.gate.check();scope.gate.reset();scope.activeTenantContext={authUid:'worker-b'};
  release({status:'approved'});await old;assert.equal(scope.gate.status(),null);assert.equal(renders.length,0);
  scope.window.click360GetWorkerAccessRequestStatus=async()=>({status:'approved'});
  scope.gate.route('inventory');await scope.gate.check();assert.equal(renders.at(-1),'inventory');
  scope.gate.reset();assert.equal(scope.gate.status(),null,'User changes cannot inherit a preceding approval');
}
// A closed day is deliberately "not started" in the domain. The actual cash
// renderer must check the closed state before offering a new initial opening.
{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const start=app.indexOf('function cashView()'),end=app.indexOf('function labelKind(',start);
  for(const modular of [false,true])for(const closed of [false,true]){
    const scope=vm.createContext({window:{click360SparkOperationalSession:modular?{}:null},tenantDataHydrated:true,
      state:{dailyReports:[]},currentBusiness:()=>({id:'business'}),currentOpenCashSession:()=>null,
      latestCashSession:()=>closed?{id:'exact-closed-session',status:'closed'}:null,
      movementsForBiz:()=>[],today:()=> '2026-09-03',isCashIncomeMovement:()=>false,staleOpenCashSession:()=>null,
      isDayStarted:()=>false,isDayClosed:()=>closed,escapeHtml:String,icon:()=>'',fmt:String,sparkHistoryPageControl:()=>''});
    vm.runInContext(app.slice(start,end),scope);const html=scope.cashView();
    assert.equal(html.includes('id="reopenCashBtn"'),closed,'Confirmed closed state must expose the existing successor action');
    assert.equal(html.includes('id="startDayBtnCash"'),!closed,'A closed day cannot be mislabeled as never opened');
  }
}
// Run the actual PWA configuration installer. Numeric paths describe array
// indexes; the container type is determined by the NEXT path component.
{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const start=app.indexOf('window.click360InstallSparkBusiness=async function(');
  const end=app.indexOf('window.click360InstallSparkView=',start);
  assert(start>0&&end>start);
  const scope=vm.createContext({window:{},state:{legalAcceptances:[],settings:{}},activeTenantContext:{authUid:'owner'},
    cloneState:structuredClone,normalizeState:x=>x,tenantIdentity:()=>({ownerUid:'owner'}),tenantDataHydrated:false,tenantStateDeferred:true,
    queueIndexedSnapshot:async()=>true,indexedTenantCacheMeta:null,uid:()=> 'selection',rememberPersistedState(){},lastAutoSaveHash:'',workingDate:null});
  vm.runInContext(app.slice(start,end),scope);
  await scope.window.click360InstallSparkBusiness({businessId:'business',configuration:{businesses:[{id:'business'}],entries:[
    {sourcePath:['legalAcceptances',0,'id'],data:'legal-qa'},
    {sourcePath:['legalAcceptances',0,'uid'],data:'owner'},
    {sourcePath:['settings','workers',0,'name'],data:'Trabajador'},
    {sourcePath:['settings','onboarding','completedAt'],data:'2026-10-12'}]}});
  assert.equal(JSON.parse(JSON.stringify(scope.state)).legalAcceptances[0].id,'legal-qa');
  assert.equal(JSON.parse(JSON.stringify(scope.state)).settings.workers[0].name,'Trabajador');
}
function fixture({mode='modular',local=null,pending=0,unknown=0,replayStatus='CONFIRMED',cache=false,paging=false,moduleNames=['products','sales']}={}){
  const events=new Map(),phases=[],writes=[],observed={restored:0,installed:0,created:0,replayed:0,closed:0};
  let actor='owner',business='business',projections=0,releaseRead=null,queryBarrier=null,moduleBarrier=null,busy=false;
  const root={navigator:{onLine:true,locks:{request:async(_name,_options,callback)=>callback({name:'fixture-lock'})}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
    CLICK360_SPARK_MIGRATION:{arrays:Object.fromEntries(moduleNames.map(name=>[name,name])),hash:async()=>''},
    CLICK360_SPARK_RECORD_CODEC:{unpack:async record=>record},
    CLICK360_MODULAR_PERSISTENCE:{identity:(ownerUid,businessId)=>({ownerUid,businessId})},
    firebase:{firestore:{FieldValue:{serverTimestamp(){throw Error('Bootstrap must not issue writes');}}}}};
  const snap=data=>({exists:!!data,data:()=>data,metadata:{fromCache:cache,hasPendingWrites:false}});
  const control={ownerUid:'owner',schemaVersion:2,storageMode:mode,phase:'MODULAR',semanticEquality:'PASS',
    sourceHash:'source',reconstructedHash:'source',businessIds:['business']};
  const db={app:{options:{projectId:'demo-click360-spark-modular'}},
    doc:path=>({get:async options=>{
      assert.equal(options.source,'server');if(releaseRead)await releaseRead;
      return snap(path.endsWith('/metadata/storage')?control:{id:'business'});
    }}),collection:path=>{
      let after=null;
      const q={orderBy:()=>q,limit:()=>q,startAfter:value=>{after=value;return q;},where:()=>q,
        get:async options=>{
          assert.equal(options.source,'server');if(queryBarrier)await queryBarrier;
          const operational=path.includes('/storage/v2/');
          if(operational){observed.activeModuleReads=(observed.activeModuleReads||0)+1;
            observed.maxModuleReads=Math.max(observed.maxModuleReads||0,observed.activeModuleReads);
            if(moduleBarrier)await moduleBarrier;}
          const docs=paging&&path.endsWith('/sales')?Array.from({length:after?2:100},(_,i)=>({id:`sale-${after?100+i:i}`,data:()=>({id:`sale-${after?100+i:i}`})})):[];
          if(operational)observed.activeModuleReads--;
          return {docs,size:docs.length,metadata:{fromCache:cache,hasPendingWrites:false}};
        }};
      return q;
    }};
  root.CLICK360_SPARK_OPERATIONAL_UI={create:async()=>{
    observed.created++;
    return {identity:{businessId:business},currentCash:async()=>({source:'server',identity:{ownerUid:'owner',businessId:business},session:null}),
      close:()=>observed.closed++,isBusy:()=>busy,
      health:async()=>({pendingCount:pending,unknownCount:unknown,projectionPendingCount:projections}),
      replay:async()=>{
        observed.replayed++;
        if(replayStatus!=='CONFIRMED')return [{status:replayStatus,reason:'authoritative_unknown'}];
        if(pending+unknown){pending=0;unknown=0;projections=1;return [{status:'CONFIRMED'}];}
        projections=0;return [{status:'CONFIRMED'}];
      }};
  }};
  const context=vm.createContext({window:root,structuredClone,console});vm.runInContext(source,context);
  const coordinator=root.CLICK360_SPARK_BOOTSTRAP.create({projectId:db.app.options.projectId,db,ownerUid:'owner',actorUid:'owner',deviceId:'device',
    resolveUser:()=>({uid:actor}),resolveContext:()=>({authUid:actor,ownerUid:'owner'}),resolveBusiness:()=>business,
    restoreLocal:async()=>{observed.restored++;},readLocal:async()=>local,
    installBusiness:async value=>{business=value.businessId;},installView:async()=>{observed.installed++;},
    onPhase:detail=>phases.push(detail)});
  root.click360SparkCoordinator=coordinator;
  return {coordinator,observed,phases,writes,events,changeActor:value=>actor=value,
    blockReads:promise=>releaseRead=promise,blockQueries:promise=>queryBarrier=promise,
    blockModuleReads:promise=>moduleBarrier=promise,setBusy:value=>busy=value};
}
{
  const f=fixture();let release;f.blockModuleReads(new Promise(resolve=>release=resolve));
  const flight=f.coordinator.recover();
  // A deterministic barrier, not a timeout increase or latency-based sleep.
  for(let turn=0;turn<20&&f.observed.activeModuleReads!==2;turn++)await new Promise(resolve=>setImmediate(resolve));
  const started=f.observed.activeModuleReads;release();await flight;
  assert.equal(started,2,'Independent server views must not serialize all network round trips');
  assert(f.observed.maxModuleReads<=3,'Keep Firestore request concurrency bounded');
  assert.equal(f.phases.at(-1).phase,'READY');f.coordinator.close();
}
{
  const f=fixture({moduleNames:['products','sales','movements','cashSessions','dailyReports']});
  let release;f.blockModuleReads(new Promise(resolve=>release=resolve));const flight=f.coordinator.recover();
  for(let turn=0;turn<20&&f.observed.activeModuleReads!==3;turn++)await new Promise(resolve=>setImmediate(resolve));
  const started=f.observed.activeModuleReads;f.changeActor('another-user');release();
  await assert.rejects(flight,/CONTEXT_CHANGED/);
  assert.equal(started,3);assert.equal(f.observed.maxModuleReads,3);
  assert.equal(f.observed.installed,0,'Parallel reads cannot publish a preceding user view');f.coordinator.close();
}
{
  const f=fixture({paging:true});await f.coordinator.recover();assert.equal(f.coordinator.hasMore('sales'),true);
  f.setBusy(true);await assert.rejects(f.coordinator.loadMore('sales'),/RECOVERY_BUSY/);f.setBusy(false);
  let release;f.blockQueries(new Promise(resolve=>release=resolve));
  const page=f.coordinator.loadMore('sales');assert.equal(f.coordinator.isBusy(),true);
  await assert.rejects(f.coordinator.loadMore('sales'),/RECOVERY_BUSY/);
  assert.equal(f.phases.at(-1).phase,'LOADING_HISTORY');release();await page;
  assert.equal(f.coordinator.hasMore('sales'),false);assert.equal(f.coordinator.phase(),'READY');f.coordinator.close();
}
{
  const f=fixture();assert.equal((await f.coordinator.recover()).handled,true);
  assert.equal(f.observed.installed,1);assert.equal(f.phases.at(-1).phase,'READY');
  f.coordinator.close();assert.equal(f.events.size,0);assert.equal(f.observed.closed,1);
}
for(const count of [99,100,101,250,1000]){
  const f=fixture({pending:count});await f.coordinator.recover();
  assert.equal(f.observed.replayed,2,'Complete financial drain then durable projection');
  assert.equal(f.phases.at(-1).phase,'READY');f.coordinator.close();
}
for(const options of [{unknown:101,replayStatus:'UNKNOWN'},
  {local:{cloudCapacityBlocked:true,source:'indexeddb_cache'}},
  {local:{cloudCapacityBlocked:false,pendingRemoteSync:false,source:'cloud_confirmed',hasDirtyFields:true}},
  {mode:'migrating'},{mode:'frozen'},{cache:true}]){
  const f=fixture(options);await assert.rejects(f.coordinator.recover());
  assert.equal(f.observed.installed,0,'No replacement of protected local data on failed preconditions');
  assert.equal(f.phases.at(-1).phase,'BLOCKED');f.coordinator.close();
}
{
  const f=fixture({mode:'legacy'});assert.equal((await f.coordinator.recover()).handled,false);
  assert.equal(f.observed.created,0);assert.equal(f.observed.installed,0);f.coordinator.close();
}
{
  const f=fixture();let release;f.blockReads(new Promise(resolve=>release=resolve));
  const first=f.coordinator.recover(),second=f.coordinator.recover();assert.equal(first,second,'One active bootstrap flight');
  release();await first;assert.equal(f.observed.created,1);
  f.changeActor('different-user');assert.throws(()=>f.coordinator.recover(),/CONTEXT_CHANGED/);
  f.coordinator.close();
}
console.log(JSON.stringify({status:'PASS',automaticBootstrap:true,fullDrainCounts:[99,100,101,250,1000],
  cacheNotAuthoritative:true,unknownAndLegacyPendingPreserved:true,actorIsolation:true,singleFlight:true,
  productionActivation:false,productionWrites:0}));
