import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile('firebase-service.js','utf8'),a=source.indexOf('  let P0A_RECOVERY_RUN'),z=source.indexOf('\t  async function enterApprovedApp',a);
assert(a>0&&z>a);
let finishFirst,firstReached;const reached=new Promise(r=>firstReached=r),blocked=new Promise(r=>finishFirst=r);
const user={uid:'owner'},identity={authUid:'owner',ownerUid:'owner',ownerId:'owner'};
const runs=[],context={...identity};
const sandbox={AUTH_EPOCH:1,ACTIVE_CONTEXT:context,AUTH_APPROVED:false,auth:{currentUser:user},
  db:{app:{options:{projectId:'click-360'}},doc:()=>({get:async()=>({metadata:{fromCache:false,hasPendingWrites:false},
    data:()=>({enabled:true,automaticRecoveryCopy:true,automaticShadow:false,pilotOwnerUids:['owner']})})})},
  firebase:{},getDeviceId:()=> 'device',navigator:{locks:{request:async(name,options,fn)=>fn({name})}},
  isCurrentAuthEpoch:(u,e)=>u.uid===user.uid&&e===sandbox.AUTH_EPOCH,activeIdentityIsValid:()=>true,
  window:{addEventListener:()=>{},click360User:{ownerId:'owner'},CLICK360_RELEASE_ASSETS:{'app.js':'a'.repeat(12)},
    click360PrepareTenantStorage:async()=>{},CLICK360_V16_STORAGE:{getSnapshot:async()=>({snapshot:{kept:true},deviceRevision:'43'})},
    CLICK360_P0A_BOOTSTRAP:{create:options=>({prepare:async()=>{
      runs.push(sandbox.AUTH_EPOCH);if(runs.length===1){firstReached();await blocked;}
      if(options.resolveContext())options.onProgress({phase:'RECOVERY_COPY_CLIENT_VERIFIED',status:'RECOVERY_COPY_CLIENT_VERIFIED'});
    }})}}
};
vm.createContext(sandbox);vm.runInContext(source.slice(a,z),sandbox);
const first=sandbox.runP0ARecovery(user,1);await reached;
sandbox.AUTH_EPOCH=2;sandbox.ACTIVE_CONTEXT={...identity};
sandbox.window.click360SparkRecoveryCopy=null;sandbox.window.click360SparkMigrationState=null;
const next=sandbox.runP0ARecovery(user,2);finishFirst();await Promise.all([first,next]);
assert.deepEqual(runs,[1,2],'A new authenticated epoch must not inherit an obsolete recovery run');
assert.equal(sandbox.window.click360SparkRecoveryCopy?.status,'RECOVERY_COPY_CLIENT_VERIFIED');
console.log('PASS same-owner Auth redelivery while recovery awaits: current epoch resumes once, no inherited stale run');

const bootStart=source.lastIndexOf("  if (document.readyState === 'loading')"),bootEnd=source.lastIndexOf('})();');
assert(bootStart>0&&bootEnd>bootStart,'Production startup must use the parser readiness barrier');
for(const readyState of ['loading','interactive','complete']){
  let calls=0,ready;
  const parser={document:{readyState,addEventListener:(event,listener,options)=>{
    assert.equal(event,'DOMContentLoaded');assert.equal(options.once,true);ready=listener;
  }},boot:()=>calls++};
  vm.runInNewContext(source.slice(bootStart,bootEnd),parser);
  assert.equal(calls,readyState==='loading'?0:1);
  if(readyState==='loading'){assert.equal(typeof ready,'function');ready();assert.equal(calls,1);}
}
console.log('PASS production startup waits for the real UI parser boundary; no timer, polling or early Auth identity activation');
