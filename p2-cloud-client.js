(function (root) {
  'use strict';

  const SAFE_ID = /^[A-Za-z0-9_-]{3,128}$/;
  const retryable = new Set(['network_error', 'timeout', 'unavailable']);

  function config() {
    return root.CLICK360_P2_CLOUD?.config || { enabled: false, reason: 'p2_cloud_config_missing' };
  }
  function assertEnabled() {
    const value = config();
    if (!value.enabled || value.projectId === 'click-360') throw new Error('p2_cloud_not_enabled');
    return value;
  }
  function safeId(value, label = 'id') {
    const normalized = String(value || '').trim();
    if (!SAFE_ID.test(normalized)) throw new Error('invalid_' + label);
    return normalized;
  }
  function idempotencyKey(prefix = 'p2') {
    const bytes = new Uint8Array(18);
    if (!root.crypto?.getRandomValues) throw new Error('secure_idempotency_unavailable');
    root.crypto.getRandomValues(bytes);
    return prefix + '_' + [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  async function token() {
    const user = root.click360Auth?.currentUser || root.firebase?.auth?.().currentUser;
    if (!user) throw new Error('auth_required');
    return user.getIdToken();
  }
  function endpoint(action) {
    const value = assertEnabled();
    return String(value.functionsOrigin || '').replace(/\/$/, '') + '/' + encodeURIComponent(action);
  }
  function sanitiseError(error = {}) {
    const code = String(error.code || error.message || 'unknown').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 80);
    return { code: code || 'unknown', retryable: retryable.has(code) };
  }
  async function call(action, payload = {}, options = {}) {
    const requestKey = options.idempotencyKey || idempotencyKey(action);
    const response = await root.fetch(endpoint(safeId(action, 'action')), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + await token()
      },
      body: JSON.stringify({ payload, idempotencyKey: requestKey })
    }).catch((error) => {
      const wrapped = new Error('network_error');
      wrapped.cause = error;
      throw wrapped;
    });
    let body = {};
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok || body.ok === false) {
      const error = new Error(String(body.code || 'http_' + response.status));
      error.code = body.code || 'http_' + response.status;
      error.requestId = body.requestId || '';
      throw error;
    }
    return { ...(body.result || {}), requestId: body.requestId || '', idempotencyKey: requestKey };
  }
  function firestore() {
    assertEnabled();
    const db = root.click360Db || root.firebase?.firestore?.();
    if (!db) throw new Error('firestore_unavailable');
    return db;
  }
  function businessRef(businessId) {
    return firestore().collection('businesses').doc(safeId(businessId, 'business_id'));
  }
  function subscribe(ref, onValue, onError) {
    return ref.onSnapshot((snapshot) => onValue(snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null), (error) => onError?.(sanitiseError(error)));
  }
  function collectionItems(ref, onValue, onError) {
    return ref.onSnapshot((snapshot) => onValue(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), (error) => onError?.(sanitiseError(error)));
  }
  function offlineState() {
    if (!config().enabled) return { status: 'disabled', retryable: false };
    return root.navigator?.onLine === false
      ? { status: 'offline', retryable: true }
      : { status: 'online', retryable: false };
  }

  root.CLICK360_P2_CLOUD_CLIENT = Object.freeze({
    config, assertEnabled, safeId, idempotencyKey, call, firestore, businessRef, subscribe, collectionItems, offlineState, sanitiseError
  });
})(typeof window !== 'undefined' ? window : globalThis);
