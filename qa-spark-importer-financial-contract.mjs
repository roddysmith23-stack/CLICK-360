import assert from 'node:assert/strict';
import './spark-modular-migration.js';
import './spark-modular-importer.js';
const api=globalThis.CLICK360_SPARK_MIGRATION;
const ownerUid='financial-import-owner',businessId='financial-business';
const identity={ownerUid,ownerId:ownerUid,businessId:ownerUid,tenantKey:`owner:${ownerUid}:business:${ownerUid}`,schemaVersion:10};
function fixture({unverified=false,corruptMetadata=false}={}){
  const snapshot={businesses:[{id:businessId}],products:[],sales:[],dailyReports:[],
    cashSessions:[{id:'session',businessId,date:'2026-09-03',status:unverified?'closed':'open',
      ...(unverified?{closedAt:'2026-09-04T01:00:00Z'}:{}),openingAmount:0,operationId:'opening'}],
    movements:[{id:'opening',businessId,cashSessionId:'session',operationId:'opening',date:'2026-09-03',kind:'apertura',amount:0}]};
  const legacy={revision:1,payload:{identity,data:structuredClone(snapshot)}};
  const rows=new Map([[`businesses/${ownerUid}/state/main`,legacy]]),pins=new Map();let activeReads=0,maxReads=0;
  const snap=path=>({exists:rows.has(path),data:()=>structuredClone(rows.get(path)),metadata:{fromCache:false,hasPendingWrites:false}});
  const db={app:{options:{projectId:'demo-click360-spark-modular'}},doc:path=>({path}),
    runTransaction:async fn=>{
      const writes=[];const value=await fn({get:async ref=>{
        activeReads++;maxReads=Math.max(maxReads,activeReads);
        try{await Promise.resolve();return snap(ref.path);}finally{activeReads--;}
      },
        set:(ref,data)=>writes.push([ref.path,structuredClone(data)]),
        update:(ref,data)=>writes.push([ref.path,{...rows.get(ref.path),...structuredClone(data)}])});
      for(const [path,data]of writes)rows.set(path,data);return value;
    },collection:scope=>{
      let after=null,pageLimit=100;
      const q={orderBy:()=>q,limit:n=>{pageLimit=n;return q;},startAfter:id=>{after=id;return q;},get:async()=>{
        const docs=[...rows].filter(([path])=>path.slice(0,path.lastIndexOf('/'))===scope)
          .sort(([a],[b])=>a.localeCompare(b)).filter(([path])=>!after||path.split('/').at(-1)>after).slice(0,pageLimit)
          .map(([path,content])=>{
            const data=structuredClone(content);
            if(corruptMetadata&&data.module==='cashSessions')delete data.historyPolicy;
            return {id:path.split('/').at(-1),ref:{path},data:()=>data};
          });
        return {docs,size:docs.length,metadata:{fromCache:false,hasPendingWrites:false}};
      }};return q;
    }};
  const input={db,projectId:db.app.options.projectId,ownerUid,deviceId:'device',buildSha:'a'.repeat(40),
    firebase:{firestore:{FieldValue:{serverTimestamp:()=>0},FieldPath:{documentId:()=> '__name__'}}},
    resolveUser:()=>({uid:ownerUid}),requireCashProof:true,
    readSource:async()=>({remote:{source:'server',revision:1,identity,snapshot:legacy.payload.data},
      local:{durable:true,identity,snapshot,deviceRevision:'device-2',baseRevision:1,pendingRemoteSync:true,pendingOperations:[]},unknownOperations:0}),
    readGuard:async()=>({ownerUid,deviceRevision:'device-2',unknownOperations:0,mutationLockHeld:true}),
    recovery:{pin:async row=>pins.set(row.sourceHash,structuredClone(row)),read:async hash=>({...pins.get(hash),durable:true})}};
  return {snapshot,rows,pins,input,maxReads:()=>maxReads,run:extra=>CLICK360_SPARK_IMPORTER.create({...input,...extra}).prepareShadow()};
}
{
  const f=fixture(),original=structuredClone(f.snapshot),result=await f.run();
  assert.equal(result.equality.status,'SEMANTIC_EQUALITY_PASS');
  const raw=f.rows.get(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/cashSessions/session`);
  assert.equal(raw.operational.saleCount,0);
  assert.equal(raw.operationalHash,await api.hash(raw.operational));
  assert.deepEqual(raw.data,original.cashSessions[0]);assert.deepEqual(f.snapshot,original);
  assert.equal(result.cutoverPerformed,false);
  assert(f.maxReads()>1&&f.maxReads()<=100,'Shadow chunk reads are concurrent but bounded, with unchanged atomic writes');
}
{
  const f=fixture({unverified:true});
  await assert.rejects(f.run(),/CASH_PROOF_REQUIRED/);
  assert.equal(f.rows.size,1,'Failed financial preflight cannot write shadow or control');
  const result=await f.run({historicalReadOnly:true});
  const raw=f.rows.get(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/cashSessions/session`);
  assert.equal(raw.historyPolicy.mode,'CLOSED_READ_ONLY');
  assert.equal(raw.historyPolicy.recordHash,await api.hash(raw.data));
  assert.equal(Object.hasOwn(raw,'operational'),false,'Unknown history is not a fabricated zero summary');
  assert.equal(result.equality.sourceHash,result.equality.reconstructedHash);
  const count=f.rows.size;await f.run({historicalReadOnly:true});assert.equal(f.rows.size,count);
}
{
  const f=fixture({unverified:true,corruptMetadata:true});
  await assert.rejects(f.run({historicalReadOnly:true}),/SHADOW_FINANCIAL_METADATA_MISMATCH/);
  assert.equal(f.rows.get(`businesses/${ownerUid}/metadata/storage`).phase,'SHADOW_VERIFYING');
  assert.equal(f.pins.size,1,'Source remains preserved after a missing remote fence');
}
console.log('PASS importer financial metadata: strict preflight, verified summaries, immutable-history opt-in, original semantic hash, remote fence verification, no cutover. Synthetic transport; client Rules tested separately.');
{
  const importer=CLICK360_SPARK_IMPORTER;
  const rows=Array.from({length:2000},(_,i)=>({path:`synthetic/products/${i}`,content:{notes:'x'.repeat(200)}}));
  const chunks=importer.shadowChunks(rows);
  assert.equal(chunks.length,20,'Small-record migration must not require 80 sequential network transactions');
  assert.deepEqual(chunks.flat(),rows,'Every source row remains present exactly once and in order');
  const large=Array.from({length:7},(_,i)=>({path:`synthetic/products/${i}`,content:{notes:'🙂'.repeat(100000)}}));
  const sized=importer.shadowChunks(large);
  for(const chunk of [...chunks,...sized]){
    assert(chunk.length<=100);
    assert(chunk.reduce((n,row)=>n+api.byteLength(row)+256,0)<=1024*1024,'UTF-8 byte bound applies to complete serialized requests');
  }
  assert(sized.length>1,'Large records cannot make an oversized combined Firestore request');
  assert.deepEqual(sized.flat(),large);
  assert.throws(()=>importer.shadowChunks([{path:'synthetic/huge',content:{notes:'x'.repeat(1024*1024)}}]),/REQUEST_RECORD_TOO_LARGE/);
}
