import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInAnonymously} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,setDoc,getDocFromServer,getDocsFromServer,collection,serverTimestamp} from 'firebase/firestore';
import '../cloud-safety-backup.js';
const projectId='demo-click360-safety';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:58080');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:59099');
const requireFunctions=createRequire(new URL('../functions/package.json',import.meta.url));
const admin=requireFunctions('firebase-admin/app'),adminFirestore=requireFunctions('firebase-admin/firestore');
const adminApp=admin.initializeApp({projectId},'synthetic-safety-http'),adminDb=adminFirestore.getFirestore(adminApp);
const app=initializeApp({projectId,apiKey:'synthetic-emulator-only-key'},'synthetic-safety-http-client');
const auth=getAuth(app),db=getFirestore(app);
connectAuthEmulator(auth,'http://127.0.0.1:59099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',58080);
const endpoint=`http://127.0.0.1:55001/${projectId}/us-central1/finalizeCloudSafetyBackup`;
const buildSha=JSON.parse(await readFile('dist/release-manifest.json','utf8')).buildSha;
async function call(data,token){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({data})});
  return {status:response.status,data:await response.json()};
}
try{
  assert.equal((await call({backupId:'a'.repeat(64)})).status,401,'Unauthenticated callable denied');
  const user=(await signInAnonymously(auth)).user,owner=user.uid,token=await user.getIdToken();
  await adminDb.doc(`approvedUsers/${owner}`).set({uid:owner,ownerId:owner,role:'owner',isOwner:true,status:'active',approved:true});
  const context={authUid:owner,ownerId:owner,businessId:owner,tenantKey:`owner:${owner}:business:${owner}`};
  const api=globalThis.CLICK360_CLOUD_SAFETY;
  const record={...context,schemaVersion:10,deviceRevision:'pending-op',pendingOperations:['pending-op','unknown-op'],snapshot:{identity:{ownerUid:owner,tenantKey:context.tenantKey},businesses:[{id:'alpha'},{id:'beta'}],products:[{id:'p',businessId:'alpha',stock:19}],sales:[],movements:[],settings:{padding:'x'.repeat(900000)}}};
  const prepared=await api.prepare(context,record,{deviceId:'synthetic-http-device',sequence:1,buildSha});
  const path=`businesses/${owner}/safetyBackups/${prepared.manifest.backupId}`;
  const transport={
    getManifest:async id=>{const snap=await getDocFromServer(doc(db,`businesses/${owner}/safetyBackups/${id}`));return snap.exists()?snap.data():null;},
    getParts:async id=>(await getDocsFromServer(collection(db,`businesses/${owner}/safetyBackups/${id}/parts`))).docs.map(d=>d.data()),
    getPart:async(id,part)=>{const snap=await getDocFromServer(doc(db,`businesses/${owner}/safetyBackups/${id}/parts/${part}`));return snap.exists()?snap.data():null;},
    begin:m=>setDoc(doc(db,`businesses/${owner}/safetyBackups/${m.backupId}`),{...m,status:'UPLOADING',createdAt:serverTimestamp()}),
    createPart:(id,part)=>setDoc(doc(db,`businesses/${owner}/safetyBackups/${id}/parts/${part.id}`),part),
    complete:async id=>{const response=await call({backupId:id,ownerUid:'forged-other-owner'},token);assert.equal(response.status,200);throw Error('synthetic-lost-response-after-server-commit');}
  };
  const confirmed=await api.upload(prepared,transport);
  assert.equal(confirmed.status,'COMPLETE');assert.equal(confirmed.verifiedBy,'server-sha256-v1');
  assert.deepEqual(await api.reconstruct(confirmed,await transport.getParts(prepared.manifest.backupId)),record);
  assert.equal((await call({backupId:prepared.manifest.backupId},token)).status,200);
  assert.equal((await adminDb.doc(`businesses/${owner}/state/main`).get()).exists,false);
  const incomplete=await api.prepare(context,{...record,deviceRevision:'incomplete'},{deviceId:'synthetic-http-device',sequence:2,buildSha});
  await transport.begin(incomplete.manifest);
  assert.equal((await call({backupId:incomplete.manifest.backupId},token)).status,400);
  assert.equal((await transport.getManifest(incomplete.manifest.backupId)).status,'UPLOADING');
  assert.equal((await call({backupId:'b'.repeat(64),ownerUid:owner},token)).status,400);
  const largeRecord={...record,deviceRevision:'large-7MiB',snapshot:{...record.snapshot,
    businesses:[...record.snapshot.businesses,...Array.from({length:23},(_,i)=>({id:`enterprise-${i}`}))],settings:{padding:'x'.repeat(7*1024*1024)}}};
  const large=await api.prepare(context,largeRecord,{deviceId:'synthetic-http-device',sequence:3,buildSha});
  assert(large.chunks.every(part=>Buffer.byteLength(JSON.stringify(part))<300000));
  const largeConfirmation=await api.upload(large,transport);
  assert.deepEqual(await api.reconstruct(largeConfirmation,await transport.getParts(large.manifest.backupId)),largeRecord);
  assert.equal((await adminDb.doc(`businesses/${owner}/state/main`).get()).exists,false);
  console.log('PASS 7 MiB / Enterprise 25 businesses actual client Rules + callable/server readback: bounded documents, exact reconstruction, no legacy write');
  console.log('PASS callable HTTP + real Auth/client Rules: unauth denied, server SHA reconstruction, forged owner ignored, lost response reconciled, incomplete/missing denied, no legacy commercial writes');
}finally{await deleteApp(app);await admin.deleteApp(adminApp);}
