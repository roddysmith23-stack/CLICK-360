(function(root){
  'use strict';
  // Owner-initiated support only. NEVER create/upgrade a journal, acquire a
  // writer lease, replay/claim operations, clear a conflict or write Firestore.
  // This runs INSIDE the original installed PWA storage partition on iOS.
  const PANEL_ID='c360-device-health-readonly';
  const BUTTON_ID='c360-device-health-check';
  const COPY_ID='c360-device-health-copy';
  let running=false,lastReport=null,lastScope=null;
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

    const w = root;
    sessionScope();
    const databaseName = 'click360-modular-outbox-v1';
    const reviewedBuild = w.CLICK360_RELEASE_ASSETS?.['device-health-readonly.js'];
    const knownKinds = new Set(['sale','sale_cancel','product_create','product_edit','product_delete','inventory_adjust','cash_open','cash_close','cash_movement','manual_movement_correct','customer_create','customer_edit','customer_delete','receivable_payment','layaway_status','scoped_settings']);
    const build = v => typeof v === 'string' && /^[a-f0-9]{12,40}$/.test(v) ? v : null;
    const safeGateReasons = new Set(['modular_access_verified','auth_not_ready','read_only','legal_acceptance_required','permission_required','client_data_protection','device_save_pending']);
    const code = v => safeGateReasons.has(v) ? v : 'UNRECOGNIZED_GATE_REASON';
    const canonical = v => {
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (Array.isArray(v)) return v.map(canonical);
      if (v && Object.getPrototypeOf(v) === Object.prototype)
        return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
      throw Error('NON_JSON_JOURNAL_PAYLOAD');
    };
    const digest = async v => [...new Uint8Array(await w.crypto.subtle.digest('SHA-256',
      new w.TextEncoder().encode(JSON.stringify(canonical(v)))))].map(b => b.toString(16).padStart(2, '0')).join('');
    let db;
    const result = {version:1,observedAt:new Date().toISOString(),readOnly:true,networkRequests:0,
      scope:'CURRENT_AUTHENTICATED_PWA_NOT_HARDWARE_ATTESTATION',reviewedBuild,localPreflightReady:false};
    try {
      const auth = w.click360Auth?.currentUser, session = w.click360SparkOperationalSession;
      const profile = w.click360User, tenant = w.click360TenantContext;
      const activeBusiness = w.click360GetActiveBusinessId?.();
      const owner = session?.identity?.ownerUid, business = session?.identity?.businessId;
      const coordinator = w.click360SparkCoordinator;
      const unchanged = () => !!auth && w.click360Auth?.currentUser === auth
        && w.click360User === profile && w.click360TenantContext === tenant
        && w.click360GetActiveBusinessId?.() === activeBusiness
        && w.click360SparkOperationalSession === session && session?.identity?.ownerUid === owner
        && session?.identity?.businessId === business && w.click360SparkCoordinator === coordinator;
      const snapshot = () => ({
        build:build(w.CLICK360_RELEASE_ASSETS?.['app.js']),workerBuild:build(w.click360ServiceWorkerRelease?.buildSha),
        startupReady:w.click360StartupDiagnostic?.phase === 'READY',bootstrapReady:w.click360SparkBootstrapState?.phase === 'READY',
        accessReady:w.click360AccessUiState?.state === 'ready',writerInstalled:!!session,
        coordinatorReady:coordinator?.phase?.() === 'READY',writerBusy:session?.isBusy?.() !== false,
        coordinatorBusy:coordinator?.isBusy?.() !== false,online:w.navigator?.onLine === true,
        mixedBuild:w.click360IsMixedBuild?.() !== false,
        standalone:w.navigator?.standalone === true || w.matchMedia?.('(display-mode: standalone)')?.matches === true,
        operationalCloudConfirmed:w.click360SparkBootstrapState?.operationalCloudConfirmed === true,
        syncConfirmed:w.click360GetSyncStatus?.()?.status === 'modular_confirmed'
          && w.click360GetSyncStatus?.()?.operationalCloudConfirmed === true
      });
      result.runtime = snapshot();
      result.reviewedBuild = build(reviewedBuild);
      if (!result.reviewedBuild) throw Error('RELEASE_IDENTITY_UNAVAILABLE');
      // Hash existing identifiers only; never call a getter that creates a device ID.
      result.identityFingerprintFormat = 'sha256-canonical-json';
      if (owner) result.ownerFingerprint = await digest(owner);
      const observedDevice = w.click360GetSyncStatus?.()?.deviceId;
      result.deviceFingerprint = typeof observedDevice === 'string' && observedDevice ? await digest(observedDevice) : null;
      if (!auth || !session || !owner || !business || w.click360User?.uid !== auth.uid
        || w.click360User?.ownerId !== owner || auth.uid !== owner
        || business !== activeBusiness || tenant?.authUid !== owner
        || session.identity.tenantKey !== `owner:${owner}:business:${business}`) throw Error('ORIGINAL_OWNER_CONTEXT_REQUIRED');
      // This modular gate only reads readiness/access/permissions/legal state.
      // NEVER use click360WriteGate/getSyncState(cleanup:true) in this inspection.
      if (typeof w.click360SparkMutationGate !== 'function') throw Error('MODULAR_GATE_UNAVAILABLE');
      const gate = w.click360SparkMutationGate({kind:'sale'});
      result.saleGate = {allowed:gate?.allowed === true,reason:code(gate?.reason)};
      if (typeof w.indexedDB?.databases !== 'function') throw Error('SAFE_DATABASE_INVENTORY_UNAVAILABLE');
      const databases = await w.indexedDB.databases();
      const known = databases.find(d => d.name === databaseName);
      if (!known) throw Error('EXISTING_JOURNAL_NOT_FOUND');
      if (known.version !== 5) throw Error('JOURNAL_VERSION_NOT_CERTIFIED');
      db = await new Promise((resolve,reject) => {
        const request = w.indexedDB.open(databaseName); // Never request a version.
        let refused = false;
        const fail = reason => {refused = true;reject(Error(reason));};
        request.onupgradeneeded = () => { request.transaction.abort();fail('DATABASE_CREATION_OR_UPGRADE_REFUSED'); };
        request.onerror = () => fail('JOURNAL_READ_OPEN_FAILED');
        request.onblocked = () => fail('JOURNAL_READ_OPEN_BLOCKED');
        request.onsuccess = () => {if (refused) request.result.close();else resolve(request.result);};
      });
      db.onversionchange = () => db.close();
      if (db.version !== 5 || !db.objectStoreNames.contains('operations')) throw Error('JOURNAL_SCHEMA_NOT_CERTIFIED');
      const capture = () => new Promise((resolve,reject) => {
        const tx = db.transaction('operations','readonly'), rows = [];
        const request = tx.objectStore('operations').openCursor(w.IDBKeyRange.bound(`${owner}:`,`${owner};`,false,true));
        request.onsuccess = () => { const cursor = request.result;if (!cursor) return;
          rows.push(w.structuredClone(cursor.value));cursor.continue(); };
        request.onerror = () => tx.abort();
        tx.oncomplete = () => resolve(rows);
        tx.onabort = () => reject(Error('COMPLETE_JOURNAL_READ_FAILED'));
      });
      const inspect = async rows => {
        const count = {total:rows.length,queued:0,unknown:0,inflight:0,confirmed:0,projectionPending:0,
          malformed:0,payloadHashErrors:0,unattributed:0,otherActorsPending:0};
        const unique = new Set(), marks = [];
        for (const row of rows) {
          const validIds = [row.ownerUid,row.businessId,row.operationId].every(v => typeof v === 'string'
            && v.length > 0 && v.length <= 120 && !/[/:.]/.test(v));
          const validState = ['queued','unknown','inflight','confirmed'].includes(row.state);
          if (!validIds || row.ownerUid !== owner || row.key !== `${owner}:${row.businessId}:${row.operationId}`
            || unique.has(row.key) || !validState || row.schemaVersion !== 1 || !knownKinds.has(row.payload?.kind)
            || typeof row.actorUid !== 'string' || !row.actorUid || row.actorUid !== row.payload?.actorUid
            || !Number.isSafeInteger(row.revision) || row.revision < 1) count.malformed++;
          unique.add(row.key);
          if (validState) count[row.state]++;
          const projection = row.state === 'confirmed' && row.projectionState !== 'complete';
          if (projection) count.projectionPending++;
          if (row.state !== 'confirmed' || projection) {
            if (!row.actorUid || row.actorUid !== row.payload?.actorUid) count.unattributed++;
            if (row.actorUid && row.actorUid !== auth.uid) count.otherActorsPending++;
          }
          let actualHash = null;
          try { actualHash = await digest(row.payload); } catch { count.payloadHashErrors++; }
          if (actualHash && actualHash !== row.payloadHash) count.payloadHashErrors++;
          marks.push([row.key,row.actorUid ?? null,row.revision,row.state,row.projectionState ?? null,row.createdAt ?? null,row.attempts ?? null,row.payloadHash ?? null,actualHash]);
        }
        return {count,fingerprint:await digest(marks)};
      };
      const first = await inspect(await capture());
      const scoped = await session.health(); // Existing read-only counts; no replay.
      const secondRows = await capture();
      const second = await inspect(secondRows);
      const last = secondRows.filter(row => row.actorUid === auth.uid && row.businessId === business
        && row.state === 'confirmed' && row.projectionState === 'complete').sort((a,b) => (b.createdAt||0)-(a.createdAt||0))[0];
      result.lastConfirmedOperation = last ? {operationFingerprint:await digest(last.operationId),
        payloadHash:/^[a-f0-9]{64}$/.test(last.payloadHash) ? last.payloadHash : null,
        kind:knownKinds.has(last.payload?.kind) ? last.payload.kind : null,projectionComplete:true} : null;
      result.journal = {...second.count,enumerationComplete:true,allOwnerBusinessesAndActors:true,
        stable:first.fingerprint === second.fingerprint,fingerprint:second.fingerprint};
      result.session = {pending:scoped.pendingCount,unknown:scoped.unknownCount,
        projectionPending:scoped.projectionPendingCount,activeRequests:scoped.activeRequests,
        complete:scoped.countIsBounded === false};
      result.runtimeAfter = snapshot();
      result.contextStable = unchanged();
      const r = result.runtimeAfter, j = result.journal;
      const runtimeReady = r.startupReady && r.bootstrapReady && r.accessReady && r.writerInstalled
        && r.coordinatorReady && !r.writerBusy && !r.coordinatorBusy && r.online && !r.mixedBuild
        && r.standalone && r.operationalCloudConfirmed && r.syncConfirmed && r.build === reviewedBuild && r.workerBuild === r.build;
      result.localPreflightReady = result.contextStable && runtimeReady && result.saleGate.allowed
        && !!result.deviceFingerprint && j.stable && j.queued+j.unknown+j.inflight+j.projectionPending+j.malformed+j.payloadHashErrors+j.unattributed+j.otherActorsPending === 0
        && result.session.complete && scoped.pendingCount === 0 && scoped.unknownCount === 0
        && scoped.projectionPendingCount === 0 && scoped.activeRequests === 0;
      result.reason = result.localPreflightReady ? 'LOCAL_READONLY_PREFLIGHT_PASS'
        : !result.deviceFingerprint ? 'EXISTING_DEVICE_IDENTITY_UNAVAILABLE'
        : !result.contextStable ? 'CONTEXT_CHANGED_DURING_READ'
        : !j.stable ? 'JOURNAL_CHANGED_DURING_READ'
        : j.malformed > 0 ? 'JOURNAL_FORMAT_INVALID'
        : j.payloadHashErrors > 0 ? 'JOURNAL_PAYLOAD_HASH_MISMATCH'
        : j.unknown+j.inflight > 0 ? 'UNKNOWN_REQUIRES_AUTHORITATIVE_RECONCILIATION'
        : j.projectionPending > 0 ? 'LOCAL_PROJECTION_PENDING'
        : j.queued > 0 ? 'LOCAL_OPERATIONS_PENDING'
        : r.build !== reviewedBuild ? 'APP_BUILD_NOT_REVIEWED'
        : r.workerBuild !== r.build || r.mixedBuild ? 'MIXED_RELEASE'
        : !r.standalone ? 'ORIGINAL_INSTALLED_PWA_CONTEXT_REQUIRED'
        : !runtimeReady ? 'RUNTIME_NOT_READY'
        : !result.saleGate.allowed ? 'SALE_GATE_DENIED' : 'JOURNAL_NOT_SETTLED_OR_INVALID';
    } catch (error) {
      const known = new Set(['ORIGINAL_OWNER_CONTEXT_REQUIRED','MODULAR_GATE_UNAVAILABLE','SAFE_DATABASE_INVENTORY_UNAVAILABLE',
        'RELEASE_IDENTITY_UNAVAILABLE','EXISTING_JOURNAL_NOT_FOUND','JOURNAL_VERSION_NOT_CERTIFIED','DATABASE_CREATION_OR_UPGRADE_REFUSED',
        'JOURNAL_READ_OPEN_FAILED','JOURNAL_READ_OPEN_BLOCKED','JOURNAL_SCHEMA_NOT_CERTIFIED','COMPLETE_JOURNAL_READ_FAILED']);
      result.reason = known.has(error.message) ? error.message : 'LOCAL_READONLY_INSPECTION_FAILED';
    } finally { db?.close(); }
    result.result=result.localPreflightReady?'SUPERVISED_GO_CANDIDATE':'NO_GO_REVIEW_REQUIRED';
    result.notice='No confirma ventas nuevas ni sustituye la verificación del ledger en Firebase.';
    return Object.freeze(result); // No record contents, IDs, tokens or business amounts.

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
    const message=root.document.createElement('p');
    message.id='c360-device-health-message';message.className='fieldHint';message.setAttribute('role','status');
    const details=root.document.createElement('details'),summary=root.document.createElement('summary');
    summary.textContent='Detalles técnicos para soporte';details.append(summary,output);
    output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:360px;overflow:auto';
    const copy=root.document.createElement('button');
    copy.id=COPY_ID;copy.type='button';copy.className='btn silver block';
    copy.textContent='Copiar resultado para soporte';copy.hidden=true;
    panel.append(heading,description,button,message,details,copy);
    parent.insertAdjacentElement('afterend',panel);
  }
  root.CLICK360_DEVICE_READONLY_SUPPORT=Object.freeze({inspect});
  async function handleClick(event){
    const id=event.target&&event.target.id;
    if(id===COPY_ID){
      if(!lastReport||!lastScope)return;
      try{if(sessionScope()!==lastScope.ownerUid||root.click360Auth.currentUser!==lastScope.auth
        ||root.click360SparkOperationalSession!==lastScope.writer)throw Error('OWNER_SESSION_REQUIRED');}
      catch{lastReport=null;lastScope=null;return;}
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
    const message=root.document.getElementById('c360-device-health-message');
    running=true;if(button)button.disabled=true;
    if(message)message.textContent='Leyendo el estado local sin modificar información...';
    if(output)output.textContent='';
    if(copy)copy.hidden=true;
    try{
      const auth=root.click360Auth?.currentUser,ownerUid=sessionScope(),writer=root.click360SparkOperationalSession;
      const report=await inspect();
      if(root.click360Auth?.currentUser!==auth||sessionScope()!==ownerUid
        ||root.click360SparkOperationalSession!==writer)throw Error('OWNER_SESSION_CHANGED');
      lastReport=report;lastScope={auth,ownerUid,writer};
    }catch(error){
      lastReport={version:1,checkedAt:new Date().toISOString(),result:'NO_GO_READ_FAILED',
        errorCode:cleanCode(error),notice:'No reintentar operaciones ni borrar datos; contactar a soporte.'};
    }finally{running=false;if(button)button.disabled=false;}
    if(message)message.textContent=lastReport.result==='SUPERVISED_GO_CANDIDATE'
      ?'Comprobación completada. Comparte el resultado con soporte para verificar tu próxima operación real.'
      :'La comprobación necesita revisión de soporte. Tu información no se ha modificado.';
    if(output)output.textContent=JSON.stringify(lastReport,null,2);
    if(copy)copy.hidden=false;
  }
  if(root.document){
    root.document.addEventListener('click',handleClick);
    const start=()=>{
      attach();
      // The existing app publishes this event after each completed view render.
      // No whole-document observer or background polling is needed.
      root.addEventListener('click360:ready',attach);
    };
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window==='undefined'?globalThis:window);
