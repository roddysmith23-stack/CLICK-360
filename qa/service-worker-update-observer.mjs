// Browser-side QA observation only. A registration can already have an
// installing/activated worker when update() joins an existing update job.
// updatefound is not a completion signal and need not fire for that caller.
export async function observeWorkerUpdate({expectedBuild,mode,timeoutMs=30000}){
  const container=navigator.serviceWorker,reg=await container.getRegistration();
  if(!reg)throw Error('SW_UPDATE_REGISTRATION_MISSING');
  if(!['rejected','installed','activated'].includes(mode)||!expectedBuild)throw Error('SW_UPDATE_OBSERVER_ARGUMENTS');
  return new Promise((resolve,reject)=>{
    const observed=new Map(),trace=[];let done=false,timer;
    const initialActive=reg.active;
    const record=(event,worker)=>{
      trace.push({event,state:worker?.state||null});if(trace.length>30)trace.shift();
    };
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(timer);
      reg.removeEventListener('updatefound',inspect);
      container.removeEventListener('controllerchange',inspect);
      container.removeEventListener('message',message);
      for(const [worker,listener]of observed)worker.removeEventListener('statechange',listener);
      if(error)reject(error);else resolve({...result,trace});
    };
    const message=event=>{
      if(event.data?.type!=='CLICK360_RELEASE_STATUS'||event.data.buildSha!==expectedBuild)return;
      if(event.source===reg.active&&reg.active?.state==='activated')
        finish(null,{status:'activated',buildSha:event.data.buildSha});
      else if(mode==='installed'&&event.source===reg.waiting&&reg.waiting?.state==='installed')
        finish(null,{status:'installed',buildSha:event.data.buildSha});
    };
    function watch(worker,candidate){
      if(!worker||observed.has(worker))return;
      const rejectable=candidate&&worker!==initialActive&&worker.state!=='redundant';
      const listener=()=>{
        record('statechange',worker);
        if(rejectable&&worker.state==='redundant'){
          if(mode==='rejected')finish(null,{status:'rejected'});
          else finish(Error('SW_UPDATE_INSTALL_REJECTED:'+JSON.stringify(trace)));
          return;
        }
        inspect();
      };
      observed.set(worker,listener);worker.addEventListener('statechange',listener);
      record('observe',worker);
    }
    function inspect(){
      if(done)return;
      watch(reg.installing,true);watch(reg.waiting,true);watch(reg.active,false);
      // Prove the build of the ACTIVE worker, including activation that
      // completed before observation. A retained old active worker cannot pass.
      if(reg.active?.state==='activated')reg.active.postMessage({type:'CLICK360_RELEASE_STATUS'});
      if(mode==='installed'&&reg.waiting?.state==='installed')reg.waiting.postMessage({type:'CLICK360_RELEASE_STATUS'});
    }
    reg.addEventListener('updatefound',inspect);
    container.addEventListener('controllerchange',inspect);
    container.addEventListener('message',message);
    timer=setTimeout(()=>finish(Error('SW_UPDATE_OBSERVATION_TIMEOUT:'+JSON.stringify({mode,expectedBuild,
      active:reg.active?.state,installing:reg.installing?.state,waiting:reg.waiting?.state,trace}))),timeoutMs);
    inspect();
    Promise.resolve().then(()=>reg.update()).then(inspect,error=>{
      if(mode==='rejected')finish(null,{status:'rejected'});else finish(error);
    });
  });
}
