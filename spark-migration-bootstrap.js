(function(root){
  'use strict';
  // Existing importer connection: shadow remains staging-only. Explicitly
  // piloted production entry permits recovery preservation ONLY. Never
  // activates writers, confirms journal rows or performs operational cutover.
  function create({db,firebase,projectId,ownerUid,actorUid,deviceId,buildSha,
    resolveUser,resolveContext,readLocal,leaseHeld,onProgress=()=>{},productionRecoveryOnly=false}){
    if((!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
        &&!(projectId==='click-360'&&productionRecoveryOnly===true))
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
        'spark-modular-importer.js','spark-modular-record-codec.js','spark-modular-handoff.js','spark-migration-bootstrap.js']
        .some(file=>root.CLICK360_RELEASE_ASSETS?.[file]!==buildSha))throw Error('SPARK_MIGRATION_MIXED_BUILD_STOP');
      const rollout=await server(db.doc('storageRollout/sparkV1')),policy=rollout.data();
      // A server-managed, explicit shadow flag is separate from operational
      // eligibility. Existing pilots do not silently acquire migration writes.
      if(!rollout.exists||policy.enabled!==true||(policy.automaticShadow!==true&&policy.automaticRecoveryCopy!==true)
        ||!Array.isArray(policy.pilotOwnerUids)||!policy.pilotOwnerUids.includes(ownerUid))return {prepared:false};
      if(productionRecoveryOnly&&policy.automaticRecoveryCopy!==true)return {prepared:false};
      let journal,recovery;
      try{
        const local=await readLocal();context();
        if(local?.source==='spark_operational_candidate')throw Error('SPARK_MIGRATION_OPERATIONAL_SOURCE_STOP');
        // Require an existing durable snapshot; never seed a business from an
        // empty initial UI or infer freshness from a clock or a clean label.
        if(!local?.snapshot||!local.deviceRevision)throw Error('SPARK_MIGRATION_DURABLE_SOURCE_REQUIRED');
        // Preserve the queue/base/source contract too. Equal commercial JSON
        // is not evidence that a background save left the migration source
        // unchanged, nor permission to omit new snapshot-save references.
        const metadataOf=record=>Object.fromEntries(Object.entries(record).filter(([key])=>key!=='snapshot'));
        const pinnedMetadataHash=await api.hash(metadataOf(local));
        const assertMetadata=async now=>{
          if(!now||await api.hash(metadataOf(now))!==pinnedMetadataHash)
            throw Error('SPARK_MIGRATION_DEVICE_METADATA_DRIFT_STOP');
        };
        const pinnedHash=await api.hash(local.snapshot),deviceRevision=local.deviceRevision;
        const assertStable=async()=>{
          context();const now=await readLocal();context();
          if(now?.deviceRevision!==deviceRevision||await api.hash(now.snapshot)!==pinnedHash)
            throw Error('SPARK_MIGRATION_DEVICE_DRIFT_STOP');
          await assertMetadata(now);context();
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
        journal=await root.CLICK360_MODULAR_JOURNAL.open();
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
          const source=await readSource(),remote=await api.selectSource({ownerUid,remote:source.remote,local:null,unknownOperations:0});
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
        const source=await readSource();
        const selected=await api.selectSource({ownerUid,...source});
        // Unscoped READ-ONLY census includes pending rows issued by a different
        // actor on this partition. They block migration, never get claimed.
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
        // Capacity-bridge save references are a separate queue from the
        // modular command journal. Enumerating zero command rows must not
        // silently discard those original references or turn them into sales.
        // Preserve the existing explicit proof contract; it never authorizes
        // replay and stops on malformed IDs, duplicates or remote drift.
        const capacityProof=local.cloudCapacityBlocked===true
          ?await root.CLICK360_SPARK_RECONCILIATION.capacitySnapshotProof({ownerUid,
            localRecord:{...local,durable:true},remote:source.remote,unknownOperations:0})
          :null;
        context();await assertStable();
        // The preservation codec proves byte/semantic identity, not that an
        // imported cash session can safely become operational. Run the actual
        // financial proof for EVERY covered business before any shadow write.
        // Never manufacture zero counters or infer session identity from dates.
        const cashProofs=[];
        // Administrative staging opt-in only. Production recovery-only entry
        // returns above and cannot acquire this preservation/operational gate.
        const historicalReadOnly=policy.automaticHistoricalReadOnly===true;
        for(const businessId of selected.businessIds){
          const proof=await api.deriveCashSummaries({snapshot:selected.snapshot,businessId,historicalReadOnly});
          context();await assertStable();
          if(!proof.canProceed)throw Error('SPARK_MIGRATION_CASH_PROOF_REQUIRED');
          cashProofs.push({businessId,...proof});
        }
        const {snapshot:preservedSnapshot,...deviceRecordMetadata}=local;
        const preservedRecovery={read:hash=>recovery.read(hash),readHandoff:hash=>recovery.readHandoff(hash),pin:input=>recovery.pin({...input,
          remoteSourceHash:selected.remoteHash,businessIds:selected.businessIds,sourceDeviceId:device.deviceId,
          deviceRecordMetadata,reconciliations,capacityProof,cashProofs})};
        const importer=root.CLICK360_SPARK_IMPORTER.create({db,firebase,projectId,ownerUid,deviceId:device.deviceId,buildSha,resolveUser,
          requireCashProof:true,historicalReadOnly,
          readSource,recovery:preservedRecovery,onProgress,readGuard:async()=>{
            context();const current=await readLocal();context();
            if(current?.deviceRevision!==deviceRevision)throw Error('SPARK_MIGRATION_DEVICE_DRIFT_STOP');
            await assertMetadata(current);context();
            await journal.assertOwnerCoverage(ownerUid,selected.businessIds);context();
            for(const businessId of selected.businessIds){
              const identity={ownerUid,businessId},counts=await journal.countPending(identity);
              if(counts.countIsBounded!==false||counts.total!==0
                ||await journal.countProjectionPending(identity)!==0)throw Error('SPARK_MIGRATION_OUTBOX_CHANGED_STOP');
            }
            return {ownerUid,deviceRevision,unknownOperations:0,mutationLockHeld:leaseHeld(),
              deviceMetadataHash:pinnedMetadataHash,journalCapture:await journal.captureOwner(ownerUid)};
          }});
        const shadow=await importer.prepareShadow();context();await assertStable();
        if(shadow.phase!=='READY_TO_CUTOVER'||shadow.cutoverPerformed!==false
          ||shadow.equality?.status!=='SEMANTIC_EQUALITY_PASS'
          ||shadow.equality.sourceHash!==selected.sourceHash||shadow.equality.reconstructedHash!==selected.sourceHash)
          throw Error('SPARK_MIGRATION_HANDOFF_EQUALITY_REQUIRED');
        const journalHash=await api.hash(journalCapture),currentJournal=await journal.captureOwner(ownerUid);context();
        if(await api.hash(currentJournal)!==journalHash)throw Error('SPARK_MIGRATION_OUTBOX_CHANGED_STOP');
        const handoff=await root.CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot:selected.snapshot,
          sourceHash:selected.sourceHash,deviceMetadataHash:pinnedMetadataHash,journalHash,journalCapture,
          businessIds:selected.businessIds,financialProofs:cashProofs,unknownCount:0,conflictCount:0,historicalReadOnly});
        context();await assertStable();
        const stored=await recovery.pinHandoff(handoff);context();
        const preserved=await recovery.readHandoff(stored.captureHash);context();
        if(preserved?.durable!==true||await api.hash(preserved.plan)!==await api.hash(handoff))
          throw Error('SPARK_MIGRATION_HANDOFF_PIN_REQUIRED');
        await assertStable();
        if(await api.hash(await journal.captureOwner(ownerUid))!==journalHash)throw Error('SPARK_MIGRATION_OUTBOX_CHANGED_STOP');
        context();onProgress({phase:'READ_ONLY_HANDOFF_PREPARED',planHash:handoff.planHash,
          captureHash:preserved.captureHash,operationalCloudConfirmed:false});
        const runtimePreparation=policy.automaticRuntimePreparation===true
          ?await importer.prepareRuntime({captureHash:preserved.captureHash}):null;
        context();await assertStable();
        if(runtimePreparation)onProgress({phase:'RUNTIME_PREPARED',planHash:handoff.planHash,
          captureHash:preserved.captureHash,runtimeHashes:runtimePreparation.runtimeHashes,
          operationalCloudConfirmed:false,cutoverPerformed:false});
        return {...shadow,prepared:true,reconciliations,handoffPrepared:true,handoff:preserved,
          runtimePreparation,
          operationalCloudConfirmed:false};
      }finally{journal?.close();recovery?.close();}
    }
    return Object.freeze({prepare});
  }
  root.CLICK360_SPARK_MIGRATION_BOOTSTRAP=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
