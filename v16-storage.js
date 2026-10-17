(function (root) {
  'use strict';

  const DB_NAME = 'CLICK360_V16_DB';
  const DB_VERSION = 1;
  const SNAPSHOT_STORE = 'tenantSnapshots';
  const HEALTH_STORE = 'health';
  // Private, single-call receipts. Ordinary metadata cannot bypass the
  // capacity-pending CAS, including callers that invent an approval flag.
  const modularPromotions = new WeakMap();

  function contextId(context) {
    if (!context?.authUid || !context?.tenantKey) throw new Error('Contexto de almacenamiento incompleto.');
    return `${context.authUid}:${context.tenantKey}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(Object.assign(new Error('IndexedDB no disponible.'), { code: 'indexeddb-unavailable' }));
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(HEALTH_STORE)) db.createObjectStore(HEALTH_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir IndexedDB.'));
      request.onblocked = () => reject(Object.assign(new Error('IndexedDB bloqueado por otra version.'), { code: 'indexeddb-blocked' }));
    });
  }

  async function transact(storeName, mode, operation) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let request;
        try { request = operation(store); } catch (error) { reject(error); return; }
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = () => reject(transaction.error || request?.error || new Error('Fallo de IndexedDB.'));
        transaction.onabort = () => reject(transaction.error || new Error('Transaccion IndexedDB cancelada.'));
      });
    } finally {
      db.close();
    }
  }

  async function probe() {
    const value = { id: 'probe', checkedAtMs: Date.now() };
    await transact(HEALTH_STORE, 'readwrite', (store) => store.put(value));
    const loaded = await transact(HEALTH_STORE, 'readonly', (store) => store.get('probe'));
    if (!loaded || loaded.id !== 'probe') throw new Error('La prueba de IndexedDB no pudo verificarse.');
    return { available: true };
  }

  async function putSnapshot(context, snapshot, metadata = {}) {
    const id = contextId(context);
    const record = {
      id,
      authUid: context.authUid,
      ownerId: context.ownerId,
      businessId: context.businessId,
      tenantKey: context.tenantKey,
      schemaVersion: 10,
      snapshot,
      revision: Number(metadata.revision || 0),
      baseRevision: Number(metadata.baseRevision || 0),
      pendingRemoteSync: metadata.pendingRemoteSync === true,
      cloudCapacityBlocked: metadata.cloudCapacityBlocked === true,
      pendingOperations: Array.isArray(metadata.pendingOperations) ? [...new Set(metadata.pendingOperations)] : [],
      deviceRevision: String(metadata.deviceRevision || metadata.operationId || ''),
      operationId: String(metadata.operationId || '').slice(0, 96),
      payloadHash: String(metadata.payloadHash || '').slice(0, 128),
      materialHash: String(metadata.materialHash || '').slice(0, 128),
      source: String(metadata.source || 'local_snapshot').slice(0, 48),
      updatedAtMs: Number(snapshot?.updatedAtMs || Date.now()),
      pendingCreatedAtMs: Number(metadata.pendingCreatedAtMs || 0),
      savedAtMs: Date.now()
    };
    // CAS inside the same IDB transaction prevents two tabs from replacing a
    // capacity-pending snapshot, or a cloud mirror from erasing its outbox.
    const db = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
        const store = transaction.objectStore(SNAPSHOT_STORE);
        let failure;
        const request = store.get(id);
        request.onsuccess = () => {
          const current = request.result;
          record.uiWorkingDates = current?.uiWorkingDates || {};
          const promotion=modularPromotions.get(metadata.modularPromotion);
          const verifiedPromotion=promotion&&current
            && JSON.stringify(current)===promotion.originalRecord
            && record.source==='spark_operational_candidate'
            && String(current.deviceRevision||'')===String(metadata.expectedDeviceRevision||'');
          const protectedModular=current?.source==='spark_operational_candidate';
          if ((promotion&&!verifiedPromotion)||(current?.cloudCapacityBlocked && !verifiedPromotion && (!record.cloudCapacityBlocked
            || String(current.deviceRevision || '') !== String(metadata.expectedDeviceRevision || '')))
            || (protectedModular && (record.source!=='spark_operational_candidate'
              || String(current.deviceRevision || '')!==String(metadata.expectedDeviceRevision||'')))) {
            failure = Object.assign(new Error('La copia local cambió en otra pestaña. Ningún dato pendiente fue reemplazado.'), { code:'indexeddb-revision-conflict' });
            transaction.abort();
            return;
          }
          store.put(record);
        };
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(failure || transaction.error || new Error('Transaccion cancelada.'));
        transaction.onerror = () => reject(transaction.error || new Error('Fallo de IndexedDB.'));
      });
    } finally { db.close(); }
    return { id, savedAtMs: record.savedAtMs, uiWorkingDates:record.uiWorkingDates };
  }

  async function putWorkingDate(context,businessId,date){
    if(typeof businessId!=='string'||!businessId||businessId.includes('/')
      ||(date!==null&&(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)
        ||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)))
      throw Error('Fecha de trabajo inválida.');
    const id=contextId(context),db=await openDatabase();
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(SNAPSHOT_STORE,'readwrite'),store=tx.objectStore(SNAPSHOT_STORE);let failure,dates;
        store.get(id).onsuccess=e=>{
          const record=e.target.result;
          if(!record||record.schemaVersion!==10||record.authUid!==context.authUid||record.ownerId!==context.ownerId
            ||record.businessId!==context.businessId||record.tenantKey!==context.tenantKey
            ||!record.snapshot?.businesses?.some(b=>b.id===businessId)){
            failure=Error('No se pudo verificar el negocio para conservar la fecha.');tx.abort();return;
          }
          dates={...(record.uiWorkingDates||{})};
          Object.defineProperty(dates,businessId,{value:date,enumerable:true,writable:true,configurable:true});
          store.put({...record,uiWorkingDates:dates});
        };
        tx.oncomplete=()=>resolve(dates);tx.onabort=()=>reject(failure||tx.error||Error('No se pudo conservar la fecha.'));
      });
    }finally{db.close();}
  }

  async function getSnapshot(context) {
    const record = await transact(SNAPSHOT_STORE, 'readonly', (store) => store.get(contextId(context)));
    if (!record) return null;
    if (record.authUid !== context.authUid || record.ownerId !== context.ownerId
      || record.businessId !== context.businessId || record.tenantKey !== context.tenantKey
      || record.schemaVersion !== 10) return null;
    return record;
  }

  async function promoteVerifiedSnapshot(context,snapshot,metadata){
    const proof=metadata?.verifiedLocalHandoff,api=root.CLICK360_SPARK_MIGRATION;
    const projectId=root.CLICK360_FIREBASE_CONFIG?.projectId;
    const user=()=>root.click360Auth?.currentUser;
    if(!['demo-click360-spark-modular','click360-staging-7620168025'].includes(projectId)
      ||!api||!root.CLICK360_SPARK_RECOVERY||context.authUid!==context.ownerId
      ||user()?.uid!==context.ownerId||proof?.verified!==true||proof.status!=='LOCAL_HANDOFF_VERIFIED'
      ||typeof proof.assertStable!=='function'||metadata.source!=='spark_operational_candidate'
      ||proof.buildSha!==root.CLICK360_RELEASE_ASSETS?.['app.js'])throw Error('INDEXEDDB_VERIFIED_HANDOFF_REQUIRED');
    if(snapshot?.identity?.tenantKey!==context.tenantKey||snapshot.identity.businessId!==context.businessId
      ||(snapshot.identity.ownerUid||snapshot.identity.ownerId)!==context.ownerId)throw Error('INDEXEDDB_HANDOFF_TARGET_IDENTITY');
    const current=await getSnapshot(context);
    if(!current||current.source==='spark_operational_candidate'
      ||current.deviceRevision!==proof.deviceRevision||metadata.expectedDeviceRevision!==current.deviceRevision
      ||await api.hash(current.snapshot)!==proof.sourceHash
      ||await api.hash(Object.fromEntries(Object.entries(current).filter(([key])=>key!=='snapshot')))!==proof.deviceMetadataHash
      ||api.byteLength(snapshot)>8*1024*1024)throw Error('INDEXEDDB_HANDOFF_SOURCE_CHANGED');
    const recovery=await root.CLICK360_SPARK_RECOVERY.open({ownerUid:context.ownerId,resolveUser:user});
    try{
      const handoff=await recovery.readHandoff(proof.captureHash),source=await recovery.read(proof.sourceHash);
      if(!handoff?.durable||!source?.durable||handoff.plan.sourceHash!==proof.sourceHash
        ||handoff.plan.deviceMetadataHash!==proof.deviceMetadataHash
        ||source.buildSha!==proof.buildSha||source.deviceRevision!==proof.deviceRevision
        ||await api.hash(source.snapshot)!==proof.sourceHash
        ||await api.hash(source.deviceRecordMetadata)!==proof.deviceMetadataHash)
        throw Error('INDEXEDDB_HANDOFF_ORIGINAL_PIN_REQUIRED');
    }finally{recovery.close();}
    await proof.assertStable();
    if(user()?.uid!==context.ownerId)throw Error('INDEXEDDB_HANDOFF_ACTOR_CHANGED');
    const receipt={};modularPromotions.set(receipt,{originalRecord:JSON.stringify(current)});
    try{return await putSnapshot(context,snapshot,{...metadata,modularPromotion:receipt});}
    finally{modularPromotions.delete(receipt);}
  }

  async function deleteSnapshot(context) {
    await transact(SNAPSHOT_STORE, 'readwrite', (store) => store.delete(contextId(context)));
    return true;
  }

  async function estimate() {
    if (!root.navigator?.storage?.estimate) return null;
    const value = await root.navigator.storage.estimate();
    return { usage: Number(value.usage || 0), quota: Number(value.quota || 0) };
  }

  root.CLICK360_V16_STORAGE = Object.freeze({ probe, putSnapshot, promoteVerifiedSnapshot, putWorkingDate, getSnapshot, deleteSnapshot, estimate, contextId });
})(typeof window !== 'undefined' ? window : globalThis);
