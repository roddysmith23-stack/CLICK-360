import assert from 'node:assert/strict';
import './spark-modular-migration.js';
const api=globalThis.CLICK360_SPARK_MIGRATION;
const owner='synthetic-owner';
const identity={ownerUid:owner,ownerId:owner,businessId:owner,tenantKey:`owner:${owner}:business:${owner}`,schemaVersion:10};
function fixture({products=500,history=0,businesses=1}={}){
  const businessIds=Array.from({length:businesses},(_,i)=>`business-${i}`);
  return {identity,businesses:businessIds.map(id=>({id,name:'Synthetic business',settings:{tax:{rate:0}}})),
    products:Array.from({length:products},(_,i)=>({id:`p-${i}`,businessId:businessIds[i%businesses],stock:4,qty:4,name:`Product ${i}`,price:30})),
    sales:Array.from({length:history},(_,i)=>({id:`s-${i}`,operationId:`op-${i}`,businessId:businessIds[i%businesses],total:30,date:'2026-09-03',items:[{id:`p-${i%products}`,qty:1,price:30}]})),
    movements:Array.from({length:history},(_,i)=>({id:`m-${i}`,operationId:`op-${i}`,saleId:`s-${i}`,businessId:businessIds[i%businesses],amount:30,date:'2026-09-03'})),
    auditLogs:Array.from({length:history},(_,i)=>({id:`a-${i}`,businessId:businessIds[i%businesses],action:'sale_created',operationId:`op-${i}`})),
    cashSessions:businessIds.map((businessId,i)=>({id:`cash-${i}`,businessId,date:'2026-09-03',status:'closed'})),
    // Repeated references in reports are not additional sale transactions.
    dailyReports:businessIds.map((businessId,i)=>({id:`report-${i}`,businessId,cashSessionId:`cash-${i}`,saleIds:['s-0'],total:30})),
    settings:{customers:[],labelTemplates:[],policies:{version:1},nullable:null},
    notifications:[],workingDate:'2026-09-03',updatedAtMs:1,extra:{empty:{},array:[0,false,'unchanged']}};
}
const remote=fixture();
const pending=structuredClone(remote);
pending.sales.push({id:'new-sale',operationId:'new-op',businessId:'business-0',total:30,date:'2026-09-04',items:[{id:'p-0',qty:1}]});
pending.movements.push({id:'new-movement',operationId:'new-op',businessId:'business-0',amount:30,saleId:'new-sale'});
pending.products[0].stock=pending.products[0].qty=3;
const local={snapshot:pending,durable:true,deviceRevision:'device-revision-2',baseRevision:12,pendingRemoteSync:true,cloudCapacityBlocked:true,pendingOperations:['persist-local-2']};
const fresh={snapshot:remote,revision:12,source:'server'};
const chosen=await api.selectSource({ownerUid:owner,remote:fresh,local,unknownOperations:0});
assert.equal(chosen.source,'durable_pending_device');
assert.equal(chosen.snapshot.sales.length,1);
assert.equal(chosen.snapshot.products[0].stock,3);
assert.deepEqual(chosen.pendingOperations,['persist-local-2']);
await assert.rejects(()=>api.selectSource({ownerUid:owner,remote:{...fresh,revision:13},local,unknownOperations:0}),/REMOTE_DRIFT_STOP/);
await assert.rejects(()=>api.selectSource({ownerUid:owner,remote:fresh,local:{...local,pendingRemoteSync:false,cloudCapacityBlocked:false,pendingOperations:[]},unknownOperations:0}),/CLEAN_HASH_CONTRADICTION_STOP/);
await assert.rejects(()=>api.selectSource({ownerUid:owner,remote:fresh,local,unknownOperations:1}),/UNKNOWN_OPERATIONS_STOP/);
await assert.rejects(()=>api.selectSource({ownerUid:owner,remote:{...fresh,source:'cache'},local}),/FRESH_SERVER/);
await assert.rejects(()=>api.selectSource({ownerUid:'other-owner',remote:fresh,local,unknownOperations:0}),/SOURCE_IDENTITY/);
await assert.rejects(()=>api.selectSource({ownerUid:owner,remote:fresh,local}),/UNKNOWN_OPERATIONS_STOP/);
await assert.rejects(()=>api.selectSource({ownerUid:owner,remote:fresh,local:{...local,pendingOperations:[{operationId:'unknown-op',state:'unknown'}]},unknownOperations:0}),/UNKNOWN_OPERATIONS_STOP/);
for(const shape of [{products:500,history:300,businesses:1},{products:2000,history:5000,businesses:2}]){
  const source=fixture(shape);
  const untouched=api.canonicalJson(source);
  const plan=await api.plan({ownerUid:owner,snapshot:source,remoteRevision:12,deviceRevision:'device-2'});
  assert.equal(plan.records.every(r=>api.byteLength(r.content)<=api.MAX_RECORD_BYTES),true);
  assert.equal(new Set(plan.records.map(r=>r.path)).size,plan.records.length);
  assert.equal(plan.records.filter(r=>r.content.module==='products').length,shape.products);
  assert.equal(plan.records.filter(r=>r.content.module==='sales').length,shape.history);
  assert.equal(plan.records.filter(r=>r.content.module==='movements').length,shape.history);
  const verified=await api.compare({manifest:plan,remoteRecords:structuredClone(plan.records).reverse(),source});
  assert.equal(verified.status,'SEMANTIC_EQUALITY_PASS');
  assert.equal(verified.reconstructedHash,await api.hash(source));
  assert.equal(api.canonicalJson(source),untouched);
  assert.equal(Object.values(verified.counts).reduce((n,b)=>n+b.salesTotal,0),shape.history*30);
  await assert.rejects(()=>api.compare({manifest:plan,remoteRecords:plan.records.slice(1),source}),/COUNT_MISMATCH/);
  const corrupted=structuredClone(plan.records);corrupted.find(r=>r.content.module==='products').content.data.stock=999;
  await assert.rejects(()=>api.compare({manifest:plan,remoteRecords:corrupted,source}),/INTEGRITY_MISMATCH/);
  const forged=structuredClone(plan.records);forged[0].path+='-extra';
  await assert.rejects(()=>api.compare({manifest:plan,remoteRecords:forged,source}),/ID_MISMATCH/);
  console.log(JSON.stringify({status:'PASS',synthetic:true,...shape,payloadBytes:plan.payloadBytes,records:plan.recordCount,sourceHash:verified.sourceHash,reconstructedHash:verified.reconstructedHash,productionWrites:0}));
}
const duplicate=fixture();duplicate.products.push(duplicate.products[0]);
for(const targetBytes of [850000,860000,1024*1024,Math.ceil(1.2*1024*1024),3*1024*1024,7*1024*1024]){
  const source=fixture({products:500,history:0});
  const perProduct=Math.ceil(Math.max(0,targetBytes-api.byteLength(source))/500);
  for(const product of source.products)product.description='x'.repeat(perProduct);
  const manifest=await api.plan({ownerUid:owner,snapshot:source,remoteRevision:12,deviceRevision:'device-size-check'});
  assert(manifest.payloadBytes>=targetBytes);
  const equality=await api.compare({manifest,remoteRecords:manifest.records,source});
  assert.equal(equality.sourceHash,equality.reconstructedHash);
  assert(manifest.records.every(row=>api.byteLength(row.content)<api.MAX_RECORD_BYTES));
  console.log(JSON.stringify({status:'PASS',targetBytes,payloadBytes:manifest.payloadBytes,recordCount:manifest.recordCount,maxSingleDocumentBytes:Math.max(...manifest.records.map(row=>api.byteLength(row.content))),sha256Equal:true}));
}
await assert.rejects(()=>api.plan({ownerUid:owner,snapshot:duplicate,remoteRevision:12}),/DUPLICATE_RECORD_ID/);
const ambiguous=fixture({businesses:2});delete ambiguous.products[0].businessId;
await assert.rejects(()=>api.plan({ownerUid:owner,snapshot:ambiguous,remoteRevision:12}),/AMBIGUOUS_BUSINESS_STOP/);
const badStock=fixture();badStock.products[0].qty=999;
await assert.rejects(()=>api.plan({ownerUid:owner,snapshot:badStock,remoteRevision:12}),/STOCK_MIRROR_MISMATCH/);
const oversized=fixture();oversized.products[0].imageData='x'.repeat(900000);
await assert.rejects(()=>api.plan({ownerUid:owner,snapshot:oversized,remoteRevision:12}),/RECORD_TOO_LARGE_STOP/);
console.log('PASS Spark migration selection/semantic roundtrip: no source writes, no report-reference double count, unresolved forks fail closed.');
