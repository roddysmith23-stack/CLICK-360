// Shared DEV UI boundary. Not loaded by legacy production and no auto-cutover.
(function(root){
  'use strict';
  function create({repository,journal,deviceId,resolveIdentity,isOnline=()=>root.navigator?.onLine!==false,onStatus=()=>{},onConfirmed=async()=>{}}){
    const identity=repository?.identity;
    if(!identity||typeof resolveIdentity!=='function')throw Error('MODULAR_UI_IDENTITY_REQUIRED');
    const coordinator=root.CLICK360_MODULAR_COORDINATOR.create({repository,journal,deviceId});
    const inFlight=new Map();
    const assertContext=()=>{
      const active=resolveIdentity();
      if(active?.ownerUid!==identity.ownerUid||active?.businessId!==identity.businessId||active?.tenantKey!==identity.tenantKey)throw Error('MODULAR_UI_CONTEXT_CHANGED');
    };
    const emit=(operationId,status,reason=null)=>{
      assertContext();
      // No UID/email/request contents in support-facing status events.
      const detail={operationId,status,reason,operationalCloudConfirmed:status==='CONFIRMED'};
      onStatus(detail);return detail;
    };
    async function confirm(row){
      assertContext();
      const evidence=await repository.lookupOperation(row.operationId,row.payload.kind,row.payloadHash);
      assertContext();
      if(evidence.source!=='server'||!evidence.exists)throw Error('MODULAR_UI_SERVER_CONFIRMATION_REQUIRED');
      // A locally confirmed journal row is not by itself cloud evidence.
      await onConfirmed({operationId:row.operationId,kind:row.payload.kind,evidence});
      assertContext();return emit(row.operationId,'CONFIRMED');
    }
    async function settle(row){
      assertContext();
      if(!isOnline())return emit(row.operationId,row.state==='unknown'||row.state==='inflight'?'UNKNOWN':'PENDING','offline');
      try{
        const result=await coordinator.process(row.operationId);
        assertContext();
        if(result.status==='confirmed')return await confirm(await journal.get(identity,row.operationId));
        return emit(row.operationId,'UNKNOWN','server_reconciliation_required');
      }catch(error){
        // Context changes never project another tenant's operation into this UI.
        assertContext();
        return emit(row.operationId,'UNKNOWN',String(error.code||'server_confirmation_unavailable'));
      }
    }
    async function submit(kind,input){
      assertContext();
      const candidate=root.CLICK360_MODULAR_JOURNAL.validatePayload(structuredClone(input));
      const prepared=await repository.prepareOperation(kind,candidate);
      assertContext();
      const pending=inFlight.get(prepared.operationId);
      if(pending){
        if(pending.hash!==prepared.payloadSha256)throw Error('OPERATION_ID_PAYLOAD_CONFLICT');
        return pending.promise;
      }
      const promise=(async()=>{
        const row=await coordinator.enqueue(kind,candidate);
        assertContext();emit(row.operationId,'PENDING');
        return settle(row);
      })();
      inFlight.set(prepared.operationId,{hash:prepared.payloadSha256,promise});
      try{return await promise;}finally{if(inFlight.get(prepared.operationId)?.promise===promise)inFlight.delete(prepared.operationId);}
    }
    async function replay({limit=25}={}){
      assertContext();
      const rows=await journal.listPending(identity,limit),results=[];
      assertContext();
      for(const row of rows){
        const result=await settle(row);results.push(result);
        if(result.status!=='CONFIRMED')break;
      }
      return results;
    }
    async function health(){
      assertContext();const rows=await journal.listPending(identity,100);assertContext();
      return {pendingCount:rows.filter(row=>row.state==='queued').length,
        unknownCount:rows.filter(row=>row.state==='unknown'||row.state==='inflight').length,
        countIsBounded:true,maxObserved:100,online:isOnline(),activeRequests:inFlight.size};
    }
    return Object.freeze({submit,replay,health});
  }
  root.CLICK360_MODULAR_UI_ADAPTER=Object.freeze({create});
})(typeof window==='undefined'?globalThis:window);
