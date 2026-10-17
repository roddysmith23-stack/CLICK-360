import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './spark-modular-transaction-transport.js';
const api=globalThis.CLICK360_SPARK_MIGRATION,codec=globalThis.CLICK360_SPARK_RECORD_CODEC;
const ownerUid='transport-owner',businessId='transport-business',projectId='demo-click360-spark-modular';
const controlPath=`businesses/${ownerUid}/metadata/storage`,base=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2`;
const data={id:'p.1',businessId,stock:2,qty:2,custom:{preserved:true}};
const rows=new Map([[controlPath,{ownerUid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:'a'.repeat(64),reconstructedHash:'a'.repeat(64),businessIds:[businessId]}],
  [`${base}/products/p.1`,{id:'p.1',ownerUid,businessId,schemaVersion:2,module:'products',data,dataHash:await api.hash(data)}]]);
let user={uid:ownerUid},reads=[],commits=0;
const db={app:{options:{projectId}},doc:path=>({path}),runTransaction:async callback=>{
  const pending=[];let wrote=false;
  const tx={get:async ref=>{assert(!wrote);reads.push(ref.path);return {exists:rows.has(ref.path),data:()=>rows.get(ref.path)};},set:(ref,value)=>{wrote=true;pending.push([ref.path,value]);}};
  const result=await callback(tx);for(const [path,value]of pending)rows.set(path,value);if(pending.length)commits++;return result;
}};
const input={db,projectId,ownerUid,businessId,resolveUser:()=>user};
const transport=globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create(input);
await assert.rejects(()=>transport.run(async tx=>tx.update('products','p.1',{})),/PRIOR_READ_REQUIRED/);
await assert.rejects(()=>transport.run(async tx=>{const row=await tx.get('products','p.1');tx.update('products','p.1',{...row,recordVersion:3});}),/REVISION_CONFLICT/);
assert.equal(commits,0);assert.equal(rows.get(`${base}/products/p.1`).data.stock,2);
await assert.rejects(()=>transport.run(async tx=>{const row=await tx.get('products','p.1');tx.update('products','p.1',{...row,recordVersion:2,stock:1});}),/STOCK_MIRROR_MISMATCH/);
assert.equal(commits,0);assert.equal(rows.get(`${base}/products/p.1`).data.stock,2);
const native={toDate(){return new Date();}};
await transport.run(async tx=>{
  const product=await tx.get('products','p.1');const ledger=await tx.get('operationLedger','op-1');assert.equal(ledger,null);
  tx.update('products','p.1',{...product,stock:1,qty:1,recordVersion:2,updatedAt:native});
  tx.create('operationLedger','op-1',{id:'op-1',ownerUid,businessId,tenantKey:`owner:${ownerUid}:business:${businessId}`,storageSchemaVersion:2,module:'operationLedger',recordVersion:1,payloadHash:'b'.repeat(64)});
});
assert.equal(commits,1);assert.strictEqual(rows.get(`${base}/products/p.1`).updatedAt,native);
assert.equal(rows.get(`${base}/products/p.1`).data.stock,1);assert.deepEqual(rows.get(`${base}/products/p.1`).data.custom,{preserved:true});
await transport.run(async tx=>{const p=await tx.get('products','p.1');tx.update('products','p.1',{...p,recordVersion:3,stock:0,qty:0});});
assert(!Object.hasOwn(rows.get(`${base}/products/p.1`),'sourceHash'));
assert.equal((await codec.unpack(rows.get(`${base}/products/p.1`),{identity:{ownerUid,businessId},moduleName:'products',recordId:'p.1'})).stock,0);
await assert.rejects(()=>transport.run(async tx=>{const p=await tx.get('products','p.1');tx.update('products','p.1',{...p,recordVersion:4});await tx.get('sales','new');}),/READ_AFTER_WRITE/);
await assert.rejects(()=>transport.run(tx=>tx.get('products','other/id')),/RECORD_SCOPE_INVALID/);
await assert.rejects(()=>transport.run(async tx=>{await tx.get('products','p.1');user={uid:'other'};}),/AUTH_CHANGED/);user={uid:ownerUid};
rows.get(controlPath).storageMode='migrating';await assert.rejects(()=>transport.run(()=>{}),/CUTOVER_NOT_VERIFIED/);rows.get(controlPath).storageMode='modular';
assert.throws(()=>globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({...input,projectId:'click-360'}),/NONPRODUCTION_ONLY/);
reads=[];await transport.run(async tx=>{await tx.get('products','p.1');await tx.get('products','p.1');});assert.equal(reads.length,2);
reads=[];await transport.run(async tx=>Promise.all([tx.get('products','p.1'),tx.get('products','p.1')]));
assert.equal(reads.length,2,'Concurrent same-record reads share one authoritative load');
const bounded=globalThis.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({...input,maxRecords:2});
await assert.rejects(bounded.run(tx=>Promise.all(['one','two','three'].map(id=>tx.get('products',id)))),/RECORD_BUDGET/);
let leaked;await transport.run(tx=>{leaked=tx;});await assert.rejects(()=>leaked.get('products','p.1'),/SCOPE_EXPIRED/);
assert.equal(commits,2);
let pageFault=null,requestedPageSize=0;
db.collection=path=>{
  let size=50,cursor=null;
  const query={orderBy:field=>{assert.equal(field,'__name__');return query;},
    limit:n=>{size=n;requestedPageSize=n;return query;},startAfter:id=>{cursor=id;return query;},
    get:async options=>{
      assert.deepEqual(options,{source:'server'});
      const docs=[...rows].filter(([key])=>key.startsWith(`${path}/`)).map(([key,value])=>({
        id:key.slice(path.length+1),ref:{path:key},data:()=>value})).sort((a,b)=>a.id<b.id?-1:1)
        .filter(row=>cursor===null||row.id>cursor).slice(0,size);
      if(pageFault==='scope'&&docs[0])docs[0].ref.path='businesses/foreign/products/p.1';
      if(pageFault==='identity'&&docs[0]){const old=docs[0].data();docs[0].data=()=>({...old,businessId:'foreign'});}
      if(pageFault==='auth')user={uid:'changed'};
      return {docs,metadata:{fromCache:pageFault==='cache',hasPendingWrites:pageFault==='pending'}};
    }};
  return query;
};
const firstPage=await transport.readPage('products',{limit:1});
assert.equal(requestedPageSize,1);assert.equal(firstPage.records[0].stock,0);assert.equal(firstPage.nextCursor,'p.1');
assert.deepEqual((await transport.readPage('products',{limit:1,afterId:firstPage.nextCursor})).records,[]);
for(const n of [0,101,1.5])await assert.rejects(()=>transport.readPage('products',{limit:n}),/PAGE_CONFIGURATION/);
await assert.rejects(()=>transport.readPage('products',{afterId:'other/path'}),/RECORD_SCOPE/);
for(const [fault,reason] of [['cache',/NOT_SERVER_CONFIRMED/],['pending',/NOT_SERVER_CONFIRMED/],
  ['scope',/PAGE_SCOPE/],['identity',/RECORD_IDENTITY/],['auth',/AUTH_CHANGED/]]){
  pageFault=fault;await assert.rejects(()=>transport.readPage('products'),reason);user={uid:ownerUid};
}
pageFault=null;assert.equal(commits,2);
console.log('PASS bounded server pagination: scope/cursor/size, native codec, cache/pending rejection and auth changes; no writes');
console.log('PASS bounded Spark transaction transport: codec integration, read-before-write, atomic validation, native timestamps, CAS, auth/scope/phase gates, constant record reads. Synthetic transport only; no operational Rules certification claimed.');
