(function(root){
  'use strict';
  // Pure preparation only: no SDK, journal mutation, mode change or writer.
  // Derived runtime is NOT part of the preserved legacy source or its hash.
  function validateReceivableLinks(snapshot){
    const ids=snapshot.businesses.map(b=>b.id),scope=row=>row.businessId||snapshot.settings?.legacyDataBusinessId||(ids.length===1?ids[0]:'');
    const active=new Set(['active','partially_paid','paid','expired','ready_for_pickup']);
    for(const sale of snapshot.sales||[]){
      if(sale.method!=='Apartado')continue;
      const linked=(snapshot.layaways||[]).filter(r=>scope(r)===scope(sale)&&r.saleId===sale.id);
      if(!['layaway','pending_payment'].includes(sale.status)&&!linked.some(r=>active.has(r.status)))continue;
      const row=linked[0];
      if(linked.length!==1||!row.id||!ids.includes(scope(sale))
        ||(Object.hasOwn(sale,'layawayId')&&sale.layawayId!==row.id)
        ||[sale.total,sale.received,sale.balance].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0)
        ||Math.round((sale.received+sale.balance)*100)!==Math.round(sale.total*100)
        ||row.total!==sale.total||row.paid!==sale.received||row.balance!==sale.balance
        ||root.CLICK360_SPARK_MIGRATION.canonicalJson(row.payments||[])!==root.CLICK360_SPARK_MIGRATION.canonicalJson(sale.payments||[]))
        throw Error('SPARK_HANDOFF_ACTIVE_RECEIVABLE_RELATIONSHIP_CONFLICT');
    }
    for(const row of snapshot.layaways||[])if(active.has(row.status)
      &&(snapshot.sales||[]).filter(s=>s.id===row.saleId&&scope(s)===scope(row)&&s.method==='Apartado').length!==1)
      throw Error('SPARK_HANDOFF_ACTIVE_RECEIVABLE_RELATIONSHIP_CONFLICT');
    return true;
  }
  async function plan({ownerUid,snapshot,sourceHash,deviceMetadataHash,journalHash,journalCapture,
    businessIds,financialProofs,unknownCount,conflictCount,historicalReadOnly=false}){
    const api=root.CLICK360_SPARK_MIGRATION;
    if(!api||typeof ownerUid!=='string'||!ownerUid||ownerUid.includes('/'))throw Error('SPARK_HANDOFF_OWNER_REQUIRED');
    const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
    if(![sourceHash,deviceMetadataHash,journalHash].every(hash)
      ||await api.hash(snapshot)!==sourceHash)throw Error('SPARK_HANDOFF_SOURCE_HASH_MISMATCH');
    if(!Array.isArray(snapshot?.businesses)||!Array.isArray(businessIds)||!businessIds.length
      ||businessIds.some(id=>typeof id!=='string'||!id||id.includes('/'))
      ||new Set(businessIds).size!==businessIds.length
      ||snapshot.businesses.length!==businessIds.length
      ||snapshot.businesses.some(b=>!businessIds.includes(b.id))
      ||new Set(snapshot.businesses.map(b=>b.id)).size!==businessIds.length)
      throw Error('SPARK_HANDOFF_OWNER_COVERAGE_REQUIRED');
    if(snapshot.identity&&[snapshot.identity.ownerUid,snapshot.identity.ownerId].some(id=>id!==ownerUid))
      throw Error('SPARK_HANDOFF_SOURCE_OWNER_MISMATCH');
    validateReceivableLinks(snapshot);
    if(unknownCount!==0||conflictCount!==0)throw Error('SPARK_HANDOFF_UNRESOLVED_OPERATIONS');
    if(journalCapture?.ownerUid!==ownerUid||journalCapture.enumerationComplete!==true
      ||!Array.isArray(journalCapture.rows)||journalCapture.recordCount!==journalCapture.rows.length
      ||await api.hash(journalCapture)!==journalHash)throw Error('SPARK_HANDOFF_FULL_JOURNAL_REQUIRED');
    // The local source may already include each command's optimistic delta.
    // Never replay that command after importing the same snapshot. A future
    // typed command/source coverage proof is required for nonempty journals.
    if(journalCapture.rows.length)throw Error('SPARK_HANDOFF_COMMAND_COVERAGE_REQUIRED');
    if(!Array.isArray(financialProofs)||financialProofs.length!==businessIds.length
      ||new Set(financialProofs.map(p=>p.businessId)).size!==businessIds.length
      ||financialProofs.some(p=>!businessIds.includes(p.businessId)))throw Error('SPARK_HANDOFF_FINANCIAL_COVERAGE_REQUIRED');
    const runtimes=[],financialProofHashes={};
    for(const businessId of [...businessIds].sort()){
      const supplied=financialProofs.find(p=>p.businessId===businessId),{businessId:ignored,...proof}=supplied;
      const expected=await api.deriveCashSummaries({snapshot,businessId,historicalReadOnly});
      if(!expected.canProceed||await api.hash(expected)!==await api.hash(proof))
        throw Error('SPARK_HANDOFF_FINANCIAL_PROOF_MISMATCH');
      const scoped=(snapshot.cashSessions||[]).filter(row=>{
        const assigned=row.businessId||snapshot.settings?.legacyDataBusinessId||(businessIds.length===1?businessId:'');
        if(!businessIds.includes(assigned))throw Error('SPARK_HANDOFF_AMBIGUOUS_SESSION_OWNER');
        return assigned===businessId;
      });
      const open=scoped.filter(row=>row.status==='open');
      if(open.length>1)throw Error('SPARK_HANDOFF_MULTIPLE_OPEN_SESSIONS');
      const active=open[0],verified=active&&expected.verified[active.id];
      if(active&&(!verified||verified.summary?.summaryVersion!==1
        ||verified.summaryHash!==await api.hash(verified.summary)
        ||expected.historyPlan?.historyPolicies?.[`cashSessions/${active.id}`]))
        throw Error('SPARK_HANDOFF_OPEN_SESSION_UNVERIFIED');
      const data={id:'runtime',businessId,summaryVersion:1,openCashSessionId:active?.id||''};
      runtimes.push({path:`businesses/${ownerUid}/businessUnits/${businessId}/storage/v2/metadata/runtime`,
        content:{id:'runtime',ownerUid,businessId,schemaVersion:2,module:'metadata',recordVersion:1,
          data,dataHash:await api.hash(data)},
        openSessionSummaryHash:verified?.summaryHash||null,
        openSessionSummary:verified?structuredClone(verified.summary):null,
        closedReadOnlySessionIds:scoped.filter(row=>expected.historyPlan?.historyPolicies?.[`cashSessions/${row.id}`]).map(row=>row.id).sort()});
      financialProofHashes[businessId]=await api.hash(expected);
    }
    const result={version:1,status:'READ_ONLY_HANDOFF_PLAN',ownerUid,sourceHash,deviceMetadataHash,journalHash,
      businessIds:[...businessIds].sort(),financialProofHashes,runtimes,
      journalReplayAllowed:false,operationalActivationAllowed:false,cutoverAllowed:false};
    return {...result,planHash:await api.hash(result)};
  }
  // Produces an administrative approval candidate only. This helper never
  // publishes policy or grants the current client authority to approve it.
  async function runtimeApproval(plan,buildSha){
    const api=root.CLICK360_SPARK_MIGRATION,{planHash,...material}=plan||{};
    if(!api||plan?.status!=='READ_ONLY_HANDOFF_PLAN'||plan.cutoverAllowed!==false
      ||plan.operationalActivationAllowed!==false||plan.journalReplayAllowed!==false
      ||await api.hash(material)!==planHash||!/^[a-f0-9]{12,40}$/.test(buildSha||''))
      throw Error('SPARK_RUNTIME_APPROVAL_PLAN_REQUIRED');
    const runtimeRecords={},runtimeHashes={},preparedRuntimeHashes={},openSessionSummaries={},openSessionSummaryHashes={};
    for(const row of plan.runtimes){
      const businessId=row.content.businessId;
      const record=structuredClone(row.content);runtimeHashes[businessId]=await api.hash(record);
      record.data.preparation={planHash,sourceHash:plan.sourceHash,buildSha,
        deviceMetadataHash:plan.deviceMetadataHash,journalHash:plan.journalHash,runtimeHash:runtimeHashes[businessId]};
      record.dataHash=await api.hash(record.data);runtimeRecords[businessId]=record;
      preparedRuntimeHashes[businessId]=await api.hash(record);
      openSessionSummaries[businessId]=structuredClone(row.openSessionSummary);
      openSessionSummaryHashes[businessId]=row.openSessionSummaryHash;
    }
    const captureHash=await api.hash({kind:'READ_ONLY_HANDOFF_PLAN',ownerUid:plan.ownerUid,plan});
    return {ownerUid:plan.ownerUid,sourceHash:plan.sourceHash,buildSha,planHash,captureHash,
      deviceMetadataHash:plan.deviceMetadataHash,journalHash:plan.journalHash,businessIds:[...plan.businessIds],
      runtimeRecords,runtimeHashes,preparedRuntimeHashes,openSessionSummaries,openSessionSummaryHashes};
  }
  root.CLICK360_SPARK_HANDOFF=Object.freeze({plan,runtimeApproval,validateReceivableLinks});
})(typeof window==='undefined'?globalThis:window);
