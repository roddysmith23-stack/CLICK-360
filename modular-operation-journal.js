// DEV repository component. Not loaded by the production application.
// Each operation is durable independently; an uncertain response requires a
// ledger lookup before any retry. No transport or credentials live here.
(function (root) {
  'use strict';
  const canonical = value => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(canonical);
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    }
    // Do not silently hash Date/Timestamp/bytes as {} or drop undefined fields.
    // The adapter must explicitly encode typed values before journaling them.
    throw Error('JOURNAL_PAYLOAD_REQUIRES_EXPLICIT_JSON_TYPES');
  };
  async function digest(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
    return [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function key(identity, operationId) {
    for (const value of [identity.ownerUid, identity.businessId, operationId]) {
      if (typeof value !== 'string' || !value || value.length > 120 || /[/:.]/.test(value)) throw Error('INVALID_JOURNAL_IDENTITY');
    }
    return `${identity.ownerUid}:${identity.businessId}:${operationId}`;
  }
  async function open(options = {}) {
    if (!root.indexedDB) throw Error('DURABLE_JOURNAL_UNAVAILABLE');
    const db = await new Promise((resolve, reject) => {
      const request = root.indexedDB.open(options.databaseName || 'click360-modular-outbox-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('operations', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('JOURNAL_UPGRADE_BLOCKED'));
    });
    db.onversionchange = () => db.close();
    const change = (id, mutate) => new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readwrite');
      const store = tx.objectStore('operations');
      let result, failure;
      const request = store.get(id);
      request.onsuccess = () => {
        try { result = mutate(request.result); if (result) store.put(result); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || Error('JOURNAL_TRANSACTION_ABORTED'));
      tx.onerror = () => {}; // onabort is the authoritative failure signal.
    });
    const read = id => new Promise((resolve, reject) => {
      const tx = db.transaction('operations', 'readonly');
      const request = tx.objectStore('operations').get(id);
      let row;
      request.onsuccess = () => { row = request.result; };
      tx.oncomplete = () => resolve(row);
      tx.onabort = () => reject(tx.error || Error('JOURNAL_READ_ABORTED'));
    });
    return Object.freeze({
      close: () => db.close(),
      get: (identity, operationId) => read(key(identity, operationId)),
      async enqueue(identity, operationId, payload) {
        const id = key(identity, operationId);
        // Clone before hashing: callers cannot mutate the queued request later.
        const candidate = structuredClone(payload);
        const payloadHash = await digest(candidate);
        return change(id, current => {
          if (current) {
            if (current.payloadHash !== payloadHash) throw Error('OPERATION_ID_PAYLOAD_CONFLICT');
            return current;
          }
          return { key: id, ownerUid: identity.ownerUid, businessId: identity.businessId, operationId, payload: candidate, payloadHash,
            schemaVersion: 1, state: 'queued', revision: 1, attempts: 0, createdAt: Date.now() };
        });
      },
      async claim(identity, operationId, deviceId, now = Date.now()) {
        if (!deviceId) throw Error('DEVICE_ID_REQUIRED');
        return change(key(identity, operationId), current => {
          if (!current) throw Error('OPERATION_NOT_FOUND');
          if (current.state === 'inflight' && current.leaseUntil <= now) {
            // A crashed writer may already have committed remotely.
            return { ...current, state: 'unknown', revision: current.revision + 1 };
          }
          if (current.state !== 'queued') throw Error('OPERATION_REQUIRES_LEDGER_RECONCILIATION');
          return { ...current, state: 'inflight', claimedBy: deviceId, leaseUntil: now + 60000,
            attempts: current.attempts + 1, revision: current.revision + 1 };
        });
      },
      async markUnknown(identity, operationId, expectedRevision) {
        return change(key(identity, operationId), current => {
          if (!current || current.revision !== expectedRevision || current.state !== 'inflight') throw Error('JOURNAL_REVISION_CONFLICT');
          return { ...current, state: 'unknown', revision: current.revision + 1 };
        });
      },
      async reconcile(identity, operationId, expectedRevision, authoritative) {
        // The adapter must use a fresh SERVER ledger read. Cached/absent-network
        // results are not proof of absence and can never authorize a retry.
        if (authoritative?.source !== 'server') throw Error('SERVER_LEDGER_READ_REQUIRED');
        return change(key(identity, operationId), current => {
          if (!current || current.revision !== expectedRevision) throw Error('JOURNAL_REVISION_CONFLICT');
          if (!['unknown', 'inflight'].includes(current.state)) throw Error('JOURNAL_STATE_CONFLICT');
          if (authoritative.exists) {
            const record = authoritative.record;
            if (!record || record.ownerUid !== identity.ownerUid || record.businessId !== identity.businessId
              || record.operationId !== operationId || record.payloadHash !== current.payloadHash) throw Error('REMOTE_LEDGER_IDENTITY_CONFLICT');
            return { ...current, state: 'confirmed', revision: current.revision + 1, confirmedAt: Date.now() };
          }
          return { ...current, state: 'queued', claimedBy: null, leaseUntil: 0, revision: current.revision + 1 };
        });
      }
    });
  }
  root.CLICK360_MODULAR_JOURNAL = Object.freeze({ open, validatePayload:canonical });
})(typeof window === 'undefined' ? globalThis : window);
