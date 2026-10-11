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
      'modular-operation-coordinator.js','modular-ui-adapter.js','spark-operational-ui-runtime.js'].some(file=>assets[file]!==build))
      throw Error('SPARK_UI_MIXED_RELEASE_BLOCKED');
    if(typeof persistCandidate!=='function'||typeof projectConfirmed!=='function')throw Error('SPARK_UI_DURABILITY_REQUIRED');
    const transport=root.CLICK360_SPARK_TRANSACTION_TRANSPORT.create({db,projectId,ownerUid,businessId,actorUid,resolveUser});
    // Server-enforced mode proof before installing any UI writer.
    await transport.run(async()=>true);
    const repository=root.CLICK360_MODULAR_PERSISTENCE.createSparkRepository({ownerUid,businessId,actorUid,transport,serverTimestamp:options.serverTimestamp});
    const journal=await root.CLICK360_MODULAR_JOURNAL.open();
    const identity=repository.identity;
    const context=()=>{
      const active=resolveIdentity?.();
      if(active?.tenantKey!==identity.tenantKey||active.ownerUid!==ownerUid||active.businessId!==businessId
        ||resolveUser?.()?.uid!==actorUid)throw Error('SPARK_UI_CONTEXT_CHANGED');
    };
    let closed=false,busy=false;
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
        const projection=await repository.readOperationProjection(operationId,kind,row.payloadHash);
        assertActive();await projectConfirmed(projection);assertActive();
      }});
    async function commit({reason,command,candidate}){
      assertActive();
      if(busy)throw Error('SPARK_UI_OPERATION_IN_PROGRESS');
      if(!command||!['cash_open','sale','product_create','product_edit','inventory_adjust','cash_movement'].includes(command.kind)
        ||!((reason==='cash_opened'&&command.kind==='cash_open')||(reason==='sale_created'&&command.kind==='sale')
          ||(reason==='product_saved'&&['product_create','product_edit','inventory_adjust'].includes(command.kind))
          ||(reason==='cash_movement_created'&&command.kind==='cash_movement')))
        return {ok:false,pending:false,reason:'spark_ui_flow_not_certified',notQueued:true};
      const snapshot=structuredClone(candidate),input=structuredClone(command.input);
      busy=true;
      try{
        const counts=await journal.countPending(identity);
        const projections=await journal.countProjectionPending(identity);
        assertActive();
        if(counts.pendingCount+counts.unknownCount+projections>0)return {ok:false,pending:true,reason:'spark_ui_recovery_required',notQueued:true};
        const prepared=await repository.prepareOperation(command.kind,input);
        assertActive();
        // Pin the stable commercial command before persisting the UI candidate
        // or permitting network traffic. Snapshot persistence IDs are NOT sales.
        await journal.enqueue(identity,prepared.operationId,prepared.envelope);
        assertActive();
        publish({operationId:prepared.operationId,status:'PENDING',operationalCloudConfirmed:false});
        await persistCandidate(snapshot,{operationId:prepared.operationId,pendingRemoteSync:true});
        assertActive();
        const result=await adapter.submit(command.kind,input);
        return {ok:true,pending:result.status!=='CONFIRMED',operationalCloudConfirmed:result.status==='CONFIRMED',reason:result.reason};
      }catch(error){
        // Never roll back or resend an uncertain commercial operation. Its
        // immutable command remains available after a cold restart.
        const reason=String(error.code||(/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'spark_ui_confirmation_unknown'));
        // A failed candidate write must also revoke any previous cloud pill.
        // Never leak an old CONFIRMED status into a new uncertain operation.
        try{assertActive();publish({operationId:input.operationId,status:'UNKNOWN',reason,operationalCloudConfirmed:false});}catch{}
        return {ok:false,pending:true,reason};
      }finally{busy=false;}
    }
    return Object.freeze({identity,commit,replay:async()=>{assertActive();return adapter.replay();},
      isBusy:()=>busy,
      health:async()=>{assertActive();return adapter.health();},
      close:()=>{closed=true;journal.close();},certificationOnly:true});
  }
  root.CLICK360_SPARK_OPERATIONAL_UI=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
