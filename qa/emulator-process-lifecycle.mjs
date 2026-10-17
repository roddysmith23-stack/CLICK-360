import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

// QA resource ownership only. Never finds/kills another process by port.
export async function assertPortsAvailable(ports){
  for(const port of new Set(ports)){
    if(!Number.isInteger(port)||port<1||port>65535)throw Error('QA_INVALID_LISTENER_PORT');
    await new Promise((resolve,reject)=>{
      const server=net.createServer();
      server.once('error',error=>reject(Object.assign(Error(`QA_LISTENER_UNAVAILABLE:${port}:${error.code}`),{cause:error,port})));
      server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(resolve));
    });
  }
}

export async function waitForOwnedServices(children,targets,{timeoutMs=90000,readLog=()=>''}={}){
  const controller=new AbortController(),listeners=[];
  const deadline=setTimeout(()=>controller.abort(Error('QA_SERVICES_STARTUP_TIMEOUT')),timeoutMs);
  for(const child of children){
    const exited=(code,signal)=>controller.abort(Error(`QA_OWNED_SERVICE_EXIT:${code}:${signal||''}\n${readLog()}`));
    const failed=error=>controller.abort(error);
    child.once('exit',exited);child.once('error',failed);listeners.push([child,exited,failed]);
    if(child.exitCode!==null||child.signalCode!==null)exited(child.exitCode,child.signalCode);
  }
  try{
    await Promise.all(targets.map(async target=>{
      while(!controller.signal.aborted){
        try{const response=await fetch(target,{signal:controller.signal});await response.body?.cancel();if(response.ok)return;}
        catch(error){if(controller.signal.aborted)throw controller.signal.reason;}
        await delay(500,null,{signal:controller.signal});
      }
      throw controller.signal.reason;
    }));
  }catch(error){controller.abort(error);throw controller.signal.reason;}
  finally{
    clearTimeout(deadline);controller.abort();
    for(const [child,exited,failed]of listeners){child.removeListener('exit',exited);child.removeListener('error',failed);}
  }
}

export async function stopOwnedProcessTree(child,{graceMs=5000}={}){
  if(!child?.pid)return;
  const groupAlive=()=>{try{process.kill(-child.pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
  const signal=value=>{try{process.kill(-child.pid,value);}catch(error){if(error.code!=='ESRCH')throw error;}};
  signal('SIGTERM');
  const until=Date.now()+graceMs;
  // Await resource release, not an arbitrary pause. Includes Java descendants
  // after the CLI exits; process exit alone does not prove ports are released.
  while(groupAlive()&&Date.now()<until)await delay(20);
  if(groupAlive()){
    signal('SIGKILL');
    const killedUntil=Date.now()+1000;
    while(groupAlive()&&Date.now()<killedUntil)await delay(20);
    if(groupAlive())throw Error('QA_OWNED_PROCESS_GROUP_DID_NOT_EXIT');
  }
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('close',resolve));
}
