import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDocFromServer,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:48944')throw Error('EXACT_SPARK_DEMO_EMULATOR_REQUIRED');
const projectId='demo-click360-spark-modular',owner='recovery-owner',other='recovery-other';
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:48944,rules:await readFile('firestore.spark.rules','utf8')}});
try{
  await env.withSecurityRulesDisabled(async c=>{
    for(const uid of [owner,other])await setDoc(doc(c.firestore(),`approvedUsers/${uid}`),{uid,ownerId:uid,approved:true,status:'active',role:'owner',isOwner:true});
    await setDoc(doc(c.firestore(),'storageRollout/sparkV1'),{enabled:true,automaticRecoveryCopy:true,pilotOwnerUids:[owner]});
  });
  const db=env.authenticatedContext(owner).firestore(),foreign=env.authenticatedContext(other).firestore(),worker=env.authenticatedContext('recovery-worker').firestore();
  const hash='a'.repeat(64),path=`businesses/${owner}/recoveryCopies/${hash}`;
  const manifest={ownerUid:owner,captureHash:hash,schemaVersion:2,sourceHash:'b'.repeat(64),journalHash:'c'.repeat(64),
    deviceRevision:'device-42',deviceId:'device',buildSha:'21409a1d2dc7',payloadBytes:100,partCount:1,state:'UPLOADING',createdAt:serverTimestamp(),remoteRevision:41,remoteHash:'f'.repeat(64)};
  const part={ownerUid:owner,captureHash:hash,schemaVersion:2,position:0,content:'synthetic',contentHash:'d'.repeat(64)};
  await assertFails(setDoc(doc(db,path),{...manifest,state:'CLIENT_VERIFIED'}));
  await assertFails(setDoc(doc(foreign,path),manifest));
  await assertFails(setDoc(doc(worker,path),manifest));
  await setDoc(doc(db,path),manifest);
  await assertFails(setDoc(doc(db,`${path}/parts/p0`),{...part,ownerUid:other}));
  await assertFails(setDoc(doc(db,`${path}/parts/p1`),{...part,position:1}));
  await assertFails(setDoc(doc(db,`${path}/parts/wrong-id`),part));
  await assertFails(setDoc(doc(db,`${path}/parts/p0`),{...part,content:'x'.repeat(48001)}));
  await setDoc(doc(db,`${path}/parts/p0`),part);
  await assertFails(updateDoc(doc(db,`${path}/parts/p0`),{content:'mutated'}));
  await assertFails(deleteDoc(doc(db,`${path}/parts/p0`)));
  for(const actor of [foreign,worker,env.unauthenticatedContext().firestore()]){
    await assertFails(getDocFromServer(doc(actor,path)));
    await assertFails(getDocFromServer(doc(actor,`${path}/parts/p0`)));
  }
  await assertFails(updateDoc(doc(db,path),{state:'CLIENT_VERIFIED',clientVerifiedAt:serverTimestamp(),sourceHash:'e'.repeat(64)}));
  await updateDoc(doc(db,path),{state:'CLIENT_VERIFIED',clientVerifiedAt:serverTimestamp()});
  assert.equal((await getDocFromServer(doc(db,path))).data().state,'CLIENT_VERIFIED');
  await assertFails(updateDoc(doc(db,path),{state:'UPLOADING'}));
  await assertFails(deleteDoc(doc(db,path)));
  const notPiloted=`businesses/${other}/recoveryCopies/${hash}`;
  await assertFails(setDoc(doc(foreign,notPiloted),{...manifest,ownerUid:other}));
  await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'storageRollout/sparkV1'),{automaticRecoveryCopy:false}));
  const next='e'.repeat(64);
  await assertFails(setDoc(doc(db,`businesses/${owner}/recoveryCopies/${next}`),{...manifest,captureHash:next}));
  // This label is explicitly CLIENT verified. Rules isolate and make parts
  // immutable; they cannot calculate SHA-256 or prove complete reconstruction.
  // The PWA must independently reread every part, never trust this flag alone.
  console.log(JSON.stringify({status:'PASS',realWebSDK:true,ownerOnly:true,tenantIsolation:true,workerDenied:true,
    privateParts:true,immutable:true,explicitPilotRequired:true,noOperationalControlWrites:true,serverVerified:false}));
}finally{await env.cleanup();}
