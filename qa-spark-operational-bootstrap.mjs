import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('./spark-operational-bootstrap.js',import.meta.url),'utf8');
// Run the actual PWA configuration installer. Numeric paths describe array
// indexes; the container type is determined by the NEXT path component.
{
  const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const start=app.indexOf('window.click360InstallSparkBusiness=async function(');
  const end=app.indexOf('window.click360InstallSparkView=',start);
  assert(start>0&&end>start);
  const scope=vm.createContext({window:{},state:{legalAcceptances:[],settings:{}},activeTenantContext:{authUid:'owner'},
    cloneState:structuredClone,normalizeState:x=>x,tenantIdentity:()=>({ownerUid:'owner'}),tenantDataHydrated:false,tenantStateDeferred:true,
    queueIndexedSnapshot:async()=>true,indexedTenantCacheMeta:null,uid:()=> 'selection',rememberPersistedState(){},lastAutoSaveHash:''});
  vm.runInContext(app.slice(start,end),scope);
  await scope.window.click360InstallSparkBusiness({businessId:'business',configuration:{businesses:[{id:'business'}],entries:[
    {sourcePath:['legalAcceptances',0,'id'],data:'legal-qa'},
    {sourcePath:['legalAcceptances',0,'uid'],data:'owner'},
    {sourcePath:['settings','workers',0,'name'],data:'Trabajador'},
    {sourcePath:['settings','onboarding','completedAt'],data:'2026-10-12'}]}});
  assert.equal(JSON.parse(JSON.stringify(scope.state)).legalAcceptances[0].id,'legal-qa');
  assert.equal(JSON.parse(JSON.stringify(scope.state)).settings.workers[0].name,'Trabajador');
}
function fixture({mode='modular',local=null,pending=0,unknown=0,replayStatus='CONFIRMED',cache=false}={}){
  const events=new Map(),phases=[],writes=[],observed={restored:0,installed:0,created:0,replayed:0,closed:0};
  let actor='owner',business='business',projections=0,releaseRead=null;
  const root={navigator:{onLine:true,locks:{request:async(_name,_options,callback)=>callback({name:'fixture-lock'})}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},
    addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),
    CLICK360_SPARK_MIGRATION:{arrays:{products:'products',sales:'sales'},hash:async()=>''},
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
    }}),collection:()=>{
      const q={orderBy:()=>q,limit:()=>q,startAfter:()=>q,where:()=>q,
        get:async options=>{assert.equal(options.source,'server');return {docs:[],size:0,metadata:{fromCache:cache,hasPendingWrites:false}};}};
      return q;
    }};
  root.CLICK360_SPARK_OPERATIONAL_UI={create:async()=>{
    observed.created++;
    return {identity:{businessId:business},currentCash:async()=>({source:'server',identity:{ownerUid:'owner',businessId:business},session:null}),
      close:()=>observed.closed++,isBusy:()=>false,
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
    blockReads:promise=>releaseRead=promise};
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
