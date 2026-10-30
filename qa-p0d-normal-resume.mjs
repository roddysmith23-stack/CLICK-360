import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile('firebase-service.js','utf8');
const a=source.indexOf('  let P0A_RECOVERY_RUN'),z=source.indexOf('\t  async function enterApprovedApp',a);
assert(a>0&&z>a);
const windowEvents=new Map(),documentEvents=new Map(),runs=[],receipts=[];
const user={uid:'normal-resume-owner'},context={authUid:user.uid,ownerUid:user.uid,ownerId:user.uid};
let release,blocked=false,drift=false;
const snapshot={snapshot:{sales:[{id:'preserved-sale'}]},deviceRevision:'durable-original'};
const scope={AUTH_EPOCH:1,AUTH_APPROVED:true,ACTIVE_CONTEXT:context,auth:{currentUser:user},
  startupStep:(_stage,run)=>run(),
  navigator:{onLine:true,locks:{request:async(name,options,fn)=>fn({name})}},
  CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},
  isCurrentAuthEpoch:(u,e)=>u===scope.auth.currentUser&&e===scope.AUTH_EPOCH,activeIdentityIsValid:()=>true,
  db:{app:{options:{projectId:'click-360'}},doc:()=>({get:async()=>({metadata:{fromCache:false,hasPendingWrites:false},
    data:()=>({enabled:true,automaticRecoveryCopy:true,automaticShadow:false,pilotOwnerUids:[user.uid]})})})},
  firebase:{},getDeviceId:()=> 'original-device',
  window:{addEventListener:(name,fn)=>windowEvents.set(name,fn),dispatchEvent:e=>receipts.push(e),
    document:{visibilityState:'hidden',addEventListener:(name,fn)=>documentEvents.set(name,fn)},
    click360User:{ownerId:user.uid},CLICK360_RELEASE_ASSETS:{'app.js':'a'.repeat(12)},
    click360PrepareTenantStorage:async()=>{},CLICK360_V16_STORAGE:{getSnapshot:async()=>structuredClone(snapshot)},
    CLICK360_P0A_BOOTSTRAP:{create:options=>({prepare:async()=>{
      runs.push({revision:snapshot.deviceRevision});
      if(blocked)await new Promise(r=>release=r);
      options.onProgress({phase:'RECOVERY_COPY_CLIENT_VERIFIED',status:'RECOVERY_COPY_CLIENT_VERIFIED'});
      return {recoveryCopy:{status:'RECOVERY_COPY_CLIENT_VERIFIED',serverReadVerified:true,captureHash:'b'.repeat(64)}};
    }})},
    CLICK360_P0A_JOURNAL:{open:async()=>({captureOwner:async()=>({ownerUid:user.uid,enumerationComplete:true,recordCount:0,rows:[]}),close(){}})},
    CLICK360_SPARK_RECONCILIATION:{createDevicePreflight:()=>({prepare:async()=>({status:drift?'CLIENT_PREFLIGHT_BLOCKED':'CLIENT_PREFLIGHT_READY',cutover:false})})}
  }};
vm.createContext(scope);vm.runInContext(source.slice(a,z),scope);
assert.equal(typeof documentEvents.get('visibilitychange'),'function','Normal foreground return must wake existing recovery/preflight');
assert.equal(typeof windowEvents.get('pageshow'),'function','BFCache restoration must wake existing recovery/preflight');
const settle=async()=>{while(vm.runInContext('P0A_RECOVERY_RUN !== null',scope))await new Promise(r=>setImmediate(r));};
const visible=()=>{scope.window.document.visibilityState='visible';documentEvents.get('visibilitychange')();};
documentEvents.get('visibilitychange')();await settle();assert.equal(runs.length,0,'Hidden page must not wake recovery');
visible();await settle();assert.equal(runs.length,1);assert.equal(scope.window.click360DevicePreflight.status,'CLIENT_PREFLIGHT_READY');
snapshot.snapshot.sales.push({id:'new-local-sale'});snapshot.deviceRevision='durable-new';
blocked=true;visible();windowEvents.get('pageshow')({persisted:true});windowEvents.get('online')();
await new Promise(r=>setImmediate(r));assert.equal(runs.length,2,'Foreground/pageshow/reconnect share the existing single-flight');
blocked=false;release();await settle();assert.equal(runs[1].revision,'durable-new');
windowEvents.get('pageshow')({persisted:false});await settle();assert.equal(runs.length,2,'Initial pageshow belongs to Auth bootstrap');
for(const modify of [()=>scope.AUTH_APPROVED=false,()=>scope.navigator.onLine=false,
  ()=>scope.window.click360User.ownerId='different-owner',()=>scope.window.click360SparkOperationalSession={}]){
  modify();visible();await settle();assert.equal(runs.length,2,'No stale/worker/offline/operational recovery wake');
  scope.AUTH_APPROVED=true;scope.navigator.onLine=true;scope.window.click360User.ownerId=user.uid;scope.window.click360SparkOperationalSession=null;
}
drift=true;visible();await settle();assert.equal(scope.window.click360DevicePreflight.status,'CLIENT_PREFLIGHT_BLOCKED');
assert.equal(scope.window.click360DevicePreflight.cutover,false);assert.equal(snapshot.snapshot.sales.length,2);
assert.equal(scope.AUTH_APPROVED,true,'A blocked noncommercial preflight must not lock the legacy app');
assert.equal(scope.ACTIVE_CONTEXT,context);assert(receipts.some(e=>e.type==='click360-device-preflight'));
console.log('PASS normal foreground/BFCache/reconnect single-flight; latest durable source, owner/auth/offline/operational guards; blocked preflight leaves legacy intact; no commercial writer');
