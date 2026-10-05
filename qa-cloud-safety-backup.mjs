import assert from 'node:assert/strict';
import './cloud-safety-backup.js';
const api=globalThis.CLICK360_CLOUD_SAFETY;
const context={authUid:'owner-a',ownerUid:'owner-a',businessId:'owner-a',tenantKey:'owner:owner-a:business:owner-a'};
function fixture(bytes){return {authUid:context.authUid,ownerId:context.ownerUid,businessId:context.businessId,tenantKey:context.tenantKey,schemaVersion:10,deviceRevision:'op-new',baseRevision:7,pendingOperations:['op-new','unknown-not-replayable'],pendingRemoteSync:true,cloudCapacityBlocked:true,snapshot:{identity:{ownerUid:context.ownerUid,tenantKey:context.tenantKey},businesses:[{id:'alpha'},{id:'beta'}],activeBusinessId:'alpha',products:[{id:'p-a',businessId:'alpha',stock:9,qty:9},{id:'p-b',businessId:'beta',stock:20,qty:20}],sales:[{id:'sale-a',operationId:'op-new',businessId:'alpha',date:'2026-09-03',total:30}],movements:[{id:'move-a',businessId:'alpha',saleId:'sale-a',amount:30}],audit:[{id:'global',note:'preserve'}],settings:{padding:'x'.repeat(bytes),unicode:'Perfume 🌺 áé'},cashSessions:[],dailyReports:[]}};}
const options={buildSha:'21409a1d2dc7',deviceId:'device-a',sequence:1};
for(const bytes of [850000,860000,1048576,1258291,3145728,7340032]){
  const record=fixture(bytes),prepared=await api.prepare(context,record,options);
  assert.deepEqual(await api.reconstruct(prepared.manifest,prepared.chunks),record);
  assert(prepared.chunks.every(p=>Buffer.byteLength(JSON.stringify(p))<300000));
  assert.equal(prepared.manifest.unknownOperationsCount,null);
  const alpha=api.partition(record).scopes.alpha;assert(!JSON.stringify(alpha).includes('p-b'));
  const corrupt=structuredClone(prepared.chunks);corrupt[0].text='Y29ycnVwdA==';
  await assert.rejects(api.reconstruct(prepared.manifest,corrupt));
  await assert.rejects(api.reconstruct(prepared.manifest,prepared.chunks.slice(1)));
  const wrong=structuredClone(prepared.manifest);wrong.payloadSha256='0'.repeat(64);
  await assert.rejects(api.reconstruct(wrong,prepared.chunks));
  console.log('PASS cloud safety canonical reconstruction / corrupt-missing-hash rejection / business partition:',bytes);
}
await assert.rejects(api.prepare({...context,authUid:'other-owner'},fixture(860000),options));
await assert.rejects(api.prepare(context,fixture(8*1024*1024+1),options));
await assert.rejects(api.prepare(context,{...fixture(1),unsafeNativeDate:new Date()},options),/unsupported_snapshot_object_type/);
const prepared=await api.prepare(context,fixture(860000),options),parts=new Map();let manifest,creates=0,failOnce=true;
const transport={getManifest:async()=>manifest,getParts:async()=>[...parts.values()],getPart:async(_,id)=>parts.get(id),begin:async m=>{manifest||={...m,status:'UPLOADING'};},createPart:async(_,part)=>{if(failOnce&&creates===2){failOnce=false;throw Error('interrupted');}parts.set(part.id,part);creates++;},complete:async()=>{await api.reconstruct(manifest,[...parts.values()]);manifest={...manifest,status:'COMPLETE',completedAt:'server-time'};throw Error('lost-response');}};
await assert.rejects(api.upload(prepared,transport),/interrupted/);
assert.equal(manifest.status,'UPLOADING');
assert.equal((await api.upload(prepared,transport)).status,'COMPLETE');
assert.equal(creates,prepared.chunks.length);
await api.upload(prepared,transport);assert.equal(creates,prepared.chunks.length);
assert.deepEqual(await api.reconstruct(manifest,[...parts.values()]),fixture(860000));
console.log('PASS interrupted/resume/duplicate/lost response: no operation replay or snapshot mutation');
