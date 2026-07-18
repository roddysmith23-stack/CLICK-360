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
      operationId: String(metadata.operationId || '').slice(0, 96),
      payloadHash: String(metadata.payloadHash || '').slice(0, 128),
      materialHash: String(metadata.materialHash || '').slice(0, 128),
      source: String(metadata.source || 'local_snapshot').slice(0, 48),
      updatedAtMs: Number(snapshot?.updatedAtMs || Date.now()),
      pendingCreatedAtMs: Number(metadata.pendingCreatedAtMs || 0),
      savedAtMs: Date.now()
    };
    await transact(SNAPSHOT_STORE, 'readwrite', (store) => store.put(record));
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

  async function estimate() {
    if (!root.navigator?.storage?.estimate) return null;
    const value = await root.navigator.storage.estimate();
    return { usage: Number(value.usage || 0), quota: Number(value.quota || 0) };
  }

  root.CLICK360_V16_STORAGE = Object.freeze({ probe, putSnapshot, getSnapshot, deleteSnapshot, estimate, contextId });
})(typeof window !== 'undefined' ? window : globalThis);
