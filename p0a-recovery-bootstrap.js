(function(root){
  'use strict';
  // P0A only: no importer, operational writer, replay or cutover exists here.
  function create({db,firebase,projectId,ownerUid,actorUid,deviceId,buildSha,
    resolveUser,resolveContext,readLocal,leaseHeld,onProgress=()=>{},productionRecoveryOnly=false}){
    if((!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
        &&!(projectId==='click-360'&&productionRecoveryOnly===true))
      ||db.app?.options?.projectId!==projectId)throw Error('SPARK_MIGRATION_BOOTSTRAP_NONPRODUCTION_ONLY');
    const api=root.CLICK360_P0A_CANONICAL;
    function context(){
      const c=resolveContext();
      if(actorUid!==ownerUid||resolveUser()?.uid!==ownerUid||c?.authUid!==ownerUid
        ||(c.ownerUid||c.ownerId)!==ownerUid||leaseHeld()!==true)
        throw Error('SPARK_MIGRATION_BOOTSTRAP_CONTEXT_CHANGED');
    }
    async function server(ref){
      context();const s=await ref.get({source:'server'});context();
      if(s.metadata?.fromCache!==false||s.metadata?.hasPendingWrites!==false)
        throw Error('SPARK_MIGRATION_BOOTSTRAP_SERVER_REQUIRED');
      return s;
    }
    async function prepare(){
      context();
      if(root.document&&['app.js','firebase-service.js','v16-storage.js','p0a-canonical.js','p0a-journal-reader.js','p0a-recovery-store.js','p0a-recovery-bootstrap.js'].some(file=>root.CLICK360_RELEASE_ASSETS?.[file]!==buildSha))throw Error('SPARK_MIGRATION_MIXED_BUILD_STOP');
      const rollout=await server(db.doc('storageRollout/sparkV1')),policy=rollout.data();
      // A server-managed, explicit shadow flag is separate from operational
      // eligibility. Existing pilots do not silently acquire migration writes.
      if(!rollout.exists||policy.enabled!==true||(policy.automaticShadow!==true&&policy.automaticRecoveryCopy!==true)
        ||!Array.isArray(policy.pilotOwnerUids)||!policy.pilotOwnerUids.includes(ownerUid))return {prepared:false};
      if(policy.automaticRecoveryCopy!==true||policy.automaticShadow!==false)return {prepared:false};
      let journal,recovery;
      try{
        const local=await readLocal();context();
        if(local?.source==='spark_operational_candidate')throw Error('SPARK_MIGRATION_OPERATIONAL_SOURCE_STOP');
        // Require an existing durable snapshot; never seed a business from an
        // empty initial UI or infer freshness from a clock or a clean label.
        if(!local?.snapshot||!local.deviceRevision)throw Error('SPARK_MIGRATION_DURABLE_SOURCE_REQUIRED');
        const pinnedHash=await api.hash(local.snapshot),deviceRevision=local.deviceRevision;
        const assertStable=async()=>{
          context();const now=await readLocal();context();
          if(now?.deviceRevision!==deviceRevision||await api.hash(now.snapshot)!==pinnedHash)
            throw Error('SPARK_MIGRATION_DEVICE_DRIFT_STOP');
        };
        const readSource=async()=>{
          await assertStable();const remote=await server(db.doc(`businesses/${ownerUid}/state/main`));
          if(!remote.exists)throw Error('SPARK_MIGRATION_LEGACY_SOURCE_REQUIRED');
          const r=remote.data();
          return {remote:{source:'server',revision:r.revision,identity:r.payload?.identity,snapshot:r.payload?.data},
            local:{durable:true,snapshot:local.snapshot,identity:local.identity||local.snapshot.identity,
              deviceRevision,baseRevision:local.baseRevision,pendingRemoteSync:local.pendingRemoteSync,
              cloudCapacityBlocked:local.cloudCapacityBlocked,pendingOperations:local.pendingOperations||[]},unknownOperations:0};
        };
        // Preserve the original device record and ENTIRE owner journal before
        // source selection or UNKNOWN reconciliation can reject migration.
        // This copy grants no retry, ledger confirmation or cutover authority.
        journal=await root.CLICK360_P0A_JOURNAL.open();
        recovery=await root.CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser});
        const device=await recovery.deviceIdentity(deviceId);context();
        if(device?.durable!==true||device.ownerUid!==ownerUid||!device.deviceId)throw Error('SPARK_MIGRATION_DURABLE_DEVICE_ID_REQUIRED');
        const journalCapture=await journal.captureOwner(ownerUid);await assertStable();
        let deviceCapture=await recovery.captureDevice({record:local,journalCapture,deviceId:device.deviceId,buildSha});
        context();
        onProgress({phase:'DEVICE_RECOVERY_CAPTURED',captureHash:deviceCapture.captureHash,operationalCloudConfirmed:false});
        if(policy.automaticRecoveryCopy===true){
          // Preserve locally FIRST, then attach a fresh independent server
          // reference. An unavailable remote never prevents that local pin.
          const source=await readSource(),r=source.remote,i=r.identity;
          if(i?.ownerUid!==ownerUid||i?.ownerId!==ownerUid||i?.businessId!==ownerUid
            ||i?.tenantKey!==`owner:${ownerUid}:business:${ownerUid}`||i?.schemaVersion!==10
            ||!Number.isSafeInteger(r.revision)||r.revision<0||!r.snapshot)throw Error('P0A_REMOTE_IDENTITY_REQUIRED');
          const remote={remoteRevision:r.revision,remoteHash:await api.hash(r.snapshot)};
          deviceCapture=await recovery.captureDevice({record:local,journalCapture,deviceId:device.deviceId,buildSha,
            remoteReference:{source:'server',revision:remote.remoteRevision,hash:remote.remoteHash}});
          onProgress({phase:'RECOVERY_COPY_UPLOADING',captureHash:deviceCapture.captureHash,operationalCloudConfirmed:false});
          const copy=await recovery.preserveCloud({captureHash:deviceCapture.captureHash,db,firebase,projectId,productionRecoveryOnly,assertStable:async()=>{
            await assertStable();
            if(await api.hash(await journal.captureOwner(ownerUid))!==await api.hash(journalCapture))
              throw Error('SPARK_MIGRATION_OUTBOX_CHANGED_STOP');
          }});
          context();onProgress({phase:copy.status,...copy});
          if(productionRecoveryOnly||policy.automaticShadow!==true)return {prepared:false,recoveryCopy:copy,operationalCloudConfirmed:false};
        }
        return {prepared:false,operationalCloudConfirmed:false};
      }finally{journal?.close();recovery?.close();}
    }
    return Object.freeze({prepare});
  }
  root.CLICK360_P0A_BOOTSTRAP=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);

