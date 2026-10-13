(function(root){
  'use strict';
  // Staging-only connection to the existing importer. Never activates writers,
  // changes a commercial operation, confirms journal rows or performs cutover.
  function create({db,firebase,projectId,ownerUid,actorUid,deviceId,buildSha,
    resolveUser,resolveContext,readLocal,leaseHeld,onProgress=()=>{}}){
    if(!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
      ||db.app?.options?.projectId!==projectId)throw Error('SPARK_MIGRATION_BOOTSTRAP_NONPRODUCTION_ONLY');
    const api=root.CLICK360_SPARK_MIGRATION;
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
      if(root.document&&['app.js','firebase-service.js','v16-storage.js','modular-operation-journal.js',
        'spark-modular-migration.js','spark-modular-reconciliation.js','spark-modular-recovery.js',
        'spark-modular-importer.js','spark-modular-record-codec.js','spark-migration-bootstrap.js']
        .some(file=>root.CLICK360_RELEASE_ASSETS?.[file]!==buildSha))throw Error('SPARK_MIGRATION_MIXED_BUILD_STOP');
      const rollout=await server(db.doc('storageRollout/sparkV1')),policy=rollout.data();
      // A server-managed, explicit shadow flag is separate from operational
      // eligibility. Existing pilots do not silently acquire migration writes.
      if(!rollout.exists||policy.enabled!==true||policy.automaticShadow!==true
        ||!Array.isArray(policy.pilotOwnerUids)||!policy.pilotOwnerUids.includes(ownerUid))return {prepared:false};
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
        const selected=await api.selectSource({ownerUid,...await readSource()});
        // Unscoped READ-ONLY census includes pending rows issued by a different
        // actor on this partition. They block migration, never get claimed.
        journal=await root.CLICK360_MODULAR_JOURNAL.open();
        await journal.assertOwnerCoverage(ownerUid,selected.businessIds);context();
        const reconciliations=[];
        for(const businessId of selected.businessIds){
          const identity={ownerUid,businessId};
          const reconciliation=await root.CLICK360_SPARK_RECONCILIATION.reconcileJournal({identity,journal,
            assertSourceStable:assertStable,lookupOperation:async operation=>{
              if(operation.payload?.actorUid!==ownerUid)throw Error('SPARK_MIGRATION_FOREIGN_ACTOR_STOP');
              const s=await server(db.doc(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/operationLedger/${operation.operationId}`));
              const record=s.exists?await root.CLICK360_SPARK_RECORD_CODEC.unpack(s.data(),
                {identity,moduleName:'operationLedger',recordId:operation.operationId}):null;
              return {source:'server',exists:s.exists,record};
            }});
          reconciliations.push({businessId,...reconciliation});
          if(!reconciliation.canProceed)throw Error('SPARK_MIGRATION_OUTBOX_RECONCILIATION_STOP');
          // Executable journal commands require the operational projection/replay
          // handoff first. Snapshot persistence IDs below are NOT commands.
          if(reconciliation.results.length)throw Error('SPARK_MIGRATION_COMMAND_HANDOFF_REQUIRED');
        }
        recovery=await root.CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser});
        const device=await recovery.deviceIdentity(deviceId);context();
        if(device?.durable!==true||device.ownerUid!==ownerUid||!device.deviceId)throw Error('SPARK_MIGRATION_DURABLE_DEVICE_ID_REQUIRED');
        const {snapshot:preservedSnapshot,...deviceRecordMetadata}=local;
        const preservedRecovery={read:hash=>recovery.read(hash),pin:input=>recovery.pin({...input,
          remoteSourceHash:selected.remoteHash,businessIds:selected.businessIds,sourceDeviceId:device.deviceId,
          deviceRecordMetadata,reconciliations})};
        const importer=root.CLICK360_SPARK_IMPORTER.create({db,firebase,projectId,ownerUid,deviceId:device.deviceId,buildSha,resolveUser,
          readSource,recovery:preservedRecovery,onProgress,readGuard:async()=>{
            context();const current=await readLocal();context();
            if(current?.deviceRevision!==deviceRevision)throw Error('SPARK_MIGRATION_DEVICE_DRIFT_STOP');
            await journal.assertOwnerCoverage(ownerUid,selected.businessIds);context();
            for(const businessId of selected.businessIds){
              const identity={ownerUid,businessId},counts=await journal.countPending(identity);
              if(counts.countIsBounded!==false||counts.total!==0
                ||await journal.countProjectionPending(identity)!==0)throw Error('SPARK_MIGRATION_OUTBOX_CHANGED_STOP');
            }
            return {ownerUid,deviceRevision,unknownOperations:0,mutationLockHeld:leaseHeld()};
          }});
        const shadow=await importer.prepareShadow();context();await assertStable();
        return {...shadow,prepared:true,reconciliations,operationalCloudConfirmed:false};
      }finally{journal?.close();recovery?.close();}
    }
    return Object.freeze({prepare});
  }
  root.CLICK360_SPARK_MIGRATION_BOOTSTRAP=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
