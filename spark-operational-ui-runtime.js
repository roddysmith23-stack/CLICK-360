(function(root){
  'use strict';
  // Connected to the existing PWA, but activation is deliberately restricted
  // to synthetic staging certification until every commercial flow is ready.
  // Loading this file never opens a database, writes, migrates or activates.
  async function create(options){
    const {projectId,db,ownerUid,businessId,actorUid,resolveUser,resolveIdentity,
      persistCandidate,projectConfirmed,deviceId,onStatus=()=>{}}=options||{};
    if(!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
      ||options.syntheticCertification!==true)throw Error('SPARK_UI_CERTIFICATION_ONLY');
    const assets=root.CLICK360_RELEASE_ASSETS,build=assets?.['app.js'];
    if(!build||['firebase-service.js','v16-storage.js','spark-modular-migration.js','spark-modular-record-codec.js',
      'spark-modular-transaction-transport.js','modular-operation-journal.js','modular-persistence.js',
      'modular-operation-coordinator.js','modular-ui-adapter.js','spark-operational-ui-runtime.js','spark-operational-bootstrap.js'].some(file=>assets[file]!==build))
      throw Error('SPARK_UI_MIXED_RELEASE_BLOCKED');
    if(typeof persistCandidate!=='function'||typeof projectConfirmed!=='function')throw Error('SPARK_UI_DURABILITY_REQUIRED');
    const transport=root.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({db,projectId,ownerUid,businessId,actorUid,resolveUser});
    // Server-enforced mode proof before installing any UI writer.
    await transport.run(async()=>true);
    const repository=root.CLICK360_MODULAR_PERSISTENCE.createSparkRepository({ownerUid,businessId,actorUid,transport,
      deferDerivedAudit:true,serverTimestamp:options.serverTimestamp});
    const journal=await root.CLICK360_MODULAR_JOURNAL.open({actorUid});
    const identity=repository.identity;
    const context=()=>{
      const active=resolveIdentity?.();
      if(active?.tenantKey!==identity.tenantKey||active.ownerUid!==ownerUid||active.businessId!==businessId
        ||resolveUser?.()?.uid!==actorUid)throw Error('SPARK_UI_CONTEXT_CHANGED');
    };
    let closed=false,busy=false,durabilityBlocked=false;
    const assertActive=()=>{if(closed)throw Error('SPARK_UI_SESSION_CLOSED');context();};
    const publish=detail=>{
      root.dispatchEvent?.(new CustomEvent('click360-spark-operation-status',{detail}));
      onStatus(detail);
    };
    const adapter=root.CLICK360_MODULAR_UI_ADAPTER.create({repository,journal,deviceId,resolveIdentity,
      isOnline:options.isOnline,onStatus:publish,
      onConfirmed:async({operationId,kind})=>{
        assertActive();
        const row=await journal.get(identity,operationId);
        const counts=await journal.countPending(identity);
        // A remote view cannot overwrite another still-pending local delta.
        // The complete projection-overlay implementation is a release gate.
        if(counts.pendingCount+counts.unknownCount>0)throw Error('SPARK_UI_PENDING_OVERLAY_REQUIRED');
        // A lost financial response can leave its reconstructible audit view
        // absent. Materialize by ledger identity, never by replaying commerce.
        const projection=await repository.readOperationProjection(operationId,kind,row.payloadHash,{ensureAudit:true});
        assertActive();await projectConfirmed(projection);assertActive();
      }});
    async function commit({reason,command,candidate}){
      assertActive();
      if(busy)throw Error('SPARK_UI_OPERATION_IN_PROGRESS');
      if(durabilityBlocked)return {ok:false,pending:true,reason:'spark_ui_device_recovery_required',notQueued:true};
      if(!command||!['cash_open','cash_close','sale','product_create','product_edit','product_delete','inventory_adjust','cash_movement','customer_create','customer_edit','customer_delete','receivable_payment','layaway_status','scoped_settings'].includes(command.kind)
        ||!((['cash_opened','cash_reopened'].includes(reason)&&command.kind==='cash_open')||(reason==='sale_created'&&command.kind==='sale')
          ||(reason==='product_saved'&&['product_create','product_edit','inventory_adjust'].includes(command.kind))
          ||(reason==='product_deleted'&&command.kind==='product_delete')
          ||(reason==='cash_movement_created'&&command.kind==='cash_movement')||(reason==='cash_closed'&&command.kind==='cash_close')
          ||(reason==='customer_saved'&&['customer_create','customer_edit'].includes(command.kind))
          ||(reason==='customer_deleted'&&command.kind==='customer_delete')
          ||(reason==='sale_payment_received'&&command.kind==='receivable_payment')
          ||(reason==='layaway_status_updated'&&command.kind==='layaway_status')
          ||(['business_profile_updated','print_settings_updated'].includes(reason)&&command.kind==='scoped_settings')))
        return {ok:false,pending:false,reason:'spark_ui_flow_not_certified',notQueued:true};
      const snapshot=structuredClone(candidate),input=structuredClone(command.input);
      let pinned=false,candidateDurable=false;
      busy=true;
      try{
        const counts=await journal.countPending(identity);
        const projections=await journal.countProjectionPending(identity);
        assertActive();
        const offline=options.isOnline?.()===false;
        // An uncertain commit must be reconciled first. Known queued offline
        // commands can accumulate in durable causal order; never send a later
        // command online before its predecessors. Revision-bearing edits
        // require their preceding projection instead of inventing revisions.
        if(counts.unknownCount>0||(!offline&&(counts.pendingCount+projections>0))
          ||(offline&&projections>0&&counts.pendingCount===0)
          ||(counts.pendingCount>0&&['product_edit','product_delete','inventory_adjust','customer_edit','customer_delete','receivable_payment','layaway_status','cash_close','scoped_settings'].includes(command.kind)))
          return {ok:false,pending:true,reason:'spark_ui_recovery_required',notQueued:true};
        const prepared=await repository.prepareOperation(command.kind,input);
        assertActive();
        // Pin the stable commercial command before persisting the UI candidate
        // or permitting network traffic. Snapshot persistence IDs are NOT sales.
        await journal.enqueue(identity,prepared.operationId,prepared.envelope);
        pinned=true;
        assertActive();
        publish({operationId:prepared.operationId,status:'PENDING',operationalCloudConfirmed:false});
        await persistCandidate(snapshot,{operationId:prepared.operationId,pendingRemoteSync:true});
        candidateDurable=true;
        assertActive();
        const result=await adapter.submit(command.kind,input);
        return {ok:true,pending:result.status!=='CONFIRMED',operationalCloudConfirmed:result.status==='CONFIRMED',reason:result.reason,
          ...(result.causeCode?{causeCode:result.causeCode}:{})};
      }catch(error){
        // A pinned command is recoverable, but its failed device projection
        // cannot be used as the basis of additional optimistic commands.
        if(pinned&&!candidateDurable)durabilityBlocked=true;
        // Never roll back or resend an uncertain commercial operation. Its
        // immutable command remains available after a cold restart.
        const reason=String(error.code||(/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'spark_ui_confirmation_unknown'));
        // A failed candidate write must also revoke any previous cloud pill.
        // Never leak an old CONFIRMED status into a new uncertain operation.
        try{assertActive();publish({operationId:input.operationId,status:'UNKNOWN',reason,operationalCloudConfirmed:false});}catch{}
        return {ok:false,pending:true,reason};
      }finally{busy=false;root.dispatchEvent?.(new CustomEvent('click360-spark-idle'));}
    }
    async function verifyCashClose(target){
      assertActive();
      if(target?.businessId!==businessId||!target.cashSessionId)throw Error('SPARK_UI_EXACT_CASH_TARGET_REQUIRED');
      const result=await transport.run(async tx=>{
        const session=await tx.get('cashSessions',target.cashSessionId);
        if(!session||session.date!==target.date||session.summaryVersion!==1)throw Error('SPARK_UI_CASH_SESSION_NOT_VERIFIED');
        const reportId=session.status==='closed'?session.reportId:`report-${session.id}-${session.closeCycle}`;
        if(!reportId)throw Error('SPARK_UI_CASH_REPORT_ID_REQUIRED');
        const report=await tx.get('dailyReports',reportId);
        if(session.status==='closed'){
          if(report?.cashSessionId!==session.id||!['closed','reopened'].includes(report.status))throw Error('SPARK_UI_CASH_CLOSE_INCONSISTENT');
          const ledger=await tx.get('operationLedger',report.operationId);
          if(ledger?.kind!=='cash_close'||ledger.status!=='committed'||ledger.result?.cashSessionId!==session.id
            ||ledger.result?.reportId!==reportId)throw Error('SPARK_UI_CASH_CLOSE_LEDGER_REQUIRED');
          return {ok:true,closed:true,reportId,operationId:report.operationId,payloadHash:ledger.payloadHash,source:'server'};
        }
        if(session.status!=='open'||report)throw Error('SPARK_UI_CASH_CLOSE_INCONSISTENT');
        return {ok:true,closed:false,reportId,source:'server'};
      });
      if(!result.closed){
        const pending=await journal.get(identity,result.reportId);assertActive();
        if(pending){
          if(pending.payload.kind!=='cash_close'||pending.payload.payload?.cashSessionId!==target.cashSessionId
            ||pending.payload.payload?.date!==target.date)throw Error('SPARK_UI_CASH_CLOSE_JOURNAL_CONFLICT');
          // Absence/open state was just read authoritatively. The coordinator
          // still checks the ledger, then settles ONLY the original immutable
          // command. A new declared amount must never replace an unknown close.
          const reconciled=await adapter.reconcileOperation(result.reportId);
          if(reconciled.status!=='CONFIRMED')throw Error('SPARK_UI_CASH_CLOSE_LOCAL_RECOVERY_REQUIRED');
          return verifyCashClose(target);
        }
      }
      if(result.closed){
        const row=await journal.get(identity,result.operationId);assertActive();
        if(row){
          if(row.payloadHash!==result.payloadHash||row.payload.kind!=='cash_close')throw Error('SPARK_UI_CASH_CLOSE_JOURNAL_CONFLICT');
          const reconciled=await adapter.reconcileOperation(result.operationId);
          if(reconciled.status!=='CONFIRMED')throw Error('SPARK_UI_CASH_CLOSE_LOCAL_RECOVERY_REQUIRED');
        }else{
          const counts=await journal.countPending(identity),projections=await journal.countProjectionPending(identity);
          if(counts.pendingCount+counts.unknownCount+projections>0)throw Error('SPARK_UI_PENDING_OVERLAY_REQUIRED');
          const projection=await repository.readOperationProjection(result.operationId,'cash_close',result.payloadHash,{ensureAudit:true});
          assertActive();await projectConfirmed(projection);assertActive();
        }
      }
      return result;
    }
    return Object.freeze({identity,commit,verifyCashClose,currentCash:async()=>{assertActive();const value=await repository.readCurrentCashSession({onProgress:options.onReadProgress});assertActive();return value;},
      replay:async()=>{assertActive();return adapter.replay();},
      isBusy:()=>busy,
      health:async()=>{assertActive();return adapter.health();},
      close:()=>{closed=true;journal.close();},certificationOnly:true});
  }
  root.CLICK360_SPARK_OPERATIONAL_UI=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
