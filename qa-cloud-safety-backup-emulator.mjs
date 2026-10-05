import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
import './cloud-safety-backup.js';
const projectId='demo-click360-p0-rules';
assert(process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:'),'Emulator confinement required');
const requireFunctions=createRequire(new URL('./functions/package.json',import.meta.url));
const {initializeApp,deleteApp}=requireFunctions('firebase-admin/app');
const {getFirestore}=requireFunctions('firebase-admin/firestore');
const verifier=requireFunctions('./safety-verifier.cjs');
const adminApp=initializeApp({projectId},'synthetic-safety-verifier');
const db=getFirestore(adminApp),api=globalThis.CLICK360_CLOUD_SAFETY;
const env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
try{
  const owner='synthetic-safety-owner',other='synthetic-safety-other',worker='synthetic-safety-worker';
  await env.withSecurityRulesDisabled(async c=>{
    for(const uid of [owner,other])await setDoc(doc(c.firestore(),`approvedUsers/${uid}`),{uid,role:'owner',isOwner:true,ownerId:uid,status:'active',approved:true});
    await setDoc(doc(c.firestore(),`approvedUsers/${worker}`),{uid:worker,role:'worker',isOwner:false,ownerId:owner,status:'active',approved:true});
  });
  const context={authUid:owner,ownerId:owner,businessId:owner,tenantKey:`owner:${owner}:business:${owner}`};
  const record={...context,schemaVersion:10,deviceRevision:'op-safe',baseRevision:42,pendingOperations:['op-safe'],snapshot:{identity:{ownerUid:owner,tenantKey:context.tenantKey},businesses:[{id:'alpha'},{id:'beta'}],products:[{id:'p',businessId:'alpha',stock:17}],sales:[],movements:[],settings:{padding:'x'.repeat(900000)}}};
  const prepared=await api.prepare(context,record,{deviceId:'device-safety-a',sequence:2,buildSha:'21409a1d2dc7'});
  const path=`businesses/${owner}/safetyBackups/${prepared.manifest.backupId}`;
  const client=env.authenticatedContext(owner).firestore(),cross=env.authenticatedContext(other).firestore(),staff=env.authenticatedContext(worker).firestore();
  const ref=doc(client,path),manifest={...prepared.manifest,status:'UPLOADING',createdAt:serverTimestamp()};
  await assertFails(setDoc(doc(cross,path),manifest));
  await assertSucceeds(setDoc(ref,manifest));
  await assertFails(getDoc(doc(cross,path)));await assertFails(getDoc(doc(staff,path)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),path)));
  await assertFails(updateDoc(ref,{status:'COMPLETE',completedAt:serverTimestamp()}));
  await assertFails(deleteDoc(ref));
  await assert.rejects(verifier.complete(db,owner,prepared.manifest.backupId));
  for(const part of prepared.chunks)await assertSucceeds(setDoc(doc(client,`${path}/parts/${part.id}`),part));
  await assertFails(setDoc(doc(client,`${path}/parts/undeclared-part`),{...prepared.chunks[0],id:'undeclared-part'}));
  const partRef=doc(client,`${path}/parts/${prepared.chunks[0].id}`);
  await assertFails(updateDoc(partRef,{text:'corrupt'}));await assertFails(deleteDoc(partRef));
  await assertFails(setDoc(doc(client,`${path}/parts/wrong-scope`),{...prepared.chunks[0],id:'wrong-scope',scopeId:'not-a-business'}));
  const result=await verifier.complete(db,owner,prepared.manifest.backupId);
  assert.equal(result.status,'COMPLETE');assert.equal(result.payloadSha256,prepared.manifest.payloadSha256);
  assert.deepEqual((await verifier.verify(db,owner,prepared.manifest.backupId)).reconstructed,record);
  assert.deepEqual(await verifier.complete(db,owner,prepared.manifest.backupId),result);
  let receiptReads=0;
  const receiptDb={doc:()=>({get:async()=>{receiptReads++;return db.doc(path).get();}})};
  assert.deepEqual(await verifier.complete(receiptDb,owner,prepared.manifest.backupId),result);
  assert.equal(receiptReads,1,'Confirmed retry must not reread chunks or rerun retention');
  await assertFails(setDoc(doc(client,`${path}/parts/late-part`),{...prepared.chunks[0],id:'late-part'}));
  await assert.rejects(verifier.complete(db,other,prepared.manifest.backupId));
  const old=await api.prepare(context,{...record,deviceRevision:'older',snapshot:{...record.snapshot,settings:{padding:'old'}}},{deviceId:'device-safety-a',sequence:1,buildSha:'21409a1d2dc7'});
  const oldPath=`businesses/${owner}/safetyBackups/${old.manifest.backupId}`;
  await setDoc(doc(client,oldPath),{...old.manifest,status:'UPLOADING',createdAt:serverTimestamp()});
  for(const part of old.chunks)await setDoc(doc(client,`${oldPath}/parts/${part.id}`),part);
  await verifier.complete(db,owner,old.manifest.backupId);
  assert.equal((await db.doc(`businesses/${owner}/safetyBackupHeads/device-safety-a`).get()).data().backupId,prepared.manifest.backupId);
  // Real versions, not synthetic duplicate "history". Keep >=3 per business;
  // another device's head remains pinned even when much older.
  const secondDevice=await api.prepare(context,{...record,deviceRevision:'device-b-local-only'},{deviceId:'device-safety-b',sequence:1,buildSha:'21409a1d2dc7'});
  async function uploadVersion(version){
    const destination=`businesses/${owner}/safetyBackups/${version.manifest.backupId}`;
    await setDoc(doc(client,destination),{...version.manifest,status:'UPLOADING',createdAt:serverTimestamp()});
    for(const part of version.chunks)await setDoc(doc(client,`${destination}/parts/${part.id}`),part);
    await verifier.complete(db,owner,version.manifest.backupId);
  }
  await uploadVersion(secondDevice);
  for(let sequence=3;sequence<=6;sequence++){
    const version=await api.prepare(context,{...record,deviceRevision:`new-${sequence}`,snapshot:{...record.snapshot,settings:{version:sequence}}},{deviceId:'device-safety-a',sequence,buildSha:'21409a1d2dc7'});
    await uploadVersion(version);
  }
  const retained=await db.collection(`businesses/${owner}/safetyBackups`).where('status','==','COMPLETE').get();
  assert.equal(retained.size,4,'Three recent versions plus older other-device head');
  assert(retained.docs.some(doc=>doc.id===secondDevice.manifest.backupId),'Other-device local-only data stays pinned');
  for(const business of ['alpha','beta'])assert(retained.docs.filter(doc=>doc.data().businessIds.includes(business)).length>=3);
  assert.equal((await db.doc(`businesses/${owner}/state/main`).get()).exists,false,'Backup must never create or modify legacy commercial state');
  console.log('PASS real client Rules: privacy, tenant/worker denial, immutable manifests/parts, server-only COMPLETE; server reconstruction, retry, late old head fence, no commercial writes');
}finally{await env.cleanup();await deleteApp(adminApp);}
