(function (root) {
  'use strict';

  const DB_NAME = 'CLICK360_V16_DB';
  const DB_VERSION = 1;
  const SNAPSHOT_STORE = 'tenantSnapshots';
  const HEALTH_STORE = 'health';

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
          if (current?.cloudCapacityBlocked && (!record.cloudCapacityBlocked
            || String(current.deviceRevision || '') !== String(metadata.expectedDeviceRevision || ''))) {
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
    return { id, savedAtMs: record.savedAtMs };
  }

  async function getSnapshot(context) {
    const record = await transact(SNAPSHOT_STORE, 'readonly', (store) => store.get(contextId(context)));
    if (!record) return null;
    if (record.authUid !== context.authUid || record.ownerId !== context.ownerId
      || record.businessId !== context.businessId || record.tenantKey !== context.tenantKey
      || record.schemaVersion !== 10) return null;
    return record;
  }

  async function deleteSnapshot(context) {
    await transact(SNAPSHOT_STORE, 'readwrite', (store) => store.delete(contextId(context)));
    return true;
  }

  async function getSafetyMetadata(context) {
    return (await transact(HEALTH_STORE, 'readonly', store => store.get(`safety:${contextId(context)}`))) || null;
  }

  // Allocate capture order atomically against the durable snapshot. Hashing is
  // performed BEFORE this transaction; no async crypto can expire an IDB tx.
  async function allocateSafetyMetadata(context, captured, sourceKey) {
    if (!captured || !/^[a-f0-9]{64}$/.test(sourceKey || '')) throw new Error('Invalid safety capture.');
    const id = contextId(context), healthId = `safety:${id}`, db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction([SNAPSHOT_STORE, HEALTH_STORE], 'readwrite');
        const snapshots = tx.objectStore(SNAPSHOT_STORE), health = tx.objectStore(HEALTH_STORE);
        let result, failure;
        const read = snapshots.get(id);
        read.onsuccess = () => {
          const current = read.result;
          if (!current || current.authUid !== context.authUid || current.ownerId !== context.ownerId
            || current.tenantKey !== context.tenantKey || current.businessId !== context.businessId
            || current.savedAtMs !== captured.savedAtMs || current.deviceRevision !== captured.deviceRevision
            || JSON.stringify(current) !== JSON.stringify(captured)) {
            failure = Object.assign(new Error('Durable snapshot changed before capture.'), { code:'safety-capture-stale' });
            tx.abort(); return;
          }
          const previous = health.get(healthId);
          previous.onsuccess = () => {
            const old = previous.result;
            result = old?.sourceKey === sourceKey ? old : {
              id:healthId, deviceId:old?.deviceId || root.crypto.randomUUID(),
              sequence:Number(old?.sequence || 0) + 1, sourceKey, status:'PENDING'
            };
            health.put(result);
          };
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('Safety capture aborted.'));
        tx.onerror = () => reject(tx.error || new Error('Safety capture failed.'));
      });
    } finally { db.close(); }
  }

  async function confirmSafetyMetadata(context, sourceKey, confirmation, captured) {
    if (!captured) return false;
    const db = await openDatabase(), id = `safety:${contextId(context)}`;
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction([HEALTH_STORE,SNAPSHOT_STORE], 'readwrite'), store = tx.objectStore(HEALTH_STORE);
        let confirmed = false;
        const snapshotRead = tx.objectStore(SNAPSHOT_STORE).get(contextId(context));
        snapshotRead.onsuccess = () => {
          if (JSON.stringify(snapshotRead.result) !== JSON.stringify(captured)) return;
          const read = store.get(id);
          read.onsuccess = () => {
          const current = read.result;
          if (current?.sourceKey !== sourceKey || confirmation?.status !== 'COMPLETE'
            || confirmation?.payloadSha256 !== sourceKey || !confirmation?.completedAt) return;
          store.put({...current, status:'COMPLETE', backupId:confirmation.backupId,
            completedAt:confirmation.completedAt, payloadSha256:sourceKey});
          confirmed = true;
          };
        };
        tx.oncomplete = () => resolve(confirmed);
        tx.onabort = tx.onerror = () => reject(tx.error || new Error('Safety confirmation failed.'));
      });
    } finally { db.close(); }
  }

  async function estimate() {
    if (!root.navigator?.storage?.estimate) return null;
    const value = await root.navigator.storage.estimate();
    return { usage: Number(value.usage || 0), quota: Number(value.quota || 0) };
  }

  root.CLICK360_V16_STORAGE = Object.freeze({ probe, putSnapshot, getSnapshot, deleteSnapshot, estimate, contextId,
    getSafetyMetadata, allocateSafetyMetadata, confirmSafetyMetadata });
})(typeof window !== 'undefined' ? window : globalThis);
