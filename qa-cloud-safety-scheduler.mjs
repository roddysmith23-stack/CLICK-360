import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
let now=0,next=0,captures=0;const tasks=new Map(),listeners=new Map();
const context={authUid:'synthetic-a',ownerId:'synthetic-a',businessId:'synthetic-a',tenantKey:'synthetic:synthetic-a'};
const root={click360TenantContext:context,navigator:{onLine:true},document:{hidden:false,addEventListener(){}},
  addEventListener:(name,fn)=>{const list=listeners.get(name)||[];list.push(fn);listeners.set(name,list);},
  dispatchEvent:event=>{for(const listener of listeners.get(event.type)||[])listener(event);},
  CLICK360_CLOUD_SAFETY:{},CLICK360_V16_STORAGE:{contextId:ctx=>ctx.tenantKey,getSnapshot:async()=>{captures++;return null;}},
  firebase:{apps:[{}],auth:()=>({currentUser:{uid:root.click360TenantContext.authUid}})}};
const sandbox={window:root,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  setTimeout:(callback,delay)=>{const id=++next;tasks.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>tasks.delete(id),setInterval:()=>0,TextEncoder};
vm.runInNewContext(await readFile('cloud-safety-backup-client.js','utf8'),sandbox);
async function advance(ms){now+=ms;for(const [id,task] of [...tasks])if(task.at<=now){tasks.delete(id);task.callback();}for(let i=0;i<5;i++)await Promise.resolve();}
for(let i=0;i<30;i++){root.dispatchEvent({type:'click360-access-changed'});await advance(100);}
assert(captures>=1,'Access event storm must not postpone capture indefinitely');
root.click360CloudSafetyStatus={status:'CONFIRMED'};
root.dispatchEvent({type:'click360-access-changed'});
assert.equal(root.click360CloudSafetyStatus.status,'CONFIRMED','Unchanged access does not erase confirmation');
root.dispatchEvent({type:'click360-local-state-saved'});
assert.equal(root.click360CloudSafetyStatus.status,'PENDING','New durable save invalidates current-source confirmation');
root.click360CloudSafetyStatus={status:'CONFIRMED',payloadSha256:'old-private-hash'};
root.click360TenantContext={...context,authUid:'synthetic-b',ownerId:'synthetic-b',tenantKey:'synthetic:synthetic-b'};
root.dispatchEvent({type:'click360-access-changed'});
assert.equal(root.click360CloudSafetyStatus.status,'PENDING');assert.equal(root.click360CloudSafetyStatus.payloadSha256,undefined);
console.log('PASS backup scheduler: access event storm bounded; unrelated access preserves receipt; new save/account switch invalidates it safely');
