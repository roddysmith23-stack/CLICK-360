import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDocFromServer as getDoc,setDoc,updateDoc,deleteDoc,serverTimestamp,writeBatch} from 'firebase/firestore';
import './spark-modular-migration.js';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular';
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules:await readFile('firestore.spark.rules','utf8')}});
const owner='spark-owner',business='business-alpha',other='spark-other',worker='spark-worker';
const api=globalThis.CLICK360_SPARK_MIGRATION;
const identity={ownerUid:owner,ownerId:owner,businessId:owner,tenantKey:`owner:${owner}:business:${owner}`,schemaVersion:10};
const state={identity,businesses:[{id:business,name:'Synthetic'}],products:[{id:'p-one',businessId:business,stock:2,qty:2,name:'P',price:30}],sales:[],movements:[],cashSessions:[],invoices:[],dailyReports:[],deletedProducts:[],auditLogs:[],settings:{workers:[],labelTemplates:[]}};
const rootState={...identity,revision:12,payload:{schemaVersion:10,identity,data:state}};
const ownerDb=env.authenticatedContext(owner,{email:'synthetic-owner@example.test'}).firestore();
const otherDb=env.authenticatedContext(other,{email:'synthetic-other@example.test'}).firestore();
const workerDb=env.authenticatedContext(worker,{email:'synthetic-worker@example.test'}).firestore();
const anonymousDb=env.unauthenticatedContext().firestore();
const controlPath=`businesses/${owner}/metadata/storage`;
const manifest=await api.plan({ownerUid:owner,snapshot:state,remoteRevision:12,deviceRevision:'device-12'});
const newControl=()=>({ownerUid:owner,schemaVersion:2,storageMode:'migrating',phase:'MIGRATION_PREPARING',
  sourceHash:manifest.sourceHash,remoteHash:manifest.sourceHash,remoteRevision:12,deviceRevision:'device-12',
  sourceDeviceId:'synthetic-device',businessIds:[business],recordCount:manifest.recordCount,
  payloadBytes:manifest.payloadBytes,recordVersion:1,semanticEquality:'PENDING',reconstructedHash:'',
  buildSha:'0123456789ab',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:owner});
try{
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const uid of [owner,other])await setDoc(doc(db,`approvedUsers/${uid}`),{uid,ownerId:uid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(db,`businesses/${owner}/state/main`),rootState);
    await setDoc(doc(db,`approvedUsers/${worker}`),{uid:worker,ownerId:owner,approved:true,status:'active',role:'cashier',isOwner:false,businessUnitId:business});
    await setDoc(doc(db,`businesses/${owner}/members/${worker}`),{uid:worker,ownerId:owner,businessId:owner,tenantKey:`owner:${owner}:business:${owner}`,status:'active',role:'cashier'});
    await setDoc(doc(db,'storageRollout/sparkV1'),{enabled:true,pilotOwnerUids:[owner]});
  });
  await assertSucceeds(updateDoc(doc(ownerDb,`businesses/${owner}/state/main`),{revision:12}));
  await assertFails(setDoc(doc(otherDb,controlPath),newControl()));
  await assertFails(setDoc(doc(workerDb,controlPath),newControl()));
  await assertFails(setDoc(doc(anonymousDb,controlPath),newControl()));
  await assertFails(setDoc(doc(ownerDb,controlPath),{...newControl(),remoteRevision:11}));
  await assertFails(setDoc(doc(otherDb,`businesses/${other}/metadata/storage`),{...newControl(),ownerUid:other,updatedBy:other}));
  const mixedBatch=writeBatch(ownerDb);
  mixedBatch.set(doc(ownerDb,controlPath),newControl());
  mixedBatch.update(doc(ownerDb,`businesses/${owner}/state/main`),{revision:13});
  await assertFails(mixedBatch.commit());
  assert.equal((await getDoc(doc(ownerDb,`businesses/${owner}/state/main`))).data().revision,12);
  await assertSucceeds(setDoc(doc(ownerDb,controlPath),newControl()));
  await assertFails(updateDoc(doc(ownerDb,`businesses/${owner}/state/main`),{revision:13}));
  await assertFails(updateDoc(doc(ownerDb,controlPath),{phase:'MODULAR',storageMode:'modular',recordVersion:2,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(ownerDb,controlPath),{sourceHash:'b'.repeat(64),recordVersion:2,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(ownerDb,controlPath),{phase:'SHADOW_WRITING',recordVersion:2,updatedAt:serverTimestamp()}));
  const product=manifest.records.find(row=>row.content.module==='products');
  await assertFails(setDoc(doc(ownerDb,product.path),{...product.content,ownerUid:other}));
  await assertFails(setDoc(doc(ownerDb,product.path),{...product.content,sourceHash:'f'.repeat(64)}));
  await assertFails(setDoc(doc(ownerDb,product.path),{...product.content,extraField:'not-allowed'}));
  await assertFails(setDoc(doc(workerDb,product.path),product.content));
  await assertFails(setDoc(doc(otherDb,product.path),product.content));
  for(const row of manifest.records)await assertSucceeds(setDoc(doc(ownerDb,row.path),row.content));
  await assertFails(updateDoc(doc(ownerDb,product.path),{'data.stock':999}));
  await assertFails(deleteDoc(doc(ownerDb,product.path)));
  await assertFails(getDoc(doc(otherDb,product.path)));
  await assertFails(getDoc(doc(workerDb,product.path)));
  await assertFails(getDoc(doc(anonymousDb,product.path)));
  const reread=[];
  for(const row of manifest.records){const snap=await assertSucceeds(getDoc(doc(ownerDb,row.path)));assert.equal(snap.metadata.fromCache,false);reread.push({path:row.path,content:snap.data()});}
  const verified=await api.compare({manifest,remoteRecords:reread,source:state});
  assert.equal(verified.status,'SEMANTIC_EQUALITY_PASS');
  await assertSucceeds(updateDoc(doc(ownerDb,controlPath),{phase:'SHADOW_VERIFYING',recordVersion:3,updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(ownerDb,controlPath),{phase:'READY_TO_CUTOVER',recordVersion:4,semanticEquality:'PASS',reconstructedHash:manifest.sourceHash,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(ownerDb,controlPath),{phase:'MODULAR',storageMode:'modular',recordVersion:5,reconstructedHash:'f'.repeat(64),updatedAt:serverTimestamp()}));
  await assertSucceeds(updateDoc(doc(ownerDb,controlPath),{phase:'MODULAR',storageMode:'modular',recordVersion:5,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(ownerDb,`businesses/${owner}/state/main`),{revision:13}));
  await assertFails(updateDoc(doc(ownerDb,controlPath),{phase:'LEGACY',storageMode:'legacy',recordVersion:6,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(ownerDb,controlPath)));
  assert.deepEqual((await getDoc(doc(ownerDb,`businesses/${owner}/state/main`))).data(),rootState);
  console.log(JSON.stringify({status:'PASS',projectId,clientRules:true,synthetic:true,semanticEquality:verified.status,sourceHash:verified.sourceHash,reconstructedHash:verified.reconstructedHash,scenarios:['owner-only shadow','cross-owner denied','worker denied','unauth denied','strict revision','phase ordering','immutable shadow','field allowlist','fresh remote reread','hash mismatch','old PWA legacy fence','no old snapshot rollback'],productionWrites:0}));
}finally{await env.cleanup();}
