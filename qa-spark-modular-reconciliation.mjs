import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import './spark-modular-migration.js';
import './spark-modular-reconciliation.js';
const api=globalThis.CLICK360_SPARK_RECONCILIATION;
const identity={ownerUid:'reconcile-owner',businessId:'business-alpha'};
const operation={...identity,operationId:'sale-1',payloadHash:'a'.repeat(64),state:'unknown'};
const confirmed={source:'server',exists:true,record:{...operation,status:'committed'}};
assert.equal(api.classify({identity,operation,authority:confirmed}).status,'CONFIRMED_REMOTE');
assert.equal(api.classify({identity,operation,authority:{source:'cache',exists:false}}).status,'UNKNOWN');
assert.equal(api.classify({identity,operation,authority:{source:'server',exists:false}}).status,'LOCAL_PENDING');
assert.equal(api.classify({identity,operation,authority:{...confirmed,record:{...confirmed.record,payloadHash:'b'.repeat(64)}}}).status,'CONFLICT');
assert.equal(api.classify({identity,operation,authority:{...confirmed,record:{...confirmed.record,businessId:'other-business'}}}).status,'CONFLICT');
assert.equal(api.classify({identity,operation,authority:{...confirmed,record:{...confirmed.record,status:'inflight'}}}).status,'UNKNOWN');
assert.equal(api.classify({identity,operation,authority:{...confirmed,record:{...confirmed.record,status:undefined}}}).status,'UNKNOWN');
const failed=await api.reconcile({identity,operations:[operation],lookupOperation:async()=>{throw Error('network');}});assert.equal(failed.canProceed,false);assert.equal(failed.unknownCount,1);
await assert.rejects(()=>api.reconcile({identity,operations:[operation,operation],lookupOperation:async()=>confirmed}),/DUPLICATE_OPERATION/);
const good=await api.reconcile({identity,operations:[operation],lookupOperation:async()=>confirmed});assert.equal(good.canProceed,true);assert.equal(good.confirmedCount,1);
const pageOptions={identity,lookupOperation:async()=>confirmed,assertSourceStable:async()=>{}};
const exactCount=async()=>({countIsBounded:false,total:1,pendingCount:0,unknownCount:1});
const noProjection=async()=>0;
await assert.rejects(()=>api.reconcileJournal({...pageOptions,journal:{countProjectionPending:noProjection,countPending:exactCount,
  listPendingPage:async()=>({rows:[],next:{state:'unknown',primaryKey:'same'},complete:false})}}),/CURSOR_NOT_ADVANCING/);
await assert.rejects(()=>api.reconcileJournal({...pageOptions,pageSize:101,journal:{countProjectionPending:noProjection,countPending:exactCount,listPendingPage:async()=>{throw Error('must not read');}}}),/PAGE_SIZE_INVALID/);
await assert.rejects(()=>api.reconcileJournal({...pageOptions,journal:{countProjectionPending:noProjection,countPending:async()=>({...await exactCount(),countIsBounded:true}),
  listPendingPage:async()=>{throw Error('must not read');}}}),/FULL_OUTBOX_COUNT_REQUIRED/);
const projectionBlocked=await api.reconcileJournal({...pageOptions,journal:{
  countPending:async()=>({countIsBounded:false,total:0,pendingCount:0,unknownCount:0}),
  countProjectionPending:async()=>1,listPendingPage:async()=>({rows:[],next:null,complete:true})}});
assert.equal(projectionBlocked.canProceed,false);assert.equal(projectionBlocked.unknownCount,0);
assert.equal(projectionBlocked.projectionPendingCount,1);
await assert.rejects(()=>api.reconcileJournal({...pageOptions,journal:{countPending:exactCount,listPendingPage:async()=>({rows:[],next:null,complete:true})}}),/FULL_OUTBOX_GUARD_REQUIRED/);
const rootIdentity={ownerUid:identity.ownerUid,ownerId:identity.ownerUid,businessId:identity.ownerUid,tenantKey:`owner:${identity.ownerUid}:business:${identity.ownerUid}`,schemaVersion:10};
const remoteBody={businesses:[{id:identity.businessId}],products:[],sales:[],movements:[]};
const localBody={...structuredClone(remoteBody),identity:rootIdentity,sales:[{id:'historical-sale',businessId:identity.businessId,total:30}]};
const input={ownerUid:identity.ownerUid,unknownOperations:0,remote:{source:'server',identity:rootIdentity,revision:7,snapshot:remoteBody},
  localRecord:{durable:true,snapshot:localBody,cloudCapacityBlocked:true,pendingRemoteSync:true,baseRevision:7,deviceRevision:'persist-8',pendingOperations:['persist-8']}};
const proof=await api.capacitySnapshotProof(input);assert.equal(proof.results[0].replayAllowed,false);assert.equal(proof.results[0].action,'IMPORT_RECONCILED_SOURCE_ONLY');
assert.equal(proof.sourceHash,await globalThis.CLICK360_SPARK_MIGRATION.hash(localBody));assert.equal(localBody.sales.length,1);
await assert.rejects(()=>api.capacitySnapshotProof({...input,localRecord:{...input.localRecord,baseRevision:6}}),/DRIFT/);
await assert.rejects(()=>api.capacitySnapshotProof({...input,localRecord:{...input.localRecord,cloudCapacityBlocked:false}}),/PROOF_REQUIRED/);
await assert.rejects(()=>api.capacitySnapshotProof({...input,localRecord:{...input.localRecord,durable:false}}),/PROOF_REQUIRED/);
await assert.rejects(()=>api.capacitySnapshotProof({...input,unknownOperations:1}),/UNKNOWN_OPERATIONS_STOP/);
const migration=globalThis.CLICK360_SPARK_MIGRATION;
const rules=await readFile('firestore.spark.rules','utf8');
const whitelist=rules.match(/function sparkShadowModule\(([A-Za-z_]\w*)\)\s*\{[\s\S]*?\b\1\.matches\("([^"]+)"\)/);
assert(whitelist,'Exact module scope guard required');
const allowedModules=new Set([...Object.values(migration.arrays),'config']);
assert.deepEqual(new Set(whitelist[2].slice(2,-2).split('|')),allowedModules);
const modulePattern=new RegExp(whitelist[2]);
for(const moduleName of allowedModules){
  assert(modulePattern.test(moduleName));
  assert(!modulePattern.test(`prefix-${moduleName}`));
  assert(!modulePattern.test(`${moduleName}-suffix`));
}
for(const forbidden of ['private','metadata','operationLedger','members','products/other'])assert(!modulePattern.test(forbidden));
const cleanLocal={durable:true,snapshot:{...structuredClone(remoteBody),identity:rootIdentity},deviceRevision:'clean-8',pendingOperations:[]};
const cleanInput={ownerUid:identity.ownerUid,unknownOperations:0,remote:input.remote,local:cleanLocal};
const before=structuredClone(cleanInput);
const equivalent=await migration.selectSource(cleanInput);
assert.equal(equivalent.source,'device_identity_equivalent');
assert.equal(equivalent.localMaterialHash,equivalent.remoteMaterialHash);
assert.notEqual(equivalent.sourceHash,equivalent.remoteHash);
assert.deepEqual(equivalent.snapshot,cleanLocal.snapshot);
assert.deepEqual(cleanInput,before);
await assert.rejects(()=>migration.selectSource({...cleanInput,local:{...cleanLocal,snapshot:localBody}}),/CLEAN_HASH_CONTRADICTION_STOP/);
for(const changedIdentity of [{...rootIdentity,ownerUid:'other-owner'},{...rootIdentity,unexpected:'commercial-data'}]){
  await assert.rejects(()=>migration.selectSource({...cleanInput,local:{...cleanLocal,snapshot:{...cleanLocal.snapshot,identity:changedIdentity}}}),/SOURCE_IDENTITY_MISMATCH/);
}
const manifest=await migration.plan({ownerUid:identity.ownerUid,snapshot:equivalent.snapshot,identity:equivalent.identity,remoteRevision:7});
const comparison=await migration.compare({manifest,remoteRecords:manifest.records,source:equivalent.snapshot});
assert.equal(comparison.reconstructedHash,equivalent.sourceHash);
console.log('PASS deterministic operation reconciliation: fresh server only, no cached retry grant, lost response classified, conflicts stop, capacity snapshot imports once without commercial replay.');
