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
  root.CLICK360_SPARK_RECONCILIATION=Object.freeze({statuses,classify,reconcile,reconcileJournal,capacitySnapshotProof});
})(typeof window==='undefined'?globalThis:window);
