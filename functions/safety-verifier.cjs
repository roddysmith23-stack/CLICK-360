require('./generated/cloud-safety-backup.cjs');
const api=globalThis.CLICK360_CLOUD_SAFETY;
const {FieldValue}=require('firebase-admin/firestore');
const reject=code=>{throw Object.assign(new Error(code),{code});};
async function retainRecent(db,parent){
  // Keep three REAL complete versions per business plus EVERY device head.
  // Never manufacture historical backups or prune an unverified upload.
  // All retention deletes (parts + manifest) are atomic with current heads.
  return db.runTransaction(async tx=>{
    const [archives,heads]=await Promise.all([
      tx.get(parent.collection('safetyBackups').where('status','==','COMPLETE')),
      tx.get(parent.collection('safetyBackupHeads'))
    ]);
    const pinned=new Set(heads.docs.map(d=>d.data().backupId)),counts=new Map(),remove=[];
    const ordered=archives.docs.sort((a,b)=>b.data().completedAt.toMillis()-a.data().completedAt.toMillis()||a.id.localeCompare(b.id));
    for(const record of ordered){
      const data=record.data(),businesses=data.businessIds;
      if(!Array.isArray(businesses)||!businesses.length||data.verifiedBy!=='server-sha256-v1')continue;
      const keep=pinned.has(record.id)||businesses.some(id=>(counts.get(id)||0)<3);
      if(keep){for(const id of businesses)counts.set(id,(counts.get(id)||0)+1);}
      else if(remove.length<3)remove.push(record);
    }
    // No deletion before every query is read; <=291 writes with 96 parts each.
    const parts=await Promise.all(remove.map(record=>tx.get(record.ref.collection('parts'))));
    remove.forEach((record,index)=>{parts[index].docs.forEach(part=>tx.delete(part.ref));tx.delete(record.ref);});
    return remove.length;
  });
}
async function verify(db,ownerUid,backupId){
  if(typeof ownerUid!=='string'||!ownerUid||ownerUid.length>128||ownerUid.includes('/'))reject('invalid-owner-identity');
  if(!/^[a-f0-9]{64}$/.test(backupId||''))reject('invalid-backup-id');
  const parent=db.doc(`businesses/${ownerUid}`),ref=parent.collection('safetyBackups').doc(backupId);
  const captured=await ref.get(),manifest=captured.data();
  if(!manifest||manifest.ownerUid!==ownerUid||manifest.backupId!==backupId||manifest.partCount>96||manifest.payloadBytes>api.LIMIT+128*1024||manifest.schemaVersion!==10)reject('backup-manifest-invalid');
  const parts=await ref.collection('parts').get();
  if(parts.docs.some(d=>d.id!==d.data().id||Buffer.byteLength(JSON.stringify(d.data()))>300000))reject('backup-part-invalid');
  const reconstructed=await api.reconstruct(manifest,parts.docs.map(d=>d.data()));
  const expected=await api.sha(api.json({ownerUid,tenantKey:manifest.tenantKey,deviceId:manifest.deviceId,sequence:manifest.sequence,payloadSha256:manifest.payloadSha256}));
  if(expected!==backupId)reject('backup-id-payload-mismatch');
  return {parent,ref,manifest,reconstructed};
}
async function complete(db,ownerUid,backupId){
  const {parent,ref,manifest}=await verify(db,ownerUid,backupId);
  if(!/^[a-zA-Z0-9_-]{8,96}$/.test(manifest.deviceId)||!Number.isSafeInteger(manifest.sequence)||manifest.sequence<1)reject('backup-device-sequence-invalid');
  const head=parent.collection('safetyBackupHeads').doc(manifest.deviceId);
  await db.runTransaction(async tx=>{
    const [fresh,current]=await Promise.all([tx.get(ref),tx.get(head)]);
    const data=fresh.data();
    if(!data||data.payloadSha256!==manifest.payloadSha256||data.sequence!==manifest.sequence)reject('backup-changed-before-completion');
    if(data.status==='COMPLETE')return;
    if(data.status!=='UPLOADING')reject('backup-state-invalid');
    tx.update(ref,{status:'COMPLETE',completedAt:FieldValue.serverTimestamp(),verifiedBy:'server-sha256-v1'});
    // Per-device heads, not a false multi-device operational source of truth.
    // A late old capture must never replace a newer completed capture.
    if(!current.exists||Number(current.data().sequence)<manifest.sequence){
      tx.set(head,{backupId,sequence:manifest.sequence,businessIds:manifest.businessIds,payloadSha256:manifest.payloadSha256,completedAt:FieldValue.serverTimestamp()});
    }
  });
  const confirmed=(await ref.get()).data();
  if(confirmed.status!=='COMPLETE'||!confirmed.completedAt)reject('backup-completion-not-confirmed');
  // Retention failure must not turn a confirmed backup into a rejected save.
  // Retry is safe; it never deletes device heads or unverified snapshots.
  try{await retainRecent(db,parent);}catch{}
  return {status:'COMPLETE',backupId,payloadSha256:confirmed.payloadSha256,canonicalMaterialHash:confirmed.canonicalMaterialHash,payloadBytes:confirmed.payloadBytes,completedAt:confirmed.completedAt.toDate().toISOString()};
}
module.exports={verify,complete,retainRecent};
