(function(root){
  'use strict';
  // Owner-initiated support only. NEVER create/upgrade a journal, acquire a
  // writer lease, replay/claim operations, clear a conflict or write Firestore.
  // This runs INSIDE the original installed PWA storage partition on iOS.
  const PANEL_ID='c360-device-health-readonly';
  const BUTTON_ID='c360-device-health-check';
  const COPY_ID='c360-device-health-copy';
  let running=false,lastReport=null;
  const text=value=>String(value==null?'':value);
  const cleanCode=error=>{
    const code=text(error&&error.code||error&&error.message||'READ_FAILED');
    return /^[A-Z][A-Z0-9_]{1,80}$/.test(code)?code:'READONLY_HEALTH_UNAVAILABLE';
  };
  function sessionScope(){
    const user=root.click360Auth&&root.click360Auth.currentUser;
    const profile=root.click360User;
    if(!user||!profile||profile.uid!==user.uid||profile.ownerId!==user.uid
      ||(profile.role!=='owner'&&profile.isOwner!==true))
      throw Error('OWNER_SESSION_REQUIRED');
    return user.uid;
  }
  async function inspect(){
    const ownerUid=sessionScope();
    const state=root.click360SparkBootstrapState||{};
    const writer=root.click360SparkOperationalSession||null;
    const status=root.click360GetSyncStatus&&root.click360GetSyncStatus()||{};
    const build=root.CLICK360_RELEASE_ASSETS&&root.CLICK360_RELEASE_ASSETS['app.js']||null;
    const scope=writer&&writer.identity||null;
    const phase=text(state.phase||'UNKNOWN');
    const activeBusinessId=typeof root.click360GetActiveBusinessId==='function'
      ?root.click360GetActiveBusinessId():null;
    const scopeMatches=!!scope&&scope.ownerUid===ownerUid
      &&root.click360TenantContext?.authUid===ownerUid
      &&scope.businessId===activeBusinessId
      &&scope.tenantKey==='owner:'+ownerUid+':business:'+activeBusinessId;
    const beforeBusy=!!(writer&&writer.isBusy&&writer.isBusy());
    const readerModule=root.CLICK360_P0A_JOURNAL;
    if(!readerModule||typeof readerModule.open!=='function')throw Error('JOURNAL_READER_UNAVAILABLE');
    const reader=await readerModule.open();
    let census;
    try{census=await reader.captureOwner(ownerUid);}
    finally{reader.close();}
    if(!census||census.enumerationComplete!==true||!Array.isArray(census.rows)
      ||census.recordCount!==census.rows.length)throw Error('JOURNAL_CENSUS_INCOMPLETE');
    const counts={total:census.recordCount,confirmed:0,queued:0,inflight:0,unknown:0,
      projectionPending:0,unexpectedState:0,missingProof:0,unattributedActive:0};
    for(const row of census.rows){
      if(row.state==='confirmed')counts.confirmed++;
      else if(row.state==='queued')counts.queued++;
      else if(row.state==='inflight')counts.inflight++;
      else if(row.state==='unknown')counts.unknown++;
      else counts.unexpectedState++;
      if(row.state==='confirmed'&&row.projectionState!=='complete')counts.projectionPending++;
      if(!/^[a-f0-9]{64}$/.test(text(row.payloadHash)))counts.missingProof++;
      if(row.state!=='confirmed'&&(!row.payload||!row.payload.actorUid
        ||row.actorUid!==row.payload.actorUid))counts.unattributedActive++;
    }
    // The runtime's actor-scoped counters are readonly, but the owner-wide
    // primary-key scan above is the authority for COMPLETE journal coverage.
    const runtimeHealth=writer&&typeof writer.health==='function'?await writer.health():null;
    const afterBusy=!!(writer&&writer.isBusy&&writer.isBusy());
    // This is an existing pure precheck: it does not queue a sale or call Firebase.
    const saleGate=typeof root.click360SparkMutationGate==='function'
      ?root.click360SparkMutationGate({kind:'sale'}):null;
    const sameSession=sessionScope()===ownerUid
      &&writer===root.click360SparkOperationalSession
      &&activeBusinessId===root.click360GetActiveBusinessId?.()
      &&root.click360SparkBootstrapState&&root.click360SparkBootstrapState.phase===phase;
    const health={
      pending:runtimeHealth&&runtimeHealth.pendingCount,
      unknown:runtimeHealth&&runtimeHealth.unknownCount,
      projectionPending:runtimeHealth&&runtimeHealth.projectionPendingCount,
      complete:runtimeHealth&&runtimeHealth.countIsBounded===false,
      activeRequests:runtimeHealth&&runtimeHealth.activeRequests
    };
    const safe=saleGate?.allowed===true&&phase==='READY'&&!!build&&!!writer&&scopeMatches
      &&status.status==='modular_confirmed'&&root.navigator.onLine===true
      &&!beforeBusy&&!afterBusy&&sameSession&&health.complete===true
      &&health.pending===0&&health.unknown===0&&health.projectionPending===0
      &&health.activeRequests===0&&counts.queued===0&&counts.inflight===0
      &&counts.unknown===0&&counts.projectionPending===0
      &&counts.unexpectedState===0&&counts.missingProof===0&&counts.unattributedActive===0;
    return Object.freeze({
      version:1,checkedAt:new Date().toISOString(),
      build:build?text(build).slice(0,12):'UNKNOWN',
      bootstrapPhase:phase,writerInstalled:!!writer,writerScopeVerified:!!scopeMatches,
      cloudStatus:text(status.status||'UNKNOWN'),online:root.navigator.onLine===true,
      salePrecheckAllowed:saleGate?.allowed===true,
      activeWriterBusy:beforeBusy||afterBusy,sessionUnchanged:!!sameSession,
      journal:{enumerationComplete:true,...counts},
      runtimeHealth:health,
      result:safe?'SUPERVISED_GO_CANDIDATE':'NO_GO_REVIEW_REQUIRED',
      notice:'No confirma ventas nuevas ni sustituye la verificacion del ledger en Firebase.'
    });
  }
  function attach(){
    const anchor=root.document.getElementById('copySyncDiagnosticBtn');
    if(!anchor||root.document.getElementById(PANEL_ID))return;
    if(!root.click360User||root.click360User.ownerId!==root.click360Auth?.currentUser?.uid)return;
    const parent=anchor.closest('details');
    if(!parent)return;
    const panel=root.document.createElement('div');
    panel.id=PANEL_ID;
    panel.style.cssText='margin-top:12px;padding:12px;border:1px solid #5b5b5b;border-radius:10px';
    const heading=root.document.createElement('strong');
    heading.textContent='Comprobación segura del dispositivo';
    const description=root.document.createElement('p');
    description.className='fieldHint';
    description.textContent='Solo lee el journal y el estado actual de esta aplicación. No registra ventas ni modifica datos.';
    const button=root.document.createElement('button');
    button.id=BUTTON_ID;button.type='button';button.className='btn silver block';
    button.textContent='Verificar este iPhone (solo lectura)';
    const output=root.document.createElement('pre');
    output.id='c360-device-health-output';
    output.setAttribute('role','status');
    output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:360px;overflow:auto';
    const copy=root.document.createElement('button');
    copy.id=COPY_ID;copy.type='button';copy.className='btn silver block';
    copy.textContent='Copiar resultado para soporte';copy.hidden=true;
    panel.append(heading,description,button,output,copy);
    parent.insertAdjacentElement('afterend',panel);
  }
  root.CLICK360_DEVICE_READONLY_SUPPORT=Object.freeze({inspect});
  async function handleClick(event){
    const id=event.target&&event.target.id;
    if(id===COPY_ID){
      if(!lastReport)return;
      const output=root.document.getElementById('c360-device-health-output');
      try{await root.navigator.clipboard.writeText(JSON.stringify(lastReport,null,2));
        if(output)output.textContent='Resultado copiado. Compártelo únicamente con soporte de CLICK 360.\n'+JSON.stringify(lastReport,null,2);
      }catch{if(output)output.textContent=JSON.stringify(lastReport,null,2)+'\nCopia este texto manualmente.';}
      return;
    }
    if(id!==BUTTON_ID||running)return;
    const button=root.document.getElementById(BUTTON_ID);
    const output=root.document.getElementById('c360-device-health-output');
    const copy=root.document.getElementById(COPY_ID);
    running=true;if(button)button.disabled=true;
    if(output)output.textContent='Leyendo el estado local sin modificar información...';
    try{
      lastReport=await inspect();
    }catch(error){
      lastReport={version:1,checkedAt:new Date().toISOString(),result:'NO_GO_READ_FAILED',
        errorCode:cleanCode(error),notice:'No reintentar operaciones ni borrar datos; contactar a soporte.'};
    }finally{running=false;if(button)button.disabled=false;}
    if(output)output.textContent=JSON.stringify(lastReport,null,2);
    if(copy)copy.hidden=false;
  }
  if(root.document){
    root.document.addEventListener('click',handleClick);
    const start=()=>{
      attach();
      if(root.MutationObserver&&root.document.body){
        const observer=new root.MutationObserver(attach);
        observer.observe(root.document.body,{childList:true,subtree:true});
      }
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window==='undefined'?globalThis:window);
