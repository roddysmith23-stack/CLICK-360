import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const service=readFileSync('firebase-service.js','utf8');
const helpers=service.slice(service.indexOf('  let STARTUP_ATTEMPT='),service.indexOf('const SCHEMA_VERSION = 10'));
const listener=service.slice(service.indexOf('auth.onAuthStateChanged(async user => {'),service.lastIndexOf('\n  // This service script precedes')).replace(/\n  }\s*$/,'');
function fixture(listenerSource=listener){
 let epoch=0,resolveRead,readCount=0,id=0;const timers=new Map(),events=[],nodes=new Map();
 const support={style:{},setAttribute(){},textContent:''};
 nodes.set('click360-auth-gate',{});nodes.set('c360-auth-msg',{insertAdjacentElement(_position,node){nodes.set(node.id,node);}});
 const window={CLICK360_RELEASE_ASSETS:{'app.js':'a'.repeat(12)}};
 const sandbox={window,document:{getElementById:id=>nodes.get(id),createElement:()=>support},
   Date,Number,Object,String,Set,Promise,navigator:{onLine:true},
   setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id),
   recordTelemetryOnce:(...args)=>events.push(args),isCurrentAuthEpoch:(_user,value)=>value===epoch,
   AUTH_APPROVED:false,PULL_COMPLETE:false,AUTH_EPOCH:0,tenantGuard:{block(){}},
   auth:{onAuthStateChanged:callback=>sandbox.listener=callback},
   deactivateActiveAccount(){sandbox.AUTH_EPOCH=++epoch;},readAuthRedirectPending:()=>null,
   clearAuthRedirectPending(){},readPublicAuthIntent:()=> 'login',
   ACCESS_UI_STATES:{AUTHENTICATED_RESOLVING:'resolving',RECOVERABLE_ERROR:'error'},
   showGate:(message,state)=>{sandbox.gate={message,state};},setSyncStatus(){},clearInvitationIntent(){},
   resolveAccountAccess:async()=>{readCount++;await new Promise(resolve=>resolveRead=resolve);return {status:'ready',state:{allowed:true}};},
   applyAccountAccessIdentity:()=>{throw Object.assign(Error('synthetic identity failure'),{code:'identity-setup-failed'});}};
 const context=vm.createContext(sandbox);vm.runInContext(helpers+'\n'+listenerSource,context);
 return {sandbox,window,timers,events,support,readCount:()=>readCount,release:()=>resolveRead(),
   wait(){const callbacks=[...timers.values()];timers.clear();for(const cb of callbacks)cb();},eval:text=>vm.runInContext(text,context)};
}
{
 const previous=execFileSync('git',['show','2875f6e7496f960f6d656ce5cee7c6ab7ccc10b9:firebase-service.js'],{encoding:'utf8'});
 const oldListener=previous.slice(previous.indexOf('auth.onAuthStateChanged(async user => {'),previous.lastIndexOf('\n  // This service script precedes')).replace(/\n  }\s*$/,'');
 const f=fixture(oldListener),pending=f.sandbox.listener({uid:'synthetic-old-owner'});
 await Promise.resolve();f.release();await assert.rejects(pending,/synthetic identity failure/);
 assert.equal(f.sandbox.gate.state,'resolving','The published callback demonstrably strands the UI on identity failure');
 assert.equal(f.window.click360StartupDiagnostic,undefined);
}
{
 const f=fixture(),user={uid:'private-user-not-emitted'};
 const pending=f.sandbox.listener(user);await Promise.resolve();
 assert.equal(f.window.click360StartupDiagnostic.pendingStage,'ACCOUNT_ACCESS');
 await f.sandbox.listener(user);assert.equal(f.readCount(),1,'Repeated Auth while resolving must preserve the epoch/source');
 f.wait();assert.equal(f.window.click360StartupDiagnostic.phase,'WAITING');assert.match(f.support.textContent,/STARTUP_WAIT_ACCOUNT_ACCESS/);
 assert.equal(f.sandbox.AUTH_APPROVED,false);assert.equal(f.readCount(),1,'No timed retry');
 f.release();await pending;assert.equal(f.sandbox.gate.state,'error');
 assert.equal(f.window.click360StartupDiagnostic.phase,'FAILED');
 assert.match(f.window.click360StartupDiagnostic.errorCode,/APPLY_IDENTITY_identity-setup-failed/);
 assert.equal(f.timers.size,0);assert(!JSON.stringify(f.events).includes(user.uid));
}
{
 const f=fixture();f.eval('STARTUP_ATTEMPT=createStartupAttempt({},0)');
 const p=f.eval('startupStep("MODULE_PRODUCTS",()=>new Promise(resolve=>globalThis.releaseProducts=resolve))');
 const q=f.eval('startupStep("MODULE_SALES",()=>new Promise(resolve=>globalThis.releaseSales=resolve))');
 f.eval('releaseProducts()');await p;assert.equal(f.window.click360StartupDiagnostic.pendingStage,'MODULE_SALES');
 f.wait();assert.match(f.support.textContent,/STARTUP_WAIT_MODULE_SALES/);
 f.eval('releaseSales()');await q;assert.equal(f.window.click360StartupDiagnostic.pendingStage,null);
 f.eval('AUTH_APPROVED=true;PULL_COMPLETE=true;STARTUP_ATTEMPT.finish()');
 assert.equal(f.window.click360StartupDiagnostic.phase,'READY');assert.equal(f.timers.size,0);
}
console.log('PASS startup: pending read visible, identity exception caught, Auth singleflight, concurrent stages, no retry/unlock, timers cleaned');
