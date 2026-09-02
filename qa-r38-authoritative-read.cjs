'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const service=fs.readFileSync(process.env.CLICK360_READ_SERVICE_SOURCE||'firebase-service.js','utf8');
const app=fs.readFileSync(process.env.CLICK360_READ_APP_SOURCE||'app.js','utf8');
const cases=[];
const test=(name,fn)=>cases.push({name,fn});
test('a failed cloud refresh never confirms desired local state',async()=>{
  const start=app.indexOf('async function commitCriticalMutation('),end=app.indexOf('// Action Guardian:',start);
  const context={},previous={expected:false};
  for(const refreshed of [false,true]){
    const sandbox={activeTenantContext:context,state:{expected:true},navigator:{onLine:true},lastSavePersistence:null,
      acquireCriticalAction:()=>({acquired:true,release(){}}),uid:()=> 'synthetic-op',save:()=>true,
      restoreCriticalSnapshot:snapshot=>{sandbox.state=snapshot;},toast(){},
      window:{click360SyncNow:async()=>true,click360RefreshNow:async()=>refreshed}};
    vm.createContext(sandbox);vm.runInContext(app.slice(start,end),sandbox);
    const result=await sandbox.commitCriticalMutation(previous,'synthetic',s=>s.expected===true);
    assert.equal(result.ok,refreshed,'local desired fields are not server proof');
    assert.equal(sandbox.state.expected,true,'a committed-but-unverified candidate must not be rolled back locally');
  }
});
test('stale/cached/pending SDK views use a no-write transaction read',async()=>{
  const start=service.indexOf('async function readAuthoritativeTenantSnapshot('),end=service.indexOf('async function pullRemoteOnce(',start);
  assert(start>=0,'authoritative anti-regression reader required');
  const snapshot=(revision,metadata={fromCache:false,hasPendingWrites:false})=>({exists:true,metadata,data:()=>({revision})});
  for(const [initial,fresh,denied,transactions]of [
    [snapshot(19),snapshot(20),false,1],
    [snapshot(20,{fromCache:true}),snapshot(20),false,1],
    [snapshot(21,{hasPendingWrites:true}),snapshot(22),false,1],
    [snapshot(19),snapshot(18),true,1],
    [snapshot(21),snapshot(22),false,0],
  ]){
    let reads=0;
    const sandbox={LAST_REMOTE_REVISION:20,syncError:(code,message)=>Object.assign(new Error(message),{code}),
      db:{runTransaction:async callback=>{reads++;return callback({get:async()=>fresh,set:()=>assert.fail('reader may not write')});}}};
    vm.createContext(sandbox);vm.runInContext(service.slice(start,end),sandbox);
    const read=sandbox.readAuthoritativeTenantSnapshot({get:async options=>{assert.equal(options.source,'server');return initial;}});
    if(denied)await assert.rejects(read,e=>e.code==='click360/stale-server-read');else assert((await read).data().revision>=20);
    assert.equal(reads,transactions);
  }
});
test('cached/pending/older listeners cannot lower the applied revision',()=>{
  const start=service.indexOf('function listenRemoteChanges()'),end=service.indexOf('\n  function ',start+1);
  const source=service.slice(start,end>start?end:service.indexOf('\n\t  function ',start+1));
  for(const [revision,metadata]of [[19,{fromCache:false}],[30,{fromCache:true}],[30,{hasPendingWrites:true}]]){
    let callback;
    const sandbox={REMOTE_UNSUBSCRIBE:null,ACTIVE_CONTEXT:{},AUTH_EPOCH:1,auth:{currentUser:{}},AUTH_APPROVED:true,PULL_COMPLETE:true,LAST_REMOTE_REVISION:20,
      STATE_DOC:{onSnapshot:fn=>{callback=fn;return()=>{};}},isActiveSyncScope:()=>true};
    vm.createContext(sandbox);vm.runInContext(source,sandbox);sandbox.listenRemoteChanges();
    callback({exists:true,metadata,data:()=>({revision})});assert.equal(sandbox.LAST_REMOTE_REVISION,20);
  }
});
(async()=>{let failures=0;for(const {name,fn}of cases){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.message);}}
  if(failures)process.exitCode=1;else console.log('PASS r38 authoritative read regression: actual production reader, listener and critical commit');})();
