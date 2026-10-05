(function(root){
  'use strict';
  let running=false, timer, phase='IDLE', lastFailurePhase=null, confirmedContextId=null, verifiedSourceKey=null, statusContextId=null;
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  function bounded(promise){
    let timeout;
    return Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(new Error('Backup network deadline.'),{code:'backup-network-timeout'})),25000);})])
      .finally(()=>clearTimeout(timeout));
  }
  function publish(status, detail={}){
    root.click360CloudSafetyStatus=Object.freeze({status,...detail});
    root.dispatchEvent(new CustomEvent('click360-cloud-safety-status',{detail:root.click360CloudSafetyStatus}));
  }
  async function run(){
    if(running)return false;
    const api=root.CLICK360_CLOUD_SAFETY,storage=root.CLICK360_V16_STORAGE;
    const context=root.click360TenantContext;
    if(!api||!storage||!context||!root.firebase?.apps?.length)return false;
    const auth=root.firebase.auth(),user=auth.currentUser;
    // The existing durable legacy snapshot is owner scoped. Never expose its
    // sibling businesses to a worker by weakening this authorization boundary.
    if(!user||user.uid!==context.authUid||user.uid!==context.ownerId)return false;
    statusContextId=storage.contextId(context);
    const assertIdentity=()=>{
      const active=root.click360TenantContext;
      if(auth.currentUser?.uid!==user.uid||active?.authUid!==context.authUid
        ||active?.tenantKey!==context.tenantKey||active?.businessId!==context.businessId)fail('backup-auth-context-changed');
    };
    running=true;
    try{
      phase='READING_DURABLE';
      assertIdentity();
      const record=await storage.getSnapshot(context);
      if(!record)return false;
      const capacity=root.click360GetCapacityStatus?.() || {};
      const legacyBlocked=record.cloudCapacityBlocked || capacity.cloudCapacityBlocked
        || new TextEncoder().encode(api.json(record.snapshot)).length>Number(capacity.cloudLimitBytes||850000);
      if(!legacyBlocked)return false;
      if(root.click360GetCapacityStatus?.().deviceSavePending)return false;
      phase='HASHING';const sourceKey=await api.sha(api.json(record));
      const previous=await storage.getSafetyMetadata(context);
      if(previous?.sourceKey===sourceKey&&previous.status==='COMPLETE'
        && (!root.navigator.onLine||(verifiedSourceKey===sourceKey&&confirmedContextId===storage.contextId(context)))){
        assertIdentity();
        confirmedContextId=storage.contextId(context);
        publish('CONFIRMED',{payloadSha256:sourceKey,backupId:previous.backupId,completedAt:previous.completedAt});return true;
      }
      publish('PENDING');
      if(!root.navigator.onLine)return false;
      const buildSha=root.CLICK360_RUNTIME_GUARD?.getReleaseMetadata?.().buildSha;
      phase='ALLOCATING_CAPTURE';const allocated=await storage.allocateSafetyMetadata(context,record,sourceKey);
      phase='PREPARING';
      const prepared=await api.prepare(context,record,{buildSha,deviceId:allocated.deviceId,sequence:allocated.sequence});
      assertIdentity();publish('UPLOADING',{payloadBytes:prepared.manifest.payloadBytes});
      const db=root.firebase.firestore(),backups=db.collection('businesses').doc(user.uid).collection('safetyBackups');
      const read=async ref=>{assertIdentity();const value=await bounded(ref.get({source:'server'}));assertIdentity();return value.exists?value.data():null;};
      const transport={
        getManifest:id=>{phase='READING_MANIFEST';return read(backups.doc(id));},
        getPart:(id,part)=>{phase='READING_PART';return read(backups.doc(id).collection('parts').doc(part));},
        getParts:async id=>{phase='READING_PARTS';assertIdentity();const parts=await bounded(backups.doc(id).collection('parts').get({source:'server'}));assertIdentity();return parts.docs.map(d=>d.data());},
        begin:async manifest=>{
          assertIdentity();const ref=backups.doc(manifest.backupId);
          phase='CREATING_MANIFEST';await bounded(db.runTransaction(async tx=>{
            assertIdentity();const existing=await tx.get(ref);
            if(existing.exists){
              const prior=existing.data();
              for(const key of Object.keys(manifest))if(api.json(prior[key])!==api.json(manifest[key]))fail('backup-immutable-manifest-conflict');
              return;
            }
            tx.set(ref,{...manifest,status:'UPLOADING',createdAt:root.firebase.firestore.FieldValue.serverTimestamp()});
          }));
        },
        createPart:async(id,part)=>{
          assertIdentity();const ref=backups.doc(id).collection('parts').doc(part.id);
          phase='CREATING_PART';await bounded(db.runTransaction(async tx=>{
            assertIdentity();const prior=await tx.get(ref);
            if(prior.exists){if(api.json(prior.data())!==api.json(part))fail('backup-immutable-part-conflict');return;}
            tx.set(ref,part);
          }));
        },
        complete:async backupId=>{
          phase='SERVER_VERIFY';
          assertIdentity();const token=await bounded(user.getIdToken());assertIdentity();
          const project=root.firebase.app().options.projectId;
          if(!/^[a-z0-9-]+$/.test(project))fail('backup-project-invalid');
          let response;
          try{
            response=await bounded(root.fetch(`https://us-central1-${project}.cloudfunctions.net/finalizeCloudSafetyBackup`,{
              method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({data:{backupId}})
            }));
          }catch(error){
            // The uploader still reconciles server completion before retrying.
            // Do not leak URLs/tokens through the human support diagnostic.
            throw Object.assign(new Error('Safety backup transport unavailable.'),{code:error.code||'backup-network-unavailable',backupPhase:'SERVER_VERIFY'});
          }
          assertIdentity();let data;
          try{data=await bounded(response.json());}catch(error){throw Object.assign(new Error('Safety backup response unconfirmed.'),{code:error.code||'backup-response-invalid',backupPhase:'SERVER_VERIFY'});}
          if(!response.ok||data.error)fail('backup-server-verification-rejected');
          return data.result;
        }
      };
      phase='UPLOADING';const confirmed=await api.upload(prepared,transport);assertIdentity();
      // Completion of an OLD capture cannot label a NEW local state protected.
      phase='CONFIRMING';const current=await storage.getSnapshot(context);
      if(!current||await api.sha(api.json(current))!==sourceKey){publish('PENDING');schedule();return false;}
      const completedAt=confirmed.completedAt?.toDate?.().toISOString() || confirmed.completedAt;
      if(!await storage.confirmSafetyMetadata(context,sourceKey,{...confirmed,completedAt},current))fail('backup-local-confirmation-stale');
      assertIdentity();
      confirmedContextId=storage.contextId(context);
      verifiedSourceKey=sourceKey;
      publish('CONFIRMED',{payloadSha256:sourceKey,backupId:confirmed.backupId,payloadBytes:confirmed.payloadBytes,completedAt});
      return true;
    }catch(error){
      lastFailurePhase=error.backupPhase||phase;
      publish('PENDING',{errorCode:String(error.code||'backup-pending').slice(0,80)});return false;
    }finally{running=false;phase='IDLE';}
  }
  // Leading-edge bounded scheduling: frequent access/health notifications must
  // not keep postponing protection of an already-existing durable snapshot.
  function schedule(){if(timer)return;timer=setTimeout(()=>{timer=null;run();},1500);}
  root.click360RunCloudSafetyBackup=run;
  root.click360GetCloudSafetyHealth=()=>({phase,lastFailurePhase,running,status:root.click360CloudSafetyStatus?.status||'PENDING',errorCode:root.click360CloudSafetyStatus?.errorCode||null});
  for(const event of ['click360-local-state-saved','online']){
    root.addEventListener(event,()=>{publish('PENDING');schedule();});
  }
  root.addEventListener('click360-access-changed',()=>{
    const context=root.click360TenantContext;
    const next=context?root.CLICK360_V16_STORAGE?.contextId(context):null;
    if(next!==statusContextId){statusContextId=next;publish('PENDING');}
    schedule();
  });
  root.document.addEventListener('visibilitychange',()=>{if(!root.document.hidden)schedule();});
  setInterval(schedule,60000);schedule();
})(window);
