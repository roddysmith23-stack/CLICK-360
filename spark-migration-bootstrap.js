(function(root){
  'use strict';
  // Existing importer connection. P0A-only enrollment remains preservation
  // only; operational production enrollment is administrative/default-off and
  // still requires the same exact private source/build approvals. No path
  // confirms/replays journal rows or publishes its own authorization.
  const preparationAuthorities=new WeakMap();
  function assertPreparationAuthority(token,scope,{write=false}={}){
    const proof=token&&preparationAuthorities.get(token);
    if(!proof||!/^[a-f0-9]{12,40}$/.test(proof.buildSha||'')||Object.entries(scope).some(([key,value])=>proof[key]!==value)||(write&&!proof.writable))
      throw Error('SPARK_PREPARATION_AUTHORITY_REQUIRED');
    proof.assertCurrent();return true;
  }
  async function verifyPreparationAuthority(token,scope,options){
    assertPreparationAuthority(token,scope,options);
    await preparationAuthorities.get(token).verify(options);assertPreparationAuthority(token,scope,options);
  }
  function create({db,firebase,projectId,ownerUid,actorUid,deviceId,buildSha,
    resolveUser,resolveContext,readLocal,leaseHeld,onProgress=()=>{},productionRecoveryOnly=false}){
    if((!['demo-click360-spark-modular','click360-staging-7620168025','click-360'].includes(projectId))
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
    function issuePreparationAuthority(sourceDeviceId,{writable=false}={}){
      context();if(productionRecoveryOnly)throw Error('SPARK_PREPARATION_AUTHORITY_REQUIRED');
      if(!/^[a-f0-9]{12,40}$/.test(buildSha||'')||typeof sourceDeviceId!=='string'||!sourceDeviceId)
        throw Error('SPARK_PREPARATION_AUTHORITY_REQUIRED');
      const token=Object.freeze({});
      preparationAuthorities.set(token,{projectId,ownerUid,buildSha,deviceId:sourceDeviceId,writable,assertCurrent:context,
        verify:async({write=false}={})=>{
          const p=(await server(db.doc('storageRollout/sparkV1'))).data();
          if(p?.enabled!==true||p.operationalAccess!==true||!Array.isArray(p.pilotOwnerUids)||!p.pilotOwnerUids.includes(ownerUid)
            ||(write&&(p.automaticShadow!==true||p.automaticMigration!==true)))
            throw Error('SPARK_PREPARATION_ADMIN_POLICY_REQUIRED');
        }});
      return token;
    }
    async function scopedContract(read){
      // Same single authoritative choice as sparkScopedEntitlements: an
      // existing accountAccess never falls back to a different legacy plan.
      const primary=await read(db.doc(`accountAccess/${ownerUid}`));context();
      const account=primary.exists?primary:await read(db.doc(`approvedUsers/${ownerUid}`));context();
      if(!account.exists)throw Error('SPARK_ACTIVATION_OWNER_CONTRACT_REQUIRED');
      const body=account.data(),accountPlan=Object.hasOwn(body,'plan')?body.plan:'founder_legacy';
      if(!['base','pro','business','enterprise','founder','founder_legacy'].includes(accountPlan))
        throw Error('SPARK_ACTIVATION_OWNER_PLAN_UNSUPPORTED');
      const value=body.manualLimitOverrides;
      const manualLimitOverrides=value&&typeof value==='object'
        &&[Object.prototype,null].includes(Object.getPrototypeOf(value))?value:{};
      return {source:primary.exists?'accountAccess':'approvedUsers',
        account:JSON.parse(JSON.stringify(body)),accountPlan,manualLimitOverrides};
    }
    async function scopedRecords(control,contract){
      const rows=[];
      for(const businessId of control.businessIds){
        const identity={ownerUid,businessId};
        const flat={id:'storage',...identity,tenantKey:`owner:${ownerUid}:business:${businessId}`,
          storageSchemaVersion:2,module:'metadata',recordVersion:1,storageMode:'modular',phase:'MODULAR',
          semanticEquality:'PASS',sourceHash:control.sourceHash,reconstructedHash:control.reconstructedHash,
          accountPlan:contract.accountPlan,manualLimitOverrides:contract.manualLimitOverrides};
        rows.push({path:`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/storage`,
          content:await root.CLICK360_SPARK_RECORD_CODEC.pack(flat,{identity,moduleName:'metadata',recordId:'storage'})});context();
      }
      return rows;
    }
    async function verifyLocalHandoff({preCutover=false}={}){
      context();
      if(productionRecoveryOnly)throw Error('SPARK_LOCAL_HANDOFF_NONPRODUCTION_ONLY');
      if(root.document&&['app.js','firebase-service.js','v16-storage.js','modular-operation-journal.js',
        'spark-modular-migration.js','spark-modular-reconciliation.js','spark-modular-recovery.js',
        'spark-modular-importer.js','spark-modular-record-codec.js','spark-modular-handoff.js','spark-migration-bootstrap.js']
        .some(file=>root.CLICK360_RELEASE_ASSETS?.[file]!==buildSha))throw Error('SPARK_MIGRATION_MIXED_BUILD_STOP');
      const same=(a,b)=>api.canonicalJson(a)===api.canonicalJson(b);
      const sameBusinesses=(a,b)=>Array.isArray(a)&&Array.isArray(b)
        &&new Set(a).size===a.length&&new Set(b).size===b.length&&same([...a].sort(),[...b].sort());
      // SDK Timestamp values in administrative/control documents are not
      // plain JSON. Compare their complete SDK JSON representation too; do
      // not omit updatedAt/createdAt and accidentally accept changed control.
      const sameServer=(a,b)=>same(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
      const metadataOf=record=>Object.fromEntries(Object.entries(record).filter(([key])=>key!=='snapshot'));
      const controlRef=db.doc(`businesses/${ownerUid}/metadata/storage`);
      const runtimeRef=db.doc(`businesses/${ownerUid}/storageApprovals/runtimePreparation`);
      const cutoverRef=db.doc(`businesses/${ownerUid}/storageApprovals/cutover`);
      const policyRef=db.doc('storageRollout/sparkV1');
      let journal,recovery;
      try{
        const policy=(await server(policyRef)).data(),control=(await server(controlRef)).data();
        if(policy?.enabled!==true||policy.automaticCutover!==true||!Array.isArray(policy.pilotOwnerUids)||!policy.pilotOwnerUids.includes(ownerUid))
          throw Error('SPARK_LOCAL_HANDOFF_ADMIN_APPROVAL_REQUIRED');
        if(preCutover&&policy.automaticMigration!==true)throw Error('SPARK_AUTOMATIC_ACTIVATION_DISABLED');
        if(control?.ownerUid!==ownerUid||control.schemaVersion!==2||control.storageMode!==(preCutover?'migrating':'modular')
          ||control.phase!==(preCutover?'READY_TO_CUTOVER':'MODULAR')||control.semanticEquality!=='PASS'||control.sourceHash!==control.reconstructedHash
          ||control.buildSha!==buildSha)throw Error('SPARK_LOCAL_HANDOFF_CONTROL_REQUIRED');
        const authorization=(await server(runtimeRef)).data(),cutover=(await server(cutoverRef)).data();
        const contract=await scopedContract(server),contractHash=await api.hash(contract);context();
        recovery=await root.CLICK360_SPARK_RECOVERY.open({ownerUid,resolveUser});context();
        const preserved=await recovery.readHandoff(authorization?.captureHash);context();
        if(preserved?.durable!==true||!preserved.plan)throw Error('SPARK_LOCAL_HANDOFF_PIN_REQUIRED');
        const plan=preserved.plan,pin=await recovery.read(plan.sourceHash);context();
        if(pin?.durable!==true||pin.buildSha!==buildSha||!pin.deviceRecordMetadata
          ||pin.deviceRevision!==control.deviceRevision||pin.sourceDeviceId!==control.sourceDeviceId
          ||pin.remoteSourceHash!==control.remoteHash||pin.remoteRevision!==control.remoteRevision)
          throw Error('SPARK_LOCAL_HANDOFF_SOURCE_PIN_REQUIRED');
        const approval=await root.CLICK360_SPARK_HANDOFF.runtimeApproval(plan,buildSha);context();
        if(!same(authorization,approval)||approval.captureHash!==preserved.captureHash
          ||!same(cutover,{ownerUid,sourceHash:plan.sourceHash,buildSha,businessIds:control.businessIds})
          ||!sameBusinesses(control.businessIds,plan.businessIds)||!sameBusinesses(pin.businessIds,plan.businessIds)
          ||control.sourceHash!==plan.sourceHash)throw Error('SPARK_LOCAL_HANDOFF_APPROVAL_MISMATCH');
        const metadataHash=await api.hash(pin.deviceRecordMetadata);
        if(metadataHash!==plan.deviceMetadataHash)throw Error('SPARK_LOCAL_HANDOFF_METADATA_MISMATCH');
        async function localStable(activeJournal){
          context();const current=await readLocal();context();
          if(!current||current.source==='spark_operational_candidate'||current.deviceRevision!==pin.deviceRevision
            ||await api.hash(current.snapshot)!==plan.sourceHash||await api.hash(metadataOf(current))!==metadataHash)
            throw Error('SPARK_LOCAL_HANDOFF_DEVICE_DRIFT_STOP');
          await activeJournal.assertOwnerCoverage(ownerUid,plan.businessIds);context();
          const capture=await activeJournal.captureOwner(ownerUid);context();
          if(capture?.ownerUid!==ownerUid||capture.enumerationComplete!==true||capture.recordCount!==0
            ||!Array.isArray(capture.rows)||capture.rows.length!==0||await api.hash(capture)!==plan.journalHash)
            throw Error('SPARK_LOCAL_HANDOFF_OUTBOX_DRIFT_STOP');
          return current;
        }
        journal=await root.CLICK360_MODULAR_JOURNAL.open();context();
        const local=await localStable(journal),legacy=(await server(db.doc(`businesses/${ownerUid}/state/main`))).data();
        const selected=await api.selectSource({ownerUid,remote:{source:'server',revision:legacy?.revision,
          identity:legacy?.payload?.identity,snapshot:legacy?.payload?.data},local:{durable:true,snapshot:local.snapshot,
          identity:local.identity||local.snapshot.identity,deviceRevision:local.deviceRevision,baseRevision:local.baseRevision,
          pendingRemoteSync:local.pendingRemoteSync,cloudCapacityBlocked:local.cloudCapacityBlocked,
          pendingOperations:local.pendingOperations||[]},unknownOperations:0});context();
        if(selected.sourceHash!==plan.sourceHash||selected.remoteHash!==control.remoteHash
          ||selected.remoteRevision!==control.remoteRevision||!sameBusinesses(selected.businessIds,plan.businessIds))
          throw Error('SPARK_LOCAL_HANDOFF_REMOTE_DRIFT_STOP');
        const financialProofs=[];
        for(const businessId of plan.businessIds){
          financialProofs.push({businessId,...await api.deriveCashSummaries({snapshot:local.snapshot,businessId,
            historicalReadOnly:policy.automaticHistoricalReadOnly===true})});context();
        }
        const derived=await root.CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot:local.snapshot,sourceHash:plan.sourceHash,
          deviceMetadataHash:metadataHash,journalHash:plan.journalHash,journalCapture:await journal.captureOwner(ownerUid),
          businessIds:selected.businessIds,financialProofs,unknownCount:0,conflictCount:0,
          historicalReadOnly:policy.automaticHistoricalReadOnly===true});context();
        if(!same(derived,plan))throw Error('SPARK_LOCAL_HANDOFF_PLAN_DRIFT_STOP');
        const manifest=await api.plan({ownerUid,snapshot:local.snapshot,identity:selected.identity,
          remoteRevision:selected.remoteRevision,deviceRevision:selected.deviceRevision});context();
        for(const row of manifest.records){
          const c=row.content,proof=financialProofs.find(p=>p.businessId===c.businessId),history=proof?.historyPlan?.historyPolicies[`${c.module}/${c.id}`];
          if(history)c.historyPolicy=structuredClone(history);
          else if(c.module==='cashSessions'&&proof?.verified[c.id]){
            c.operational=structuredClone(proof.verified[c.id].summary);c.operationalHash=proof.verified[c.id].summaryHash;
          }
        }
        const importer=root.CLICK360_SPARK_IMPORTER.create({db,firebase,projectId,ownerUid,buildSha,deviceId:pin.sourceDeviceId,
          preparationAuthority:issuePreparationAuthority(pin.sourceDeviceId),
          resolveUser,readSource:async()=>{throw Error('SPARK_LOCAL_HANDOFF_READ_ONLY');},
          readGuard:async()=>{throw Error('SPARK_LOCAL_HANDOFF_READ_ONLY');},recovery});
        const records=await importer.readServerRecords(manifest);context();
        const expected=new Map(manifest.records.map(row=>[row.path,row.content]));
        for(const row of plan.runtimes)expected.set(row.path,approval.runtimeRecords[row.content.businessId]);
        // Only exact, independently derived per-business authority is allowed
        // in addition to source records/runtimes. Never ignore metadata or
        // orphan records wholesale in order to obtain equality.
        if(!preCutover)for(const row of await scopedRecords(control,contract))expected.set(row.path,row.content);
        if(records.length!==expected.size||new Set(records.map(r=>r.path)).size!==records.length
          ||records.some(row=>!expected.has(row.path)||!same(row.content,expected.get(row.path))))
          throw Error('SPARK_LOCAL_HANDOFF_SERVER_RECORD_DRIFT_STOP');
        const sourcePaths=new Set(manifest.records.map(row=>row.path));
        const equality=await api.compare({manifest,source:local.snapshot,remoteRecords:records.filter(r=>sourcePaths.has(r.path))});context();
        if(equality.status!=='SEMANTIC_EQUALITY_PASS'||equality.reconstructedHash!==plan.sourceHash)
          throw Error('SPARK_LOCAL_HANDOFF_EQUALITY_REQUIRED');
        async function authorizationsStable(){
          if(!sameServer((await server(controlRef)).data(),control)||!sameServer((await server(policyRef)).data(),policy)
            ||!same((await server(runtimeRef)).data(),authorization)||!same((await server(cutoverRef)).data(),cutover))
            throw Error('SPARK_LOCAL_HANDOFF_AUTHORIZATION_DRIFT_STOP');
          const latestLegacy=(await server(db.doc(`businesses/${ownerUid}/state/main`))).data();
          if(latestLegacy?.revision!==control.remoteRevision||await api.hash(latestLegacy?.payload?.data)!==control.remoteHash)
            throw Error('SPARK_LOCAL_HANDOFF_REMOTE_DRIFT_STOP');
          if(await api.hash(await scopedContract(server))!==contractHash)
            throw Error('SPARK_ACTIVATION_OWNER_CONTRACT_CHANGED');
          context();
        }
        await localStable(journal);await authorizationsStable();context();
        return {verified:true,status:preCutover?'PRE_CUTOVER_VERIFIED':'LOCAL_HANDOFF_VERIFIED',buildSha,
          controlVersion:control.recordVersion,remoteHash:control.remoteHash,remoteRevision:control.remoteRevision,
          sourceDeviceId:control.sourceDeviceId,runtimeApprovalHash:await api.hash(authorization),
          contractHash,
          runtimeHashes:structuredClone(approval.preparedRuntimeHashes),
          sourceHash:plan.sourceHash,deviceRevision:pin.deviceRevision,
          deviceMetadataHash:metadataHash,businessIds:[...control.businessIds],captureHash:preserved.captureHash,
          // This final gate runs immediately before the EXISTING IDB CAS.
          // Pins, journal and legacy remain intact; no write is done here.
          assertStable:async()=>{const currentJournal=await root.CLICK360_MODULAR_JOURNAL.open();
            try{await localStable(currentJournal);await authorizationsStable();context();}finally{currentJournal.close();}}};
      }finally{journal?.close();recovery?.close();}
    }
    async function activateApproved(){
      // PRE_CUTOVER proof cannot authorize native cache promotion, which
      // separately requires a fresh proof of the confirmed MODULAR mode.
      onProgress({phase:'ACTIVATION_VERIFYING',operationalCloudConfirmed:false});
      const verified=await verifyLocalHandoff({preCutover:true});context();
      onProgress({phase:'ACTIVATION_SOURCE_VERIFIED',operationalCloudConfirmed:false});
      if(!Number.isSafeInteger(verified.controlVersion)||verified.controlVersion<1)
        throw Error('SPARK_ACTIVATION_CONTROL_VERSION_REQUIRED');
      const controlRef=db.doc(`businesses/${ownerUid}/metadata/storage`);
      await db.runTransaction(async tx=>{
        context();
        const [control,policy,approval,runtimeApproval,legacy]=await Promise.all([
          tx.get(controlRef),tx.get(db.doc('storageRollout/sparkV1')),
          tx.get(db.doc(`businesses/${ownerUid}/storageApprovals/cutover`)),
          tx.get(db.doc(`businesses/${ownerUid}/storageApprovals/runtimePreparation`)),
          tx.get(db.doc(`businesses/${ownerUid}/state/main`))]);context();
        const c=control.data(),p=policy.data(),r=legacy.data();
        if(c?.ownerUid!==ownerUid||c.schemaVersion!==2||c.storageMode!=='migrating'||c.phase!=='READY_TO_CUTOVER'
          ||c.recordVersion!==verified.controlVersion||c.sourceHash!==verified.sourceHash
          ||c.reconstructedHash!==verified.sourceHash||c.semanticEquality!=='PASS'||c.buildSha!==buildSha
          ||c.remoteHash!==verified.remoteHash||c.remoteRevision!==verified.remoteRevision
          ||c.deviceRevision!==verified.deviceRevision||c.sourceDeviceId!==verified.sourceDeviceId
          ||api.canonicalJson(c.businessIds)!==api.canonicalJson(verified.businessIds))
          throw Error('SPARK_ACTIVATION_CONTROL_CHANGED');
        if(p?.enabled!==true||p.automaticMigration!==true||p.automaticCutover!==true
          ||p.automaticRuntimePreparation!==true||!Array.isArray(p.pilotOwnerUids)||!p.pilotOwnerUids.includes(ownerUid)
          ||api.canonicalJson(approval.data()??null)!==api.canonicalJson({ownerUid,
            sourceHash:verified.sourceHash,buildSha,businessIds:verified.businessIds})
          ||!runtimeApproval.exists||await api.hash(runtimeApproval.data())!==verified.runtimeApprovalHash)
          throw Error('SPARK_ACTIVATION_ADMIN_APPROVAL_CHANGED');
        if(!r||r.revision!==verified.remoteRevision||await api.hash(r.payload?.data)!==verified.remoteHash)
          throw Error('SPARK_ACTIVATION_REMOTE_DRIFT_STOP');
        const contract=await scopedContract(ref=>tx.get(ref));
        if(await api.hash(contract)!==verified.contractHash)throw Error('SPARK_ACTIVATION_OWNER_CONTRACT_CHANGED');
        const scoped=await scopedRecords(c,contract);
        for(const businessId of verified.businessIds){
          const runtime=await tx.get(db.doc(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/runtime`));context();
          if(!runtime.exists||await api.hash(runtime.data())!==verified.runtimeHashes[businessId])
            throw Error('SPARK_ACTIVATION_RUNTIME_CHANGED');
        }
        for(const row of scoped){
          const existing=await tx.get(db.doc(row.path));context();
          if(existing.exists)throw Error('SPARK_ACTIVATION_SCOPED_PROOF_CONFLICT');
        }
        // The transaction retains exact remote versions while the native
        // source/journal/context is checked again. Only storage control changes;
        // no commerce, shadow data, source pin or legacy record is rewritten.
        await verified.assertStable();context();
        tx.update(controlRef,{storageMode:'modular',phase:'MODULAR',recordVersion:c.recordVersion+1,
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
        for(const row of scoped)tx.set(db.doc(row.path),row.content);
      });
      onProgress({phase:'ACTIVATION_COMMITTED_VERIFYING',operationalCloudConfirmed:false});
      context();const confirmed=(await server(controlRef)).data();
      if(confirmed?.storageMode!=='modular'||confirmed.phase!=='MODULAR'
        ||confirmed.sourceHash!==verified.sourceHash||confirmed.reconstructedHash!==verified.sourceHash
        ||confirmed.buildSha!==buildSha||confirmed.recordVersion!==verified.controlVersion+1)
        throw Error('SPARK_ACTIVATION_SERVER_CONFIRMATION_REQUIRED');
      const confirmedContract=await scopedContract(server);
      if(await api.hash(confirmedContract)!==verified.contractHash)throw Error('SPARK_ACTIVATION_OWNER_CONTRACT_CHANGED');
      for(const row of await scopedRecords(confirmed,confirmedContract)){
        if(api.canonicalJson((await server(db.doc(row.path))).data())!==api.canonicalJson(row.content))
          throw Error('SPARK_ACTIVATION_SCOPED_PROOF_CONFIRMATION_REQUIRED');
      }
      return {phase:'MODULAR',storageMode:'modular',sourceHash:verified.sourceHash,
        cutoverPerformed:true,operationalCloudConfirmed:false};
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
      if(projectId==='click-360'&&!productionRecoveryOnly
        &&(policy.operationalAccess!==true||policy.automaticShadow!==true||policy.automaticMigration!==true))return {prepared:false};
      let journal,recovery,shadowStarted=false;
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
        const preparationAuthority=productionRecoveryOnly?null:issuePreparationAuthority(device.deviceId,{writable:true});
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
          const copy=await recovery.preserveCloud({captureHash:deviceCapture.captureHash,db,firebase,projectId,productionRecoveryOnly,
            preparationAuthority,assertStable:async()=>{
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
        // Unattended production enrollment is not source approval. Before
        // claiming/fencing an untouched legacy owner, require the existing
        // administrative approvals to match THIS device's complete plan.
        // Missing/old approvals leave legacy usable, with no shadow writes.
        // An already-claimed migration must use strict recovery, never fall
        // back to a legacy writer after its server fence has been installed.
        if(projectId==='click-360'||policy.sourceBoundPreparation===true){
          const control=await server(db.doc(`businesses/${ownerUid}/metadata/storage`));
          if(!control.exists){
            const plan=await root.CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot:selected.snapshot,
              sourceHash:selected.sourceHash,deviceMetadataHash:pinnedMetadataHash,journalHash:await api.hash(journalCapture),
              journalCapture,businessIds:selected.businessIds,financialProofs:cashProofs,unknownCount:0,conflictCount:0,historicalReadOnly});
            const expected=await root.CLICK360_SPARK_HANDOFF.runtimeApproval(plan,buildSha);
            const runtime=(await server(db.doc(`businesses/${ownerUid}/storageApprovals/runtimePreparation`))).data();
            const cutover=(await server(db.doc(`businesses/${ownerUid}/storageApprovals/cutover`))).data();
            await assertStable();
            if(await api.hash(await journal.captureOwner(ownerUid))!==await api.hash(journalCapture))
              throw Error('SPARK_MIGRATION_OUTBOX_CHANGED_STOP');
            const same=(a,b)=>api.canonicalJson(a??null)===api.canonicalJson(b??null);
            if(!same(runtime,expected)||!same(cutover,{ownerUid,sourceHash:plan.sourceHash,buildSha,businessIds:selected.businessIds}))
              return {prepared:false,reason:'SPARK_SOURCE_BOUND_APPROVAL_PENDING',sourceHash:plan.sourceHash,
                planHash:plan.planHash,operationalCloudConfirmed:false,cutoverPerformed:false};
          }
        }
        const {snapshot:preservedSnapshot,...deviceRecordMetadata}=local;
        const preservedRecovery={read:hash=>recovery.read(hash),readHandoff:hash=>recovery.readHandoff(hash),pin:input=>recovery.pin({...input,
          remoteSourceHash:selected.remoteHash,businessIds:selected.businessIds,sourceDeviceId:device.deviceId,
          deviceRecordMetadata,reconciliations,capacityProof,cashProofs})};
        const importer=root.CLICK360_SPARK_IMPORTER.create({db,firebase,projectId,ownerUid,deviceId:device.deviceId,buildSha,resolveUser,
          preparationAuthority,
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
        shadowStarted=true;
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
        let activation=null;
        if(policy.automaticMigration===true&&policy.automaticCutover===true){
          if(runtimePreparation?.status!=='RUNTIME_PREPARED')throw Error('SPARK_ACTIVATION_RUNTIME_PREPARATION_REQUIRED');
          activation=await activateApproved();context();onProgress({...activation,phase:'CUTOVER_COMMITTED'});
        }
        return {...shadow,...(activation||{}),prepared:true,reconciliations,handoffPrepared:true,handoff:preserved,
          runtimePreparation,
          operationalCloudConfirmed:false};
      }catch(error){
        // An unattended attempt must not take a still-legacy business out of
        // service for a source/outbox uncertainty discovered BEFORE claiming
        // any shadow. Prove the server fence is still absent; never downgrade
        // an existing migration, swallow identity revocation, or mask a write
        // response whose result might already have installed the fence.
        const defer=new Set(['SPARK_MIGRATION_DEVICE_METADATA_DRIFT_STOP','SPARK_MIGRATION_DEVICE_DRIFT_STOP',
          'SPARK_MIGRATION_OUTBOX_RECONCILIATION_STOP','SPARK_MIGRATION_COMMAND_HANDOFF_REQUIRED',
          'SPARK_MIGRATION_OUTBOX_CHANGED_STOP','SPARK_MIGRATION_CASH_PROOF_REQUIRED']);
        if((projectId==='click-360'||policy.sourceBoundPreparation===true)&&!productionRecoveryOnly&&!shadowStarted&&defer.has(error.message)){
          const control=await server(db.doc(`businesses/${ownerUid}/metadata/storage`));
          if(!control.exists)return {prepared:false,reason:error.message,operationalCloudConfirmed:false,cutoverPerformed:false};
        }
        throw error;
      }finally{journal?.close();recovery?.close();}
    }
    return Object.freeze({prepare,verifyLocalHandoff,activateApproved});
  }
  root.CLICK360_SPARK_MIGRATION_BOOTSTRAP=Object.freeze({create,assertPreparationAuthority,verifyPreparationAuthority});
})(typeof window==='undefined'?globalThis:window);
