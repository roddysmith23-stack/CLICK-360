import test from 'node:test';
import strict from 'node:assert/strict';
import {MARKER,hash,firestoreFieldsHash,assertReady,buildReplacement,applyRecovery,conditionalRollback,decode} from './scripts/recovery/restore-core.mjs';

const value = x => x === null ? {nullValue:null} : Array.isArray(x) ? {arrayValue:{values:x.map(value)}}
  : typeof x === 'object' ? {mapValue:{fields:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,value(v)]))}}
  : typeof x === 'string' ? {stringValue:x} : typeof x === 'boolean' ? {booleanValue:x} : {integerValue:String(x)};
function fixture(){
  const uid='synthetic-recovery-owner',tenantKey=`owner:${uid}:business:${uid}`;
  const scope={projectId:'demo-click360-recovery',databaseId:'(default)',ownerUid:uid,businessId:uid,tenantKey,documentPath:`businesses/${uid}/state/main`};
  const identity={schemaVersion:10,ownerUid:uid,ownerId:uid,businessId:uid,tenantKey};
  const data={businesses:[{id:uid,name:'Synthetic recovery only'}],activeBusinessId:uid,identity,products:[],sales:[],movements:[],layaways:[],cashSessions:[],dailyReports:[],invoices:[],deletedProducts:[],auditLogs:[],settings:{workers:[],labelTemplates:[],labelProfiles:[]}};
  const doc={name:`projects/demo-click360-recovery/databases/(default)/documents/${scope.documentPath}`,
    fields:value({...identity,revision:9,keepUnrelatedFlag:'KEEP',payload:{schemaVersion:10,identity,data}}).mapValue.fields,updateTime:'2026-08-31T00:00:00.000000001Z'};
  const recovered=structuredClone(doc);
  recovered.fields.payload.mapValue.fields.data.mapValue.fields.products=value([{id:'synthetic-p',businessId:uid,code:'SYN-1',name:'Synthetic only',stock:17,qty:17,price:10,cost:5,cardPrice:10}]);
  const candidate={scope,restoreEligible:true,proposedHistoricalDocument:{name:recovered.name,fields:recovered.fields}};
  const attestation={marker:MARKER,candidateHash:hash(candidate),operationId:MARKER+'_synthetic',expectedUpdateTime:doc.updateTime,expectedRevision:9,
    evidence:[{path:'synthetic-proof.json',sha256:'a'.repeat(64)}],gates:Object.fromEntries(['identity','schema','intrinsicIntegrity','noSyntheticData','deltasExplained','newerWritesPreserved','liveWritersControlled','rollbackTested'].map(k=>[k,'PASS']))};
  const now=100;
  const backup={before:doc,beforeHash:hash(doc.fields),candidateHash:hash(candidate),managedBackupVerified:true,expectedAfterHash:firestoreFieldsHash(buildReplacement(candidate,doc,attestation.operationId,now).fields)};
  let current=structuredClone(doc),commits=0;
  const client={get:async()=>structuredClone(current),commit:async writes=>{
    const first=writes[0];strict.equal(first.currentDocument.updateTime,current.updateTime);
    current={...structuredClone(first.update),updateTime:`2026-08-31T00:00:00.00000000${++commits+1}Z`};
  }};
  return {candidate,attestation,backup,client,now,current:()=>current,mutate:fn=>{current=fn(current);},commits:()=>commits};
}
test('every unclosed recovery gate denies all writes',()=>{
  const f=fixture();for(const gate of Object.keys(f.attestation.gates)){
    const a=structuredClone(f.attestation);a.gates[gate]='UNKNOWN';strict.throws(()=>assertReady(f.candidate,a),/GATE_NOT_PASS/);
  }strict.equal(f.commits(),0);
});
test('C9-style historical-only candidate never becomes eligible implicitly',()=>{
  const f=fixture();f.candidate.restoreEligible=false;strict.throws(()=>assertReady(f.candidate,f.attestation),/NOT_RESTORE_ELIGIBLE/);
});
test('wrong tenant and project fail closed',()=>{
  for(const field of ['ownerUid','businessId','tenantKey','projectId','documentPath']){
    const f=fixture();f.candidate.scope[field]='other';strict.throws(()=>assertReady(f.candidate,f.attestation));
  }
});
test('attestation cannot bypass intrinsic entity validation',()=>{
  for(const mutate of [p=>{p.stock=-1;},p=>{p.qty=18;},p=>{p.businessId='other';}]){
    const f=fixture(),data=f.candidate.proposedHistoricalDocument.fields.payload.mapValue.fields.data.mapValue.fields;
    const p={id:'synthetic-p',businessId:f.candidate.scope.businessId,code:'SYN-1',name:'Synthetic',stock:17,qty:17,price:10,cost:5,cardPrice:10};mutate(p);data.products=value([p]);
    f.attestation.candidateHash=hash(f.candidate);strict.throws(()=>assertReady(f.candidate,f.attestation),/CANDIDATE_INTEGRITY/);
  }
});
test('restore is CAS protected and idempotent; two reads verify typed result',async()=>{
  const f=fixture();strict.equal((await applyRecovery(f)).status,'SHARY_DATA_RECOVERY_VERIFIED');strict.equal(f.commits(),1);
  strict.equal((await applyRecovery(f)).status,'ALREADY_APPLIED');strict.equal(f.commits(),1);
  strict.equal(f.current().fields.keepUnrelatedFlag.stringValue,'KEEP');
});
test('concurrent newer state is never overwritten',async()=>{
  const f=fixture();f.mutate(d=>({...d,updateTime:'new-write'}));
  await strict.rejects(applyRecovery(f),/CONCURRENT_WRITE/);strict.equal(f.commits(),0);
});
test('bad/missing managed backup denies restore',async()=>{
  const f=fixture();f.backup.managedBackupVerified=false;await strict.rejects(applyRecovery(f),/MANAGED_BACKUP/);strict.equal(f.commits(),0);
});
test('exact conditional rollback restores business fields without stale revision',async()=>{
  const f=fixture();await applyRecovery(f);
  const post=f.current().updateTime;
  const result=await conditionalRollback({...f,expectedPostUpdateTime:post,now:200});
  strict.equal(result.status,'RECOVERY_ROLLED_BACK');
  strict.equal(hash(result.actual.fields.payload),hash(f.backup.before.fields.payload));
  strict.equal(result.actual.fields.revision.integerValue,'200');strict.equal(f.commits(),2);
});
test('rollback refuses a valid external write even with expected marker',async()=>{
  const f=fixture();await applyRecovery(f);const post=f.current().updateTime;
  f.mutate(d=>({...d,updateTime:'external-newer'}));
  await strict.rejects(conditionalRollback({...f,expectedPostUpdateTime:post}),/ROLLBACK_BLOCKED_BY_EXTERNAL_WRITE/);
  strict.equal(f.commits(),1);
});
test('unsafe integers and unsupported types cannot silently lose precision',()=>{
  strict.throws(()=>decode({integerValue:'9007199254740993'}),/UNSAFE_INTEGER/);
  strict.throws(()=>decode({doubleValue:'NaN'}),/NONFINITE/);
  strict.throws(()=>decode({unknownValue:1}),/UNKNOWN_FIRESTORE/);
});
test('REST wire normalization preserves values, null and absent distinctions',()=>{
  strict.equal(firestoreFieldsHash({a:{arrayValue:{}}}),firestoreFieldsHash({a:{arrayValue:{values:[]}}}));
  strict.equal(firestoreFieldsHash({a:{mapValue:{}}}),firestoreFieldsHash({a:{mapValue:{fields:{}}}}));
  strict.equal(firestoreFieldsHash({t:{timestampValue:'2026-08-31T00:00:00Z'}}),firestoreFieldsHash({t:{timestampValue:'2026-08-31T00:00:00.000000000Z'}}));
  strict.notEqual(firestoreFieldsHash({a:{arrayValue:{}}}),firestoreFieldsHash({}));
  strict.notEqual(firestoreFieldsHash({a:{nullValue:null}}),firestoreFieldsHash({a:{mapValue:{}}}));
  strict.notEqual(firestoreFieldsHash({a:{integerValue:'1'}}),firestoreFieldsHash({a:{stringValue:'1'}}));
});
