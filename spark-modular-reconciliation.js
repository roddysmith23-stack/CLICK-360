(function(root){
  'use strict';
  const statuses=Object.freeze(['CONFIRMED_REMOTE','LOCAL_PENDING','UNKNOWN','CONFLICT']);
  function classify({identity,operation,authority}){
    const operationId=operation?.operationId;
    const result=(status,reason)=>({operationId,status,reason,replayAllowed:status==='LOCAL_PENDING'});
    if(!identity?.ownerUid||!identity?.businessId||!operationId
      ||operation.ownerUid!==identity.ownerUid||operation.businessId!==identity.businessId
      ||!/^[a-f0-9]{64}$/.test(operation.payloadHash||''))return result('CONFLICT','operation_identity_or_hash_invalid');
    if(authority?.source!=='server'||typeof authority.exists!=='boolean')return result('UNKNOWN','fresh_server_evidence_required');
    if(!authority.exists)return result('LOCAL_PENDING','server_ledger_absent_transaction_must_recheck');
    const record=authority.record;
    if(record?.ownerUid!==identity.ownerUid||record.businessId!==identity.businessId||record.operationId!==operationId
      ||record.payloadHash!==operation.payloadHash)return result('CONFLICT','server_ledger_identity_or_payload_conflict');
    if(record.status!=='committed')return result('UNKNOWN','server_operation_not_committed');
    return result('CONFIRMED_REMOTE','server_ledger_exact_match');
  }
  async function reconcile({identity,operations,lookupOperation}){
    if(!Array.isArray(operations)||typeof lookupOperation!=='function')throw Error('SPARK_RECONCILIATION_INPUT_REQUIRED');
    const seen=new Set(),results=[];
    for(const operation of operations){
      if(seen.has(operation.operationId))throw Error('SPARK_RECONCILIATION_DUPLICATE_OPERATION');
      seen.add(operation.operationId);
      let authority;
      try{authority=await lookupOperation(operation);}catch{authority={source:'unavailable'};}
      results.push(classify({identity,operation,authority}));
    }
    return {results,unknownCount:results.filter(r=>r.status==='UNKNOWN').length,
      conflictCount:results.filter(r=>r.status==='CONFLICT').length,
      confirmedCount:results.filter(r=>r.status==='CONFIRMED_REMOTE').length,
      localPendingCount:results.filter(r=>r.status==='LOCAL_PENDING').length,
      canProceed:results.every(r=>!['UNKNOWN','CONFLICT'].includes(r.status))};
  }
  async function capacitySnapshotProof({ownerUid,localRecord,remote,unknownOperations}){
    const api=root.CLICK360_SPARK_MIGRATION;
    if(!api||localRecord?.durable!==true||localRecord.cloudCapacityBlocked!==true||localRecord.pendingRemoteSync!==true
      ||!localRecord.snapshot||!Array.isArray(localRecord.pendingOperations)
      ||localRecord.pendingOperations.some(id=>typeof id!=='string'||!id)
      ||new Set(localRecord.pendingOperations).size!==localRecord.pendingOperations.length)throw Error('SPARK_CAPACITY_PENDING_PROOF_REQUIRED');
    const selected=await api.selectSource({ownerUid,remote,local:{identity:localRecord.identity||localRecord.snapshot.identity,durable:true,
      snapshot:localRecord.snapshot,deviceRevision:localRecord.deviceRevision,baseRevision:localRecord.baseRevision,
      pendingRemoteSync:true,pendingOperations:localRecord.pendingOperations},unknownOperations});
    // The legacy capacity bridge never sent an oversized document. These are
    // snapshot persistence IDs, NOT executable commercial commands. Preserve
    // their state through import; never reconstruct/replay a sale from them.
    const sourceHash=await api.hash(selected.snapshot);
    return {sourceHash,remoteRevision:selected.remoteRevision,deviceRevision:selected.deviceRevision,
      source:selected.source,results:localRecord.pendingOperations.map(operationId=>({operationId,
        status:'LOCAL_PENDING',reason:'durable_capacity_snapshot_not_sent',replayAllowed:false,action:'IMPORT_RECONCILED_SOURCE_ONLY'}))};
  }
  async function reconcileJournal({identity,journal,lookupOperation,assertSourceStable,pageSize=100}){
    if(typeof journal?.listPendingPage!=='function'||typeof journal.countPending!=='function'
      ||typeof journal.countProjectionPending!=='function'
      ||typeof lookupOperation!=='function'||typeof assertSourceStable!=='function')throw Error('SPARK_FULL_OUTBOX_GUARD_REQUIRED');
    // Caller must hold a durable migration/source fence. This helper never
    // claims, confirms, deletes or replays an operation during enumeration.
    await assertSourceStable();
    if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw Error('SPARK_OUTBOX_PAGE_SIZE_INVALID');
    const before=await journal.countPending(identity),results=[],seen=new Set(),cursors=new Set();
    const projectionPendingCount=await journal.countProjectionPending(identity);
    if(!Number.isSafeInteger(projectionPendingCount)||projectionPendingCount<0)throw Error('SPARK_PROJECTION_COUNT_REQUIRED');
    if(before.countIsBounded!==false||!Number.isSafeInteger(before.total)||before.total<0)throw Error('SPARK_FULL_OUTBOX_COUNT_REQUIRED');
    let after=null,pages=0;
    do{
      await assertSourceStable();
      const page=await journal.listPendingPage(identity,{limit:pageSize,after});
      if(!Array.isArray(page.rows)||page.rows.length>pageSize||page.complete!==!page.next)throw Error('SPARK_INCOMPLETE_OUTBOX_PAGE');
      if(page.next){
        const cursor=JSON.stringify(page.next);
        if(!page.rows.length||cursors.has(cursor))throw Error('SPARK_OUTBOX_CURSOR_NOT_ADVANCING');
        cursors.add(cursor);
      }
      for(const operation of page.rows){
        if(seen.has(operation.operationId))throw Error('SPARK_RECONCILIATION_DUPLICATE_OPERATION');
        seen.add(operation.operationId);
        let authority;
        try{authority=await lookupOperation(operation);}catch{authority={source:'unavailable'};}
        results.push(classify({identity,operation,authority}));
      }
      after=page.next;pages++;
      if(results.length>before.total||pages>before.total+1)throw Error('SPARK_OUTBOX_CHANGED_STOP');
    }while(after);
    await assertSourceStable();
    const final=await journal.countPending(identity);
    if(await journal.countProjectionPending(identity)!==projectionPendingCount)throw Error('SPARK_OUTBOX_CHANGED_STOP');
    if(before.countIsBounded!==false||final.countIsBounded!==false||results.length!==before.total
      ||final.total!==before.total||final.pendingCount!==before.pendingCount||final.unknownCount!==before.unknownCount)
      throw Error('SPARK_OUTBOX_CHANGED_STOP');
    const unknownCount=results.filter(row=>row.status==='UNKNOWN').length,conflictCount=results.filter(row=>row.status==='CONFLICT').length;
    return {results,pages,enumerationComplete:true,unknownCount,conflictCount,projectionPendingCount,
      confirmedCount:results.filter(row=>row.status==='CONFIRMED_REMOTE').length,
      localPendingCount:results.filter(row=>row.status==='LOCAL_PENDING').length,
      canProceed:unknownCount===0&&conflictCount===0&&projectionPendingCount===0};
  }
  // Preparation only. No importer, journal mutation, replay, approval or writer.
  async function recoveryPreflight({ownerUid,baseline,current,remote,lookupOperation}){
    const api=root.CLICK360_SPARK_MIGRATION,hash=api.hash;
    for(const capture of [baseline,current]){
      if(capture?.ownerUid!==ownerUid||!capture.record?.snapshot||capture.journalCapture?.ownerUid!==ownerUid
        ||capture.journalCapture.enumerationComplete!==true||!Array.isArray(capture.journalCapture.rows)
        ||capture.journalCapture.recordCount!==capture.journalCapture.rows.length)throw Error('P0D_COMPLETE_CAPTURE_REQUIRED');
    }
    if(current.deviceId!==baseline.deviceId)throw Error('P0D_ORIGINAL_DEVICE_REQUIRED');
    const operations=current.journalCapture.rows,results=[],seen=new Set();
    for(const operation of operations){
      if(seen.has(operation.key))throw Error('P0D_DUPLICATE_JOURNAL_ROW');seen.add(operation.key);
      if(operation.ownerUid!==ownerUid||operation.key!==`${ownerUid}:${operation.businessId}:${operation.operationId}`)
        throw Error('P0D_JOURNAL_IDENTITY_CONFLICT');
      let authority;try{authority=await lookupOperation(operation);}catch{authority={source:'unavailable'};}
      results.push(classify({identity:{ownerUid,businessId:operation.businessId},operation,authority}));
    }
    const unknownCount=results.filter(r=>r.status==='UNKNOWN').length,conflictCount=results.filter(r=>r.status==='CONFLICT').length;
    if(operations.length)return {status:'CLIENT_PREFLIGHT_BLOCKED',reason:unknownCount?'P0D_UNKNOWN_STOP':conflictCount?'P0D_CONFLICT_STOP':'P0D_COMMAND_SOURCE_COVERAGE_REQUIRED',
      operationCount:operations.length,unknownCount,conflictCount,pendingCount:results.filter(r=>r.status==='LOCAL_PENDING').length,
      confirmedCount:results.filter(r=>r.status==='CONFIRMED_REMOTE').length,replayAllowed:false,cutover:false};
    const source=await api.selectSource({ownerUid,remote,local:{...current.record,durable:true},unknownOperations:0});
    if(!Array.isArray(baseline.record.snapshot.businesses)||baseline.record.snapshot.businesses.some(b=>!source.businessIds.includes(b.id)))
      throw Error('P0D_HISTORICAL_BUSINESS_OMITTED');
    const manifest=await api.plan({ownerUid,snapshot:source.snapshot,identity:source.identity,remoteRevision:source.remoteRevision,deviceRevision:source.deviceRevision});
    const comparison=await api.compare({manifest,source:source.snapshot,remoteRecords:structuredClone(manifest.records)});
    if(comparison.reconstructedHash!==source.sourceHash)throw Error('P0D_RECONSTRUCTION_MISMATCH');
    const old=await api.plan({ownerUid,snapshot:baseline.record.snapshot,identity:baseline.record.identity||baseline.record.snapshot.identity,
      remoteRevision:baseline.record.baseRevision??source.remoteRevision,deviceRevision:baseline.record.deviceRevision});
    const prior=new Map(old.records.map(r=>[r.path,r.content])),next=new Map(manifest.records.map(r=>[r.path,r.content]));
    const differences={added:[],removed:[],changed:[]};
    // Every import wrapper carries the whole sourceHash. That provenance
    // changes on any edit; only material dataHash identifies a changed record.
    for(const [path,record]of next)if(!prior.has(path))differences.added.push(path);else if(record.dataHash!==prior.get(path).dataHash)differences.changed.push(path);
    for(const path of prior.keys())if(!next.has(path))differences.removed.push(path);
    const financialPath=path=>/\/storage\/v2\/(sales|movements|cashSessions|dailyReports|auditEvents|operationLedger|layaways)\//.test(path);
    if(differences.removed.some(financialPath))throw Error('P0D_HISTORICAL_RECORD_REMOVED');
    for(const path of differences.changed){
      const before=prior.get(path).data,after=next.get(path).data;
      if(/\/storage\/v2\/sales\//.test(path)){
        for(const field of ['id','businessId','date','cashSessionId','total','subtotal','tax','discount','items'])
          if(api.canonicalJson({value:before[field]??null})!==api.canonicalJson({value:after[field]??null}))throw Error('P0D_HISTORICAL_SALE_MATERIAL_CHANGED');
        const oldPayments=before.payments||[],payments=after.payments||[];
        if(payments.length<oldPayments.length||await hash(payments.slice(0,oldPayments.length))!==await hash(oldPayments))throw Error('P0D_HISTORICAL_PAYMENTS_CHANGED');
      }
      if(/\/storage\/v2\/(dailyReports|auditEvents|operationLedger)\//.test(path)
        ||(/\/storage\/v2\/cashSessions\//.test(path)&&before.status==='closed'))throw Error('P0D_IMMUTABLE_HISTORY_CHANGED');
    }
    const proofs=[];
    for(const businessId of source.businessIds){
      const proof=await api.deriveCashSummaries({snapshot:source.snapshot,businessId,historicalReadOnly:true});
      if(!proof.canProceed)throw Error('P0D_FINANCIAL_PROOF_BLOCKED');proofs.push({businessId,...proof});
    }
    for(const product of source.snapshot.products||[])if(!Number.isFinite(product.stock)||product.stock!==product.qty)throw Error('P0D_STOCK_CONFLICT');
    const metadata=Object.fromEntries(Object.entries(current.record).filter(([key])=>key!=='snapshot'));
    const handoff=await root.CLICK360_SPARK_HANDOFF.plan({ownerUid,snapshot:source.snapshot,sourceHash:source.sourceHash,
      deviceMetadataHash:await hash(metadata),journalHash:await hash(current.journalCapture),journalCapture:current.journalCapture,
      businessIds:source.businessIds,financialProofs:proofs,unknownCount:0,conflictCount:0,historicalReadOnly:true});
    return {status:'CLIENT_PREFLIGHT_READY',reason:'P0D_OWNER_REVIEW_REQUIRED',sourceHash:source.sourceHash,
      reconstructedHash:comparison.reconstructedHash,planHash:handoff.planHash,differenceHash:await hash(differences),
      changedRecords:differences.added.length+differences.removed.length+differences.changed.length,
      businessCount:source.businessIds.length,recordCount:manifest.recordCount,
      verifiedSessions:proofs.reduce((n,p)=>n+Object.keys(p.verified).length,0),
      protectedHistoryRecords:proofs.reduce((n,p)=>n+Object.keys(p.historyPlan?.historyPolicies||{}).length,0),
      operationCount:0,unknownCount:0,conflictCount:0,pendingCount:0,confirmedCount:0,replayAllowed:false,cutover:false};
  }
  function createDevicePreflight({db,firebase,ownerUid,actorUid,buildSha,copy,assertContext,readLocal,captureJournal}){
    const api=root.CLICK360_SPARK_MIGRATION,hash=api.hash;
    const id=value=>typeof value==='string'&&value.length>0&&value.length<=120&&!/[/.]/.test(value);
    if(!id(ownerUid)||actorUid!==ownerUid||!/^[a-f0-9]{12}$/.test(buildSha))throw Error('P0D_OWNER_BUILD_REQUIRED');
    const server=async ref=>{assertContext();const s=await ref.get({source:'server'});assertContext();
      if(s.metadata?.fromCache!==false||s.metadata?.hasPendingWrites!==false)throw Error('P0D_SERVER_REQUIRED');return s;};
    async function capture(captureHash){
      if(!/^[a-f0-9]{64}$/.test(captureHash||''))throw Error('P0D_CAPTURE_HASH_REQUIRED');
      const ref=db.doc(`businesses/${ownerUid}/recoveryCopies/${captureHash}`),manifest=(await server(ref)).data();
      if(manifest?.state!=='CLIENT_VERIFIED'||manifest.ownerUid!==ownerUid||manifest.captureHash!==captureHash)throw Error('P0D_VERIFIED_COPY_REQUIRED');
      const pieces=[];let after=null;
      do{let q=ref.collection('parts').orderBy('position').limit(100);if(after!==null)q=q.startAfter(after);
        const page=await server(q);
        for(const doc of page.docs){const p=doc.data();if(doc.id!==`p${pieces.length}`||p.position!==pieces.length||p.ownerUid!==ownerUid
          ||p.captureHash!==captureHash||await hash(p.content)!==p.contentHash)throw Error('P0D_PART_CORRUPT');pieces.push(p);}
        if(pieces.length>manifest.partCount)throw Error('P0D_PART_COUNT');after=page.docs.length===100?pieces.length-1:null;
      }while(after!==null);
      if(pieces.length!==manifest.partCount)throw Error('P0D_PART_COUNT');
      const text=pieces.map(p=>p.content).join(''),value=JSON.parse(text);
      if(api.byteLength(value)!==manifest.payloadBytes||await hash(value)!==captureHash||value.ownerUid!==ownerUid
        ||value.deviceId!==manifest.deviceId||value.buildSha!==manifest.buildSha
        ||await hash(value.record.snapshot)!==manifest.sourceHash||await hash(value.journalCapture)!==manifest.journalHash)throw Error('P0D_CAPTURE_INTEGRITY');
      return {manifest,value};
    }
    return Object.freeze({async prepare(){
      const policyRef=db.doc(`businesses/${ownerUid}/recoveryPreflightPolicy/main`),policy=(await server(policyRef)).data();
      if(policy?.enabled!==true)return {status:'DISABLED',cutover:false};
      if(policy.ownerUid!==ownerUid||policy.buildSha!==buildSha||copy?.status!=='RECOVERY_COPY_CLIENT_VERIFIED'
        ||copy.serverReadVerified!==true)throw Error('P0D_POLICY_COPY_REQUIRED');
      const policyHash=await hash(policy),baseline=await capture(policy.baselineCaptureHash),current=await capture(copy.captureHash);
      if(baseline.manifest.sourceHash!==policy.baselineSourceHash||await hash(current.value.deviceId)!==policy.deviceIdHash
        ||current.manifest.buildSha!==buildSha)throw Error('P0D_POLICY_SOURCE_MISMATCH');
      if(!Array.isArray(policy.businessIds)||await hash([...policy.businessIds].sort())!==await hash(current.value.record.snapshot.businesses.map(b=>b.id).sort()))throw Error('P0D_POLICY_BUSINESS_COVERAGE');
      const stable=async()=>{assertContext();const local=await readLocal(),journal=await captureJournal();assertContext();
        if(await hash(local)!==await hash(current.value.record)||await hash(journal)!==await hash(current.value.journalCapture))throw Error('P0D_CURRENT_DEVICE_DRIFT');};
      await stable();
      const legacyRef=db.doc(`businesses/${ownerUid}/state/main`),legacy=(await server(legacyRef)).data();
      if(legacy?.revision!==current.manifest.remoteRevision||await hash(legacy.payload?.data)!==current.manifest.remoteHash)throw Error('P0D_REMOTE_DRIFT');
      let result;
      try{result=await recoveryPreflight({ownerUid,baseline:baseline.value,current:current.value,
        remote:{source:'server',revision:legacy.revision,identity:legacy.payload.identity,snapshot:legacy.payload.data},
        lookupOperation:async operation=>{
          if(!id(operation.businessId)||!id(operation.operationId))throw Error('P0D_OPERATION_ID_INVALID');
          const s=await server(db.doc(`businesses/${ownerUid}/businessUnits/${operation.businessId}/storage/v2/operationLedger/${operation.operationId}`));
          return {source:'server',exists:s.exists,record:s.exists?await root.CLICK360_SPARK_RECORD_CODEC.unpack(s.data(),
            {identity:{ownerUid,businessId:operation.businessId},moduleName:'operationLedger',recordId:operation.operationId}):null};
        }});}catch(error){
        result={status:'CLIENT_PREFLIGHT_BLOCKED',reason:/^(P0D|SPARK|MIGRATION)_[A-Z_]+$/.test(error.message)?error.message:'P0D_FINANCIAL_CHECK_FAILED',
          operationCount:current.value.journalCapture.recordCount,unknownCount:current.value.journalCapture.rows.filter(r=>['unknown','inflight'].includes(r.state)).length,
          conflictCount:1,pendingCount:0,confirmedCount:0,replayAllowed:false,cutover:false};
      }
      await stable();
      if(await hash((await server(policyRef)).data())!==policyHash)throw Error('P0D_POLICY_CHANGED');
      const freshLegacy=(await server(legacyRef)).data();
      if(freshLegacy?.revision!==legacy.revision||await hash(freshLegacy.payload?.data)!==current.manifest.remoteHash)throw Error('P0D_REMOTE_DRIFT');
      const reportId=await hash({captureHash:copy.captureHash,policyHash,buildSha});
      const report={ownerUid,reportId,schemaVersion:1,buildSha,policyHash,baselineCaptureHash:policy.baselineCaptureHash,
        baselineSourceHash:policy.baselineSourceHash,captureHash:copy.captureHash,sourceHash:current.manifest.sourceHash,
        journalHash:current.manifest.journalHash,deviceIdHash:policy.deviceIdHash,...result};
      const ref=db.doc(`businesses/${ownerUid}/recoveryPreflights/${reportId}`);
      await db.runTransaction(async tx=>{assertContext();const s=await tx.get(ref);assertContext();
        if(s.exists){const {createdAt,...existing}=s.data();if(await hash(existing)!==await hash(report))throw Error('P0D_REPORT_CONFLICT');}
        else tx.set(ref,{...report,createdAt:firebase.firestore.FieldValue.serverTimestamp()});});
      const final=(await server(ref)).data(),{createdAt,...verified}=final||{};
      if(await hash(verified)!==await hash(report))throw Error('P0D_REPORT_CONFIRMATION_REQUIRED');
      return {status:report.status,reportId,captureHash:copy.captureHash,sourceHash:report.sourceHash,operationalCloudConfirmed:false,cutover:false};
    }});
  }
  root.CLICK360_SPARK_RECONCILIATION=Object.freeze({statuses,classify,reconcile,reconcileJournal,capacitySnapshotProof,recoveryPreflight,createDevicePreflight});
})(typeof window==='undefined'?globalThis:window);
