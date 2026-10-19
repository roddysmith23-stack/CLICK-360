import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,writeBatch,collection,query,where,orderBy,documentId,limit,startAfter,getDocsFromServer} from 'firebase/firestore';
import './spark-modular-migration.js';
import './spark-modular-record-codec.js';
import './modular-persistence.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular',ownerUid='retail-report-owner',businessId='retail-report-business',workerUid='retail-report-worker';
const identity=CLICK360_MODULAR_PERSISTENCE.identity(ownerUid,businessId),codec=CLICK360_SPARK_RECORD_CODEC;
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules:await readFile('firestore.spark.rules','utf8')}});
const base=`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2`;
try{
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,`approvedUsers/${ownerUid}`),{uid:ownerUid,ownerId:ownerUid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(db,`businesses/${ownerUid}/featureFlags/workers`),{enabled:true});
    await setDoc(doc(db,`businesses/${ownerUid}/metadata/storage`),{ownerUid,schemaVersion:2,storageMode:'modular',phase:'MODULAR',semanticEquality:'PASS',sourceHash:'a'.repeat(64),reconstructedHash:'a'.repeat(64),businessIds:[businessId]});
    await setDoc(doc(db,`businesses/${ownerUid}/businessUnits/${businessId}/members/${workerUid}`),{
      uid:workerUid,ownerUid,businessId,tenantKey:identity.tenantKey,boundarySchemaVersion:1,status:'active',role:'supervisor',
      permissions:{sales:{read:true},movements:{read:true},cashSessions:{read:true}}});
    const batch=writeBatch(db);
    for(const moduleName of ['sales','movements'])for(let i=0;i<105;i++){
      const recordId=`record-${String(i).padStart(3,'0')}`,record={id:recordId,...identity,module:moduleName,storageSchemaVersion:2,date:'2026-09-03',recordVersion:1,
        ...(moduleName==='sales'?{total:10,received:10,balance:0,status:'paid',items:[{name:'Synthetic',qty:1}]}:{kind:'ingreso',saleId:recordId,amount:10})};
      batch.set(doc(db,`${base}/${moduleName}/${recordId}`),await codec.pack(record,{identity,moduleName,recordId}));
    }
    await batch.commit();
  });
  const dbs=[env.authenticatedContext(ownerUid).firestore(),env.authenticatedContext(workerUid).firestore()];
  const makeQuery=(db,path,after=null)=>query(collection(db,path),where('data.date','>=','2026-09-01'),where('data.date','<=','2026-09-30'),
    orderBy('data.date','desc'),orderBy(documentId(),'desc'),...(after?[startAfter(...after)]:[]),limit(100));
  for(const db of dbs)for(const moduleName of ['sales','movements']){
    let after=null,ids=[],pages=0;
    do{
      const snap=await getDocsFromServer(makeQuery(db,`${base}/${moduleName}`,after));
      assert.equal(snap.metadata.fromCache,false);assert.equal(snap.metadata.hasPendingWrites,false);pages++;
      for(const document of snap.docs){const row=await codec.unpack(document.data(),{identity,moduleName,recordId:document.id});assert.equal(row.businessId,businessId);ids.push(row.id);}
      const last=snap.docs.at(-1);after=snap.size===100?[last.data().data.date,last.id]:null;
    }while(after);
    assert.equal(pages,2);assert.equal(ids.length,105);assert.equal(new Set(ids).size,105);
  }
  await assertFails(getDocsFromServer(makeQuery(env.authenticatedContext('retail-report-outsider').firestore(),`${base}/sales`)));
  await assertFails(getDocsFromServer(makeQuery(dbs[1],`businesses/${ownerUid}/businessUnits/unauthorized-business/storage/v2/sales`)));
  console.log(JSON.stringify({status:'PASS',retailDateQueryWebSDK:true,ownerWorker:true,pages:2,recordsPerModule:105,tenantBusinessIsolation:true,commercialWrites:0}));
}finally{await env.cleanup();}
