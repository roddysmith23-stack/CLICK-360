(function(root){
  'use strict';
  // Migration transport, not a commercial transaction limit. Bound BOTH row
  // count and serialized request size; never let 25 near-limit records form
  // an oversized request or force one round trip per tiny legacy fragment.
  const SHADOW_CHUNK_RECORDS=100,SHADOW_CHUNK_BYTES=1024*1024;
  function shadowChunks(records){
    const api=root.CLICK360_SPARK_MIGRATION,chunks=[];let chunk=[],bytes=0;
    for(const row of records){
      const size=api.byteLength(row)+256; // conservative per-write RPC envelope
      if(size>SHADOW_CHUNK_BYTES)throw Error('SPARK_IMPORT_REQUEST_RECORD_TOO_LARGE');
      if(chunk.length&&(chunk.length===SHADOW_CHUNK_RECORDS||bytes+size>SHADOW_CHUNK_BYTES)){
        chunks.push(chunk);chunk=[];bytes=0;
      }
      chunk.push(row);bytes+=size;
    }
    if(chunk.length)chunks.push(chunk);
    return chunks;
  }
  // Explicit transport, not loaded/started by production. Uses only the client
  // Firestore SDK. Recovery must independently read back an IndexedDB pin.
  function create({db,firebase,projectId,ownerUid,buildSha,deviceId,resolveUser,readSource,readGuard,recovery,
    requireCashProof=false,historicalReadOnly=false,onProgress=()=>{}}){
    const api=root.CLICK360_SPARK_MIGRATION;
    if(!api||!db?.runTransaction||!db?.collection||!firebase?.firestore?.FieldValue
      ||typeof resolveUser!=='function'||typeof readSource!=='function'||typeof readGuard!=='function'||!recovery?.pin||!recovery?.read)throw Error('SPARK_IMPORTER_INCOMPLETE');
    // Production activation is deliberately unavailable until the UI/Rules
    // operational contract is certified; a staging result cannot enable it.
    if(!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
      ||db.app?.options?.projectId!==projectId)throw Error('SPARK_IMPORTER_NONPRODUCTION_ONLY');
    if(!/^[a-f0-9]{12,40}$/.test(buildSha)||!deviceId)throw Error('SPARK_IMPORTER_RELEASE_REQUIRED');
    const controlRef=db.doc(`businesses/${ownerUid}/metadata/storage`);
    const legacyRef=db.doc(`businesses/${ownerUid}/state/main`);
    const stamp=()=>firebase.firestore.FieldValue.serverTimestamp();
    function context(){if(resolveUser()?.uid!==ownerUid)throw Error('SPARK_IMPORTER_OWNER_CONTEXT_CHANGED');}
    async function source(){context();const candidate=await readSource();context();return api.selectSource({ownerUid,...candidate});}
    async function assertPinned(manifest){
      await assertGuard(manifest);
      const pinned=await recovery.read(manifest.sourceHash);context();
      if(pinned?.durable!==true||pinned.deviceRevision!==manifest.deviceRevision
        ||await api.hash(pinned.snapshot)!==manifest.sourceHash)throw Error('SPARK_RECOVERY_PIN_NOT_VERIFIED');
      const current=await source();
      if(current.sourceHash!==manifest.sourceHash||current.remoteRevision!==manifest.remoteRevision
        ||current.remoteHash!==manifest.remoteHash
        ||(current.deviceRevision||'')!==manifest.deviceRevision)throw Error('SPARK_IMPORT_SOURCE_CHANGED_STOP');
    }
    async function assertGuard(manifest){
      context();const guard=await readGuard();context();
      // Cheap durable metadata guard between chunks, not a full source read or
      // hash per batch. Full server/local hashes are verified at phase changes.
      if(guard?.ownerUid!==ownerUid||guard.deviceRevision!==manifest.deviceRevision
        ||guard.unknownOperations!==0||guard.mutationLockHeld!==true)throw Error('SPARK_IMPORT_DEVICE_GUARD_CHANGED_STOP');
    }
    async function transition(phase,manifest,equality=null){
      await assertPinned(manifest);
      await db.runTransaction(async tx=>{
        context();const snap=await tx.get(controlRef);const c=snap.data();
        if(!snap.exists||c.sourceHash!==manifest.sourceHash||c.remoteHash!==manifest.remoteHash||c.deviceRevision!==manifest.deviceRevision
          ||c.remoteRevision!==manifest.remoteRevision||c.buildSha!==buildSha||c.sourceDeviceId!==deviceId)throw Error('SPARK_IMPORT_CONTROL_CONFLICT');
        if(c.phase===phase)return;
        tx.update(controlRef,{phase,recordVersion:c.recordVersion+1,updatedAt:stamp(),
          ...(equality?{semanticEquality:'PASS',reconstructedHash:equality.reconstructedHash}:{})});
      });
      context();onProgress({phase});
    }
    async function begin(manifest,selected){
      await assertPinned(manifest);
      return db.runTransaction(async tx=>{
        context();const existing=await tx.get(controlRef);const legacy=await tx.get(legacyRef);
        if(!legacy.exists||legacy.data().revision!==selected.remoteRevision
          ||await api.hash(legacy.data().payload?.data)!==selected.remoteHash)throw Error('SPARK_IMPORT_REMOTE_DRIFT_STOP');
        if(existing.exists){
          const c=existing.data();
          if(c.sourceHash!==manifest.sourceHash||c.remoteHash!==selected.remoteHash||c.deviceRevision!==manifest.deviceRevision
            ||c.buildSha!==buildSha||c.sourceDeviceId!==deviceId||c.storageMode!=='migrating')throw Error('SPARK_IMPORT_ALREADY_CLAIMED');
          return c.phase;
        }
        tx.set(controlRef,{ownerUid,schemaVersion:2,storageMode:'migrating',phase:'MIGRATION_PREPARING',
          sourceHash:manifest.sourceHash,remoteHash:selected.remoteHash,remoteRevision:selected.remoteRevision,
          deviceRevision:manifest.deviceRevision,sourceDeviceId:deviceId,businessIds:manifest.businessIds,
          recordCount:manifest.recordCount,payloadBytes:manifest.payloadBytes,recordVersion:1,
          semanticEquality:'PENDING',reconstructedHash:'',buildSha,createdAt:stamp(),updatedAt:stamp(),updatedBy:ownerUid});
        return 'MIGRATION_PREPARING';
      });
    }
    async function writeShadow(manifest){
      let completed=0;
      for(const rows of shadowChunks(manifest.records)){
        await assertGuard(manifest);
        await db.runTransaction(async tx=>{
          context();const control=await tx.get(controlRef);
          if(control.data()?.phase!=='SHADOW_WRITING'||control.data()?.sourceHash!==manifest.sourceHash)throw Error('SPARK_SHADOW_PHASE_CONFLICT');
          // All IDs are known and independent. Bound requests to 100 records
          // AND 1 MiB including envelopes; all reads precede atomic writes.
          // Nothing is staged until EVERY authoritative read has completed.
          const existing=await Promise.all(rows.map(row=>tx.get(db.doc(row.path))));
          for(let i=0;i<rows.length;i++){
            if(existing[i].exists){
              if(api.canonicalJson(existing[i].data())!==api.canonicalJson(rows[i].content))throw Error('SPARK_SHADOW_EXISTING_RECORD_CONFLICT');
            }else tx.set(db.doc(rows[i].path),rows[i].content);
          }
        });
        completed+=rows.length;
        context();onProgress({phase:'SHADOW_WRITING',completed,total:manifest.recordCount});
      }
    }
    async function readShadow(manifest){
      const scopes=new Set(manifest.records.map(row=>row.path.slice(0,row.path.lastIndexOf('/'))));
      // Also query modules empty in the source. Reading expected IDs only can
      // miss stale/orphan records and falsely certify semantic equality.
      for(const businessId of manifest.businessIds){
        for(const moduleName of new Set([...Object.values(api.arrays),'config','metadata'])){
          scopes.add(`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/${moduleName}`);
        }
      }
      scopes.add(`businesses/${ownerUid}/legacyConfig`);
      const rows=[],collections=[...scopes];let next=0,completedScopes=0,failed=false;
      // Independent collection reads need not serialize all network round
      // trips. Keep the exact same scopes and 100-row pages, cap concurrency
      // at eight, and compare only after ALL workers finish successfully.
      // The measured temporary-query transport also pays latency for empty
      // modules. Keep those mandatory orphan checks, not serialized delays.
      const settled=await Promise.allSettled(Array.from({length:Math.min(8,collections.length)},async()=>{
        try{
          while(!failed&&next<collections.length){
            const scope=collections[next++];let cursor=null;
            do{
              context();let q=db.collection(scope).orderBy(firebase.firestore.FieldPath.documentId()).limit(100);
              if(cursor)q=q.startAfter(cursor);
              const page=await q.get({source:'server'});context();
              if(page.metadata.fromCache||page.metadata.hasPendingWrites)throw Error('SPARK_SERVER_READ_REQUIRED');
              for(const doc of page.docs)rows.push({path:doc.ref.path,content:doc.data()});
              cursor=page.size===100?page.docs.at(-1).id:null;
            }while(cursor&&!failed);
            if(!failed)onProgress({phase:'SHADOW_VERIFYING',stage:'server_read',completedScopes:++completedScopes,totalScopes:collections.length,recordsRead:rows.length});
          }
        }catch(error){failed=true;throw error;}
      }));
      const rejected=settled.find(result=>result.status==='rejected');
      if(rejected)throw rejected.reason;
      return rows;
    }
    async function prepareShadow(){
      const selected=await source();
      const manifest={...await api.plan({ownerUid,snapshot:selected.snapshot,identity:selected.identity,remoteRevision:selected.remoteRevision,deviceRevision:selected.deviceRevision||''}),
        remoteHash:selected.remoteHash};
      // Preserve original financial JSON exactly. Verified operational counters
      // and explicit immutable-history fences live outside that original data.
      // This is opt-in for the connected coordinator; a preservation-only
      // importer cannot silently turn a codec roundtrip into financial proof.
      const cashProofs=[];
      if(requireCashProof){
        for(const businessId of selected.businessIds){
          const proof=await api.deriveCashSummaries({snapshot:selected.snapshot,businessId,historicalReadOnly});
          if(!proof.canProceed)throw Error('SPARK_MIGRATION_CASH_PROOF_REQUIRED');
          cashProofs.push({businessId,...proof});
          for(const row of manifest.records.filter(row=>row.content.businessId===businessId)){
            const c=row.content,policy=proof.historyPlan?.historyPolicies[`${c.module}/${c.id}`];
            if(policy)c.historyPolicy=structuredClone(policy);
            else if(c.module==='cashSessions'&&proof.verified[c.id]){
              c.operational=structuredClone(proof.verified[c.id].summary);
              c.operationalHash=proof.verified[c.id].summaryHash;
            }
            if(api.byteLength(c)>api.MAX_RECORD_BYTES)throw Error('MIGRATION_RECORD_TOO_LARGE_STOP');
          }
        }
      }
      await assertGuard(manifest);
      await recovery.pin({sourceHash:manifest.sourceHash,snapshot:selected.snapshot,identity:selected.identity,deviceRevision:manifest.deviceRevision,
        remoteRevision:selected.remoteRevision,pendingOperations:selected.pendingOperations,buildSha});
      await assertPinned(manifest);
      let phase=await begin(manifest,selected);
      if(phase==='MIGRATION_PREPARING'){await transition('SHADOW_WRITING',manifest);phase='SHADOW_WRITING';}
      if(phase==='SHADOW_WRITING'){await writeShadow(manifest);await transition('SHADOW_VERIFYING',manifest);phase='SHADOW_VERIFYING';}
      if(!['SHADOW_VERIFYING','READY_TO_CUTOVER'].includes(phase))throw Error('SPARK_IMPORT_PHASE_UNSUPPORTED');
      let remoteRecords=await readShadow(manifest);
      // Semantic comparison proves original data; independently verify the
      // added operational/fence metadata from SERVER records as well. A
      // missing fence or a fabricated summary must never inherit equality.
      const expectedRecords=new Map(manifest.records.map(row=>[row.path,row.content]));
      const derivedRecords=remoteRecords.filter(row=>!expectedRecords.has(row.path));
      if(derivedRecords.length){
        const runtimePaths=new Set(manifest.businessIds.map(businessId=>`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/runtime`));
        if(derivedRecords.some(row=>!runtimePaths.has(row.path)))throw Error('MIGRATION_REMOTE_COUNT_MISMATCH');
        const approvalSnapshot=await db.doc(`businesses/${ownerUid}/storageApprovals/runtimePreparation`).get({source:'server'});context();
        if(approvalSnapshot.metadata?.fromCache!==false||approvalSnapshot.metadata?.hasPendingWrites!==false)
          throw Error('SPARK_RUNTIME_SERVER_REQUIRED');
        if(!approvalSnapshot.exists)throw Error('SPARK_RUNTIME_ADMIN_APPROVAL_REQUIRED');
        const approval=approvalSnapshot.data();
        const prepared=await prepareRuntime({captureHash:approval?.captureHash,validateOnly:true});
        const permitted=new Map(prepared.plan.runtimes.map(row=>[row.path,prepared.approval.runtimeRecords[row.content.businessId]]));
        for(const row of derivedRecords){
          if(!permitted.has(row.path)||api.canonicalJson(row.content)!==api.canonicalJson(permitted.get(row.path)))
            throw Error('SPARK_RUNTIME_UNAPPROVED_DERIVED_RECORD');
        }
        // Only these exact admin-approved derived runtime records are outside
        // legacy semantic reconstruction. Every other orphan still fails.
        remoteRecords=remoteRecords.filter(row=>expectedRecords.has(row.path));
      }
      for(const row of remoteRecords){
        const expected=expectedRecords.get(row.path);
        for(const key of ['historyPolicy','operational','operationalHash'])
          if(api.canonicalJson(row.content[key]??null)!==api.canonicalJson(expected?.[key]??null))
            throw Error('SPARK_SHADOW_FINANCIAL_METADATA_MISMATCH');
      }
      onProgress({phase:'SHADOW_VERIFYING',stage:'semantic_compare',recordCount:remoteRecords.length});
      const equality=await api.compare({manifest,remoteRecords,source:selected.snapshot});
      onProgress({phase:'SHADOW_VERIFYING',stage:'semantic_verified',recordCount:remoteRecords.length});
      await assertPinned(manifest);
      if(phase==='SHADOW_VERIFYING')await transition('READY_TO_CUTOVER',manifest,equality);
      // No implicit cutover: operational adapters, role Rules and real PWA
      // must be certified first. This module only prepares verified shadow.
      return {phase:'READY_TO_CUTOVER',manifest,equality,cashProofs,cutoverPerformed:false};
    }
    async function prepareRuntime({captureHash,validateOnly=false}){
      context();
      if(!requireCashProof||!recovery.readHandoff||!root.CLICK360_SPARK_HANDOFF)
        throw Error('SPARK_RUNTIME_VERIFIED_HANDOFF_REQUIRED');
      const policyRef=db.doc('storageRollout/sparkV1');
      const approvalRef=db.doc(`businesses/${ownerUid}/storageApprovals/runtimePreparation`);
      async function server(ref){
        context();const snap=await ref.get({source:'server'});context();
        if(snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites!==false)throw Error('SPARK_RUNTIME_SERVER_REQUIRED');
        return snap;
      }
      async function fresh(){
        const pinned=await recovery.readHandoff(captureHash);context();
        if(pinned?.durable!==true||pinned.plan?.ownerUid!==ownerUid)throw Error('SPARK_RUNTIME_VERIFIED_HANDOFF_REQUIRED');
        const plan=pinned.plan,selected=await source(),guard=await readGuard();context();
        if(guard?.ownerUid!==ownerUid||guard.mutationLockHeld!==true||guard.unknownOperations!==0
          ||guard.deviceRevision!==selected.deviceRevision||guard.deviceMetadataHash!==plan.deviceMetadataHash
          ||!guard.journalCapture||await api.hash(guard.journalCapture)!==plan.journalHash)
          throw Error('SPARK_RUNTIME_DEVICE_OR_JOURNAL_DRIFT_STOP');
        const financialProofs=[];
        for(const businessId of selected.businessIds)
          financialProofs.push({businessId,...await api.deriveCashSummaries({snapshot:selected.snapshot,businessId,historicalReadOnly})});
        const derived=await root.CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot:selected.snapshot,sourceHash:selected.sourceHash,
          deviceMetadataHash:guard.deviceMetadataHash,journalHash:plan.journalHash,journalCapture:guard.journalCapture,
          businessIds:selected.businessIds,financialProofs,unknownCount:0,conflictCount:0,historicalReadOnly});
        context();
        if(await api.hash(derived)!==await api.hash(plan))throw Error('SPARK_RUNTIME_HANDOFF_DRIFT_STOP');
        await assertPinned({...selected,deviceRevision:selected.deviceRevision||''});
        const approval=await root.CLICK360_SPARK_HANDOFF.runtimeApproval(plan,buildSha);
        if(approval.captureHash!==captureHash)throw Error('SPARK_RUNTIME_HANDOFF_CAPTURE_MISMATCH');
        return {plan,selected,approval};
      }
      function approved(policy,approval,expected){
        return policy?.enabled===true&&policy.automaticRuntimePreparation===true
          &&Array.isArray(policy.pilotOwnerUids)&&policy.pilotOwnerUids.includes(ownerUid)
          &&api.canonicalJson(approval??null)===api.canonicalJson(expected);
      }
      function controlled(c,{plan,selected}){
        return c?.ownerUid===ownerUid&&c.schemaVersion===2&&c.storageMode==='migrating'&&c.phase==='READY_TO_CUTOVER'
          &&c.semanticEquality==='PASS'&&c.sourceHash===plan.sourceHash&&c.reconstructedHash===plan.sourceHash
          &&c.remoteHash===selected.remoteHash&&c.remoteRevision===selected.remoteRevision
          &&c.deviceRevision===selected.deviceRevision&&c.sourceDeviceId===deviceId&&c.buildSha===buildSha
          &&api.canonicalJson([...(c.businessIds||[])].sort())===api.canonicalJson(plan.businessIds);
      }
      let verified=await fresh();
      if(!approved((await server(policyRef)).data(),(await server(approvalRef)).data(),verified.approval))throw Error('SPARK_RUNTIME_ADMIN_APPROVAL_REQUIRED');
      if(!controlled((await server(controlRef)).data(),verified))throw Error('SPARK_RUNTIME_CONTROL_CONFLICT');
      if(validateOnly===true)return {status:'RUNTIME_PLAN_VALIDATED',plan:verified.plan,approval:verified.approval,
        operationalCloudConfirmed:false,cutoverPerformed:false};
      for(const row of verified.plan.runtimes){
        verified=await fresh();
        const baseRuntime=verified.plan.runtimes.find(r=>r.path===row.path);
        if(!baseRuntime)throw Error('SPARK_RUNTIME_BUSINESS_COVERAGE_REQUIRED');
        const expected={...baseRuntime,content:verified.approval.runtimeRecords[baseRuntime.content.businessId]};
        await db.runTransaction(async tx=>{
          context();
          const [control,policy,authorization,legacy,existing]=await Promise.all([
            tx.get(controlRef),tx.get(policyRef),tx.get(approvalRef),tx.get(legacyRef),tx.get(db.doc(row.path))]);context();
          if(!approved(policy.data(),authorization.data(),verified.approval))throw Error('SPARK_RUNTIME_ADMIN_APPROVAL_REQUIRED');
          if(!controlled(control.data(),verified))throw Error('SPARK_RUNTIME_CONTROL_CONFLICT');
          if(!legacy.exists||legacy.data().revision!==verified.selected.remoteRevision
            ||await api.hash(legacy.data().payload?.data)!==verified.selected.remoteHash)throw Error('SPARK_RUNTIME_REMOTE_DRIFT_STOP');
          const active=expected.content.data.openCashSessionId;
          if(active){
            const session=await tx.get(db.doc(`businesses/${ownerUid}/businessUnits/${expected.content.businessId}/storage/v2/cashSessions/${active}`));context();
            const raw=session.data();
            if(!session.exists||raw?.historyPolicy||raw.ownerUid!==ownerUid||raw.businessId!==expected.content.businessId
              ||raw.data?.status!=='open'||raw.operational?.summaryVersion!==1
              ||raw.operationalHash!==expected.openSessionSummaryHash||await api.hash(raw.operational)!==expected.openSessionSummaryHash
              ||api.canonicalJson(raw.operational)!==api.canonicalJson(expected.openSessionSummary))
              throw Error('SPARK_RUNTIME_EXACT_SESSION_UNVERIFIED');
          }
          if(existing.exists){
            if(api.canonicalJson(existing.data())!==api.canonicalJson(expected.content))throw Error('SPARK_RUNTIME_EXISTING_CONFLICT');
          }else tx.set(db.doc(row.path),expected.content);
        });
        context();onProgress({phase:'RUNTIME_PREPARING',businessId:row.content.businessId,operationalCloudConfirmed:false});
      }
      verified=await fresh();
      for(const row of verified.plan.runtimes){
        const actual=await server(db.doc(row.path));
        if(!actual.exists||await api.hash(actual.data())!==verified.approval.preparedRuntimeHashes[row.content.businessId]
          ||api.canonicalJson(actual.data())!==api.canonicalJson(verified.approval.runtimeRecords[row.content.businessId]))throw Error('SPARK_RUNTIME_SERVER_RECORD_MISMATCH');
        const flat=await root.CLICK360_SPARK_RECORD_CODEC.unpack(actual.data(),
          {identity:{ownerUid,businessId:row.content.businessId},moduleName:'metadata',recordId:'runtime'});context();
        if(flat.summaryVersion!==1||flat.openCashSessionId!==row.content.data.openCashSessionId)throw Error('SPARK_RUNTIME_SERVER_RECORD_MISMATCH');
      }
      if(!controlled((await server(controlRef)).data(),verified)
        ||!approved((await server(policyRef)).data(),(await server(approvalRef)).data(),verified.approval))throw Error('SPARK_RUNTIME_CONTROL_CONFLICT');
      return {status:'RUNTIME_PREPARED',planHash:verified.plan.planHash,runtimeHashes:verified.approval.preparedRuntimeHashes,
        storageMode:'migrating',phase:'READY_TO_CUTOVER',operationalCloudConfirmed:false,cutoverPerformed:false};
    }
    return Object.freeze({prepareShadow,prepareRuntime});
  }
  root.CLICK360_SPARK_IMPORTER=Object.freeze({create,shadowChunks,SHADOW_CHUNK_RECORDS,SHADOW_CHUNK_BYTES});
})(typeof window==='undefined'?globalThis:window);
