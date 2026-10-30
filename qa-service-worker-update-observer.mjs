import assert from 'node:assert/strict';
import vm from 'node:vm';
import {observeWorkerUpdate} from './qa/service-worker-update-observer.mjs';
async function fixture({alreadyActive=false,rejectInstall=false,wrongBuild=false,waiting=false}){
  const container=new EventTarget(),reg=new EventTarget();
  const worker=(build,state)=>Object.assign(new EventTarget(),{state,postMessage(){
    queueMicrotask(()=>{const event=new Event('message');Object.assign(event,{source:this,
      data:{type:'CLICK360_RELEASE_STATUS',buildSha:build}});container.dispatchEvent(event);});
  }});
  const old=worker('old','activated'),next=worker(wrongBuild?'old':'new',alreadyActive?'activated':'installing');
  reg.active=alreadyActive?next:old;reg.installing=alreadyActive?null:next;reg.waiting=null;
  let updates=0;
  // Deliberately NO updatefound event. The worker already exists before
  // update() is called, exactly the boundary the former harness missed.
  reg.update=async()=>{updates++;if(alreadyActive)return;
    next.state=rejectInstall?'redundant':waiting?'installed':'activated';
    if(!rejectInstall){if(waiting)reg.waiting=next;else reg.active=next;}
    reg.installing=null;next.dispatchEvent(new Event('statechange'));
  };
  container.getRegistration=async()=>reg;
  const context=vm.createContext({navigator:{serviceWorker:container},setTimeout,clearTimeout,Promise,Error,JSON});
  const run=mode=>vm.runInContext(`(${observeWorkerUpdate.toString()})`,context)({expectedBuild:'new',mode,timeoutMs:30});
  return {run,updates:()=>updates,old,next,reg};
}
{
 const f=await fixture({alreadyActive:true});let completionEvent=false;
 f.reg.addEventListener('updatefound',()=>{completionEvent=true;});
 await f.reg.update();
 assert.equal(completionEvent,false,'The previous future-event-only observer cannot complete for an already-active registration');
 assert.equal(f.reg.active.state,'activated');
}
for(const options of [{alreadyActive:true},{}]){
 const f=await fixture(options),r=await f.run('activated');
 assert.equal(r.status,'activated');assert.equal(r.buildSha,'new');assert.equal(f.updates(),1);
}
{
 const f=await fixture({rejectInstall:true}),r=await f.run('rejected');assert.equal(r.status,'rejected');
}
{
 const f=await fixture({waiting:true}),r=await f.run('installed');assert.equal(r.status,'installed');
 assert.notEqual(f.reg.active,f.next,'An installed waiting worker is NOT reported as active');
 await assert.rejects(f.run('activated'),/SW_UPDATE_OBSERVATION_TIMEOUT/);
}
{
 const f=await fixture({alreadyActive:true,wrongBuild:true});
 await assert.rejects(f.run('activated'),/SW_UPDATE_OBSERVATION_TIMEOUT/);
 assert.equal(f.updates(),1,'Wrong build cannot trigger timed retries or a false activation');
}
console.log('PASS SW update observer: existing install, already-active build, rejected install, old build denied, no polling/retry');
