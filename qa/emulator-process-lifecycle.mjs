import net from 'node:net';
import {execFileSync} from 'node:child_process';
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
  const controller=new AbortController(),listeners=[],observations=new Map(targets.map(target=>[target,'not_checked']));
  const deadline=setTimeout(()=>controller.abort(Error(`QA_SERVICES_STARTUP_TIMEOUT:${JSON.stringify(Object.fromEntries(observations))}\n${readLog()}`)),timeoutMs);
  for(const child of children){
    const exited=(code,signal)=>controller.abort(Error(`QA_OWNED_SERVICE_EXIT:${code}:${signal||''}\n${readLog()}`));
    const failed=error=>controller.abort(error);
    child.once('exit',exited);child.once('error',failed);listeners.push([child,exited,failed]);
    if(child.exitCode!==null||child.signalCode!==null)exited(child.exitCode,child.signalCode);
  }
  try{
    await Promise.all(targets.map(async target=>{
      while(!controller.signal.aborted){
        try{observations.set(target,'request_pending');const response=await fetch(target,{signal:controller.signal});
          observations.set(target,`HTTP_${response.status}`);await response.body?.cancel();if(response.ok)return;}
        catch(error){if(controller.signal.aborted)throw controller.signal.reason;observations.set(target,error.cause?.code||error.code||error.name);}
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

export function processGroupExists(pid,{kill=process.kill.bind(process),list=()=>execFileSync('ps',['-A','-o','pid=,pgid=,stat='],{encoding:'utf8'})}={}){
  if(!Number.isSafeInteger(pid)||pid<=1)throw Error('QA_INVALID_OWNED_PROCESS_PID');
  // An exited process awaiting reap cannot hold a listener. Darwin may report
  // EPERM rather than ESRCH for its zombie group; prove that with process
  // state, never treat a live permission failure as successful cleanup.
  const members=list().split('\n').map(line=>line.trim().split(/\s+/))
    .filter(parts=>parts.length>=2&&Number(parts[1])===pid);
  if(!members.some(parts=>!parts[2]?.startsWith('Z')))return false;
  try{kill(-pid,0);return true;}
  catch(error){
    if(error.code==='ESRCH')return false;
    if(error.code!=='EPERM')throw error;
    // Darwin can report EPERM for a vanished process group between TERM and
    // waitpid. EPERM itself is NOT proof of exit: independently enumerate
    // PGIDs and keep any extant group blocked, never waive a permission error.
    const remaining=list().split('\n').map(line=>line.trim().split(/\s+/))
      .filter(parts=>parts.length>=2&&Number(parts[1])===pid&&!parts[2]?.startsWith('Z'));
    if(remaining.length)throw error;
    console.log(JSON.stringify({stage:'QA_PROCESS_GROUP_PROBE',code:'EPERM',groupAbsentInProcessTable:true}));
    return false;
  }
}

export async function stopOwnedProcessTree(child,{graceMs=5000}={}){
  if(!child?.pid)return;
  if(!Number.isSafeInteger(child.pid)||child.pid<=1)throw Error('QA_INVALID_OWNED_PROCESS_PID');
  const groupAlive=()=>processGroupExists(child.pid);
  const table=()=>execFileSync('ps',['-A','-o','pid=,ppid=,pgid=,stat='],{encoding:'utf8'}).split('\n')
    .map(line=>line.trim().split(/\s+/)).filter(row=>row.length===4)
    .map(([pid,ppid,pgid,stat])=>({pid:Number(pid),ppid:Number(ppid),pgid:Number(pgid),stat}));
  // Firebase starts Java in its OWN detached group. Record descendants while
  // the CLI still owns them, before TERM can reparent them to init.
  const owned=new Map(),initial=table();let parents=new Set([child.pid]);
  while(parents.size){const next=new Set();for(const row of initial)
    if(parents.has(row.ppid)&&!owned.has(row.pid)){owned.set(row.pid,row);next.add(row.pid);}parents=next;}
  const descendants=()=>table().filter(row=>owned.get(row.pid)?.pgid===row.pgid&&!row.stat.startsWith('Z'));
  const alive=()=>groupAlive()||descendants().length>0;
  const signal=value=>{try{process.kill(-child.pid,value);}catch(error){if(error.code!=='ESRCH')throw error;}};
  signal('SIGTERM');
  const until=Date.now()+graceMs;
  // Await resource release, not an arbitrary pause. Includes Java descendants
  // after the CLI exits; process exit alone does not prove ports are released.
  while(alive()&&Date.now()<until)await delay(20);
  if(alive()){
    if(groupAlive())signal('SIGKILL');
    for(const row of descendants())try{process.kill(row.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    const killedUntil=Date.now()+1000;
    while(alive()&&Date.now()<killedUntil)await delay(20);
    if(alive())throw Error('QA_OWNED_PROCESS_GROUP_DID_NOT_EXIT');
  }
  if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('close',resolve));
}
