import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('./device-health-readonly.js',import.meta.url),'utf8');
const SHA='a'.repeat(64);
function client(rows=[],options={}){
  let writes=0,opened=0,closed=0;
  const identity={ownerUid:'owner-shary',businessId:'business-shary',tenantKey:'owner:owner-shary:business:business-shary'};
  const writer={identity,isBusy:()=>options.busy===true,
    health:async()=>({pendingCount:0,unknownCount:0,projectionPendingCount:0,
      countIsBounded:options.bounded===true,activeRequests:0})};
  const root={
    click360Auth:{currentUser:{uid:'owner-shary'}},
    click360User:{uid:'owner-shary',ownerId:'owner-shary',role:'owner'},
    click360TenantContext:{authUid:'owner-shary',businessId:'owner-shary',tenantKey:'owner:owner-shary:business:owner-shary'},
    click360GetActiveBusinessId:()=>identity.businessId,
    click360SparkBootstrapState:{phase:options.phase||'READY'},
    click360SparkOperationalSession:options.noWriter?null:writer,
    click360GetSyncStatus:()=>({status:'modular_confirmed'}),
    CLICK360_RELEASE_ASSETS:{'app.js':'a'.repeat(12)},
    CLICK360_P0A_JOURNAL:{open:async()=>{
      opened++;
      return {captureOwner:async ownerUid=>{
        assert.equal(ownerUid,'owner-shary');
        return {ownerUid,rows,recordCount:rows.length,enumerationComplete:true};
      },close:()=>{closed++;}};
    }},
    navigator:{onLine:true}
  };
  vm.runInNewContext(script,{window:root,Date,Error,JSON,Object,Array,String,RegExp});
  return {root,counters:()=>({writes,opened,closed})};
}
const confirmed={ownerUid:'owner-shary',businessId:'business-shary',
  operationId:'op-one',key:'owner-shary:business-shary:op-one',state:'confirmed',
  projectionState:'complete',payloadHash:SHA,actorUid:'owner-shary',
  payload:{actorUid:'owner-shary'}};
{
  const {root,counters}=client([confirmed]);
  const value=await root.CLICK360_DEVICE_READONLY_SUPPORT.inspect();
  assert.equal(value.result,'SUPERVISED_GO_CANDIDATE');
  assert.equal(value.journal.enumerationComplete,true);
  assert.equal(value.journal.total,1);
  assert.deepEqual(counters(),{writes:0,opened:1,closed:1});
  assert(!JSON.stringify(value).includes('owner-shary'));
  assert(!JSON.stringify(value).includes('op-one'));
}
for(const [row,kind] of [
  [{...confirmed,state:'unknown'},'unknown'],
  [{...confirmed,state:'inflight'},'inflight'],
  [{...confirmed,state:'queued'},'queued'],
  [{...confirmed,projectionState:'pending'},'projectionPending'],
  [{...confirmed,payloadHash:''},'missingProof'],
  [{...confirmed,state:'bogus'},'unexpectedState']
]){
  const {root}=client([row]);
  const value=await root.CLICK360_DEVICE_READONLY_SUPPORT.inspect();
  assert.equal(value.result,'NO_GO_REVIEW_REQUIRED',kind);
  assert.equal(value.journal[kind],1,kind);
}
{
  const {root}=client([confirmed],{bounded:true});
  const value=await root.CLICK360_DEVICE_READONLY_SUPPORT.inspect();
  assert.equal(value.result,'NO_GO_REVIEW_REQUIRED');
  assert.equal(value.runtimeHealth.complete,false);
}
{
  const {root}=client([confirmed],{noWriter:true});
  const value=await root.CLICK360_DEVICE_READONLY_SUPPORT.inspect();
  assert.equal(value.result,'NO_GO_REVIEW_REQUIRED');
  assert.equal(value.writerInstalled,false);
}
{
  const {root}=client([confirmed],{phase:'INSTALLING_UI'});
  const value=await root.CLICK360_DEVICE_READONLY_SUPPORT.inspect();
  assert.equal(value.result,'NO_GO_REVIEW_REQUIRED');
}
{
  const {root}=client();
  root.click360User.ownerId='other';
  await assert.rejects(()=>root.CLICK360_DEVICE_READONLY_SUPPORT.inspect(),/OWNER_SESSION_REQUIRED/);
}
console.log('REMOTE_DEVICE_READONLY_HEALTH_PASS');
