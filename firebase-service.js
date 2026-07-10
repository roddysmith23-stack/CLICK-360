(function () {
  if (!window.firebase || !window.CLICK360_FIREBASE_CONFIG) {
    console.error("CLICK360 Firebase no está cargado.");
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.CLICK360_FIREBASE_CONFIG);

  if (!window.CLICK360_P0_TENANT_GUARD) {
    console.error("CLICK360 P0 tenant guard no está cargado.");
    return;
  }

  // Programmatically clear old caches if needed
  const CURRENT_CACHE_KEY = 'click360-p0-production-audit-v13';
  const CLICK360_CACHE_PREFIX = 'click360-';
  try {
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(key => {
          if (key.startsWith(CLICK360_CACHE_PREFIX) && key !== CURRENT_CACHE_KEY) {
            caches.delete(key).catch(() => {});
          }
        });
      }).catch(err => console.warn("Error al obtener llaves de caché:", err));
    }
  } catch(cacheErr) {
    console.warn("Cachés no accesibles en este entorno:", cacheErr);
  }

	  const auth = firebase.auth();
	  const db = firebase.firestore();
	  db.enablePersistence({ synchronizeTabs: true }).catch(err => {
	    console.warn("Persistencia offline de Firestore no disponible:", err.message);
	  });

  window.click360Auth = auth;
  window.click360Db = db;
  let BUSINESS_ID = null;
  let STATE_DOC = null;
  let ACTIVE_CONTEXT = null;
  let AUTH_EPOCH = 0;
	  const tenantGuard = window.CLICK360_P0_TENANT_GUARD.createSyncGate();

  let AUTH_APPROVED = false;
  let PULL_COMPLETE = false;
  let IS_RESTORING_REMOTE = false;
  let INITIAL_TENANT_SEED_REQUIRED = false;
  let REMOTE_UNSUBSCRIBE = null;
  let USER_STATUS_UNSUBSCRIBE = null;
	  let LOCAL_WRITE_PENDING_UNTIL = 0;
	  let LAST_REMOTE_REVISION = 0;
	  const PUSH_SCHEDULERS = new Map();
	  let SYNC_CONFLICT_PENDING = false;

	  const rawSetItem = localStorage.setItem.bind(localStorage);
	  const PROFILE_CACHE_PREFIX = "CLICK360_USER_PROFILE_";
	  const PROFILE_PENDING_PREFIX = 'CLICK360_PROFILE_PENDING:';
	  const LEGACY_STATE_LS_KEY = 'click360_mvp_qa_final_state_v1';
	  const DEVICE_ID_KEY = "CLICK360_DEVICE_ID";
	  const APPROVED_IDENTITY_PREFIX = "CLICK360_APPROVED_IDENTITY:";
	  const SCHEMA_VERSION = 10;
	  const OFFLINE_APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
	  const MAX_CLOUD_PAYLOAD_BYTES = window.CLICK360_P0_TENANT_GUARD.MAX_CLOUD_PAYLOAD_BYTES;
	  function tenantKeyFor(ownerId, businessId) {
	    return `owner:${ownerId}:business:${businessId}`;
	  }
	  function tenantStorageKey(suffix) {
	    return ACTIVE_CONTEXT ? `CLICK360_TENANT:${ACTIVE_CONTEXT.tenantKey}:${suffix}` : '';
	  }
	  function tenantStorageKeyFor(context, suffix) {
	    return context?.tenantKey ? `CLICK360_TENANT:${context.tenantKey}:${suffix}` : '';
	  }
	  function approvedIdentityStorageKey(uid) {
	    return uid ? `${APPROVED_IDENTITY_PREFIX}${uid}` : '';
	  }
	  function legacyMigrationMarkerKey() {
	    return tenantStorageKey('LEGACY_MIGRATION_REQUIRED');
	  }
	  function tenantCorruptMarkerKey() {
	    return tenantStorageKey('CORRUPT');
	  }
	  function syncConflictMarkerKey() {
	    return tenantStorageKey('SYNC_CONFLICT');
	  }
	  function activeIdentity() {
	    return ACTIVE_CONTEXT ? {
	      ownerUid: ACTIVE_CONTEXT.ownerUid,
	      ownerId: ACTIVE_CONTEXT.ownerId,
	      businessId: ACTIVE_CONTEXT.businessId,
	      tenantKey: ACTIVE_CONTEXT.tenantKey,
	      schemaVersion: SCHEMA_VERSION
	    } : null;
	  }
	  function sameTenant(identity) {
	    return window.CLICK360_P0_TENANT_GUARD.sameTenantIdentity(identity, ACTIVE_CONTEXT);
	  }
	  function safeStorageSet(key, value) {
	    if (!key) return false;
	    try { rawSetItem(key, value); return true; } catch (error) {
	      console.warn('No se pudo guardar metadato local:', error.message);
	      return false;
	    }
	  }
	  function isCurrentAuthEpoch(user, expectedEpoch = AUTH_EPOCH) {
	    return expectedEpoch === AUTH_EPOCH && !!user && auth.currentUser?.uid === user.uid;
	  }
	  function isActiveSyncScope(context, stateDoc, expectedEpoch, user = auth.currentUser) {
	    return isCurrentAuthEpoch(user, expectedEpoch)
	      && !!context
	      && !!stateDoc
	      && ACTIVE_CONTEXT === context
	      && STATE_DOC === stateDoc
	      && window.CLICK360_P0_TENANT_GUARD.sameTenant(context, ACTIVE_CONTEXT)
	      && activeIdentityIsValid(user);
	  }
	  function markSyncConflict(details = {}) {
	    SYNC_CONFLICT_PENDING = true;
	    safeStorageSet(syncConflictMarkerKey(), '1');
	    quarantineIncident('same_tenant_conflict', details);
	  }
	  function clearSyncConflict() {
	    SYNC_CONFLICT_PENDING = false;
	    try { localStorage.removeItem(syncConflictMarkerKey()); } catch {}
	  }
	  function activeIdentityIsValid(user = auth.currentUser) {
	    return !!user && !!ACTIVE_CONTEXT && !!window.click360User
	      && user.uid === ACTIVE_CONTEXT.authUid
	      && window.click360User.uid === ACTIVE_CONTEXT.authUid
	      && window.click360User.ownerId === ACTIVE_CONTEXT.ownerId
	      && BUSINESS_ID === ACTIVE_CONTEXT.businessId
	      && !!STATE_DOC;
	  }
	  function legacyMigrationRequired() {
	    return tenantGuard.snapshot().mode === window.CLICK360_P0_TENANT_GUARD.MODES.LEGACY_MIGRATION_REQUIRED;
	  }
	  function verifiedOfflineTenantCache() {
	    if (!ACTIVE_CONTEXT || localStorage.getItem(legacyMigrationMarkerKey()) || localStorage.getItem(tenantCorruptMarkerKey())) return false;
	    const status = window.click360GetTenantCacheStatus?.(ACTIVE_CONTEXT);
	    return status?.valid === true;
	  }
	  function getDeviceId() {
	    let id = localStorage.getItem(DEVICE_ID_KEY);
	    if (!id) {
	      id = `device_${window.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`}`;
	      safeStorageSet(DEVICE_ID_KEY, id);
	    }
	    return id;
	  }
	  const DEVICE_ID = getDeviceId();
	  let syncStatus = {
	    status: navigator.onLine ? "checking" : "offline",
	    message: "",
	    businessId: null,
	    updatedAt: new Date().toISOString()
	  };
	  function setSyncStatus(status, message = "", extra = {}) {
	    syncStatus = {
	      ...syncStatus,
	      ...extra,
	      status,
	      message,
	      businessId: BUSINESS_ID,
	      deviceId: DEVICE_ID,
	      updatedAt: new Date().toISOString()
	    };
	    window.click360SyncStatus = syncStatus;
	    window.dispatchEvent(new CustomEvent("click360-sync-status", { detail: syncStatus }));
	  }
	  window.click360GetSyncStatus = () => ({ ...syncStatus });
	  window.click360OnSyncStatus = (fn) => {
	    if (typeof fn !== "function") return () => {};
	    const handler = (event) => fn(event.detail);
	    window.addEventListener("click360-sync-status", handler);
	    fn({ ...syncStatus });
	    return () => window.removeEventListener("click360-sync-status", handler);
	  };
	  window.addEventListener("offline", () => setSyncStatus("offline", "Sin conexión. Los cambios quedan en este dispositivo."));
	  window.addEventListener("online", () => {
	    setSyncStatus("pending", "Conexión recuperada. Sincronizando cambios pendientes.");
	    if (AUTH_APPROVED && PULL_COMPLETE && STATE_DOC) pushLocalToFirestore("online_reconnect").catch(() => {});
	  });

  const initUrlParams = new URLSearchParams(location.search);

  if (initUrlParams.get("resetC360") === "1") {
    // P0: never erase tenant data from a URL parameter. The old reset flag now
    // only removes itself from the address bar.
    history.replaceState({}, "", location.pathname + "?v=p0-production-audit-v13");
  }

  function setAppBlocked(blocked) {
    const app = document.getElementById("app");
    if (!app) return;
    app.style.pointerEvents = blocked ? "none" : "auto";
    app.style.userSelect = blocked ? "none" : "auto";
    app.style.filter = blocked ? "blur(4px)" : "none";
    app.style.opacity = blocked ? "0.15" : "1";
    if(blocked) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
  }

	  function safeJsonParse(value) {
	    try { return JSON.parse(value); } catch (e) { return null; }
	  }
	  function escapeHtml(value) {
	    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
	  }

  function getCachedProfile(uid) {
    if (!uid) return null;
    return safeJsonParse(localStorage.getItem(PROFILE_CACHE_PREFIX + uid));
  }

	  function profileUpdatedAtMs(value) {
	    if (typeof value?.toMillis === 'function') return value.toMillis();
	    if (Number.isFinite(Number(value?.seconds))) return Number(value.seconds) * 1000;
	    const parsed = Date.parse(String(value || ''));
	    return Number.isFinite(parsed) ? parsed : 0;
	  }
	  function protectCurrentProfile(user, remoteData = {}) {
	    const cached = getCachedProfile(user?.uid);
	    if (!cached || !window.click360User) return;
	    const pending = safeJsonParse(localStorage.getItem(`${PROFILE_PENDING_PREFIX}${user.uid}`));
	    const localWins = pending?.uid === user.uid
	      || profileUpdatedAtMs(cached.updatedAt) >= profileUpdatedAtMs(remoteData.updatedAt);
	    if (localWins) {
	      if (cached.name) window.click360User.name = cached.name;
	      if (cached.photoURL) window.click360User.photoURL = cached.photoURL;
	      return;
	    }
	    safeStorageSet(PROFILE_CACHE_PREFIX + user.uid, JSON.stringify({
	      uid: user.uid,
	      name: window.click360User.name || '',
	      photoURL: window.CLICK360_P0_TENANT_GUARD.safeImageSrc(window.click360User.photoURL),
	      email: window.click360User.email || '',
	      updatedAt: remoteData.updatedAt?.toDate?.().toISOString?.() || remoteData.updatedAt || new Date().toISOString()
	    }));
	  }
	  function cacheApprovedIdentity(user, data) {
	    if (!user || !isExplicitlyActive(data)) return;
	    const safe = {
	      uid: user.uid,
	      email: user.email || data.email || "",
	      role: data.role,
	      name: data.name || user.displayName || "",
	      photoURL: data.photoURL || user.photoURL || "",
	      status: data.status || "active",
	      approved: data.approved === true,
	      ownerId: data.ownerId || user.uid,
	      isOwner: data.role === 'owner',
	      businessLimit: Number(data.businessLimit || 2),
	      cachedAtMs: Date.now()
	    };
	    safeStorageSet(approvedIdentityStorageKey(user.uid), JSON.stringify(safe));
	  }
	  function getCachedApprovedIdentity(user) {
	    if (!user) return null;
	    const cached = safeJsonParse(localStorage.getItem(approvedIdentityStorageKey(user.uid)));
	    if (!cached || cached.uid !== user.uid || cached.status !== 'active' || cached.approved !== true) return null;
	    if (cached.email && user.email && cached.email.toLowerCase() !== user.email.toLowerCase()) return null;
	    if (!Number.isFinite(Number(cached.cachedAtMs)) || Date.now() - Number(cached.cachedAtMs) > OFFLINE_APPROVAL_MAX_AGE_MS) return null;
	    return cached;
	  }
	  function applyApprovedIdentity(user, data, source = "remote", expectedEpoch = AUTH_EPOCH) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
	    const ownerId = data.ownerId || user.uid;
	    const allowedRoles = ['owner', 'worker', 'cashier', 'inventory'];
	    const role = allowedRoles.includes(data.role)
	      ? data.role
	      : ((data.isOwner === true || ownerId === user.uid) ? 'owner' : null);
	    if (!role || (role === 'owner' && ownerId !== user.uid) || (role !== 'owner' && ownerId === user.uid)) return false;
	    // CLICK 360 stores one protected snapshot at the owner's canonical root.
	    // A different approvedUsers.businessId would not be authorized by the
	    // deployed contract, so reject it instead of opening an unsyncable tenant.
	    if (data.businessId && data.businessId !== ownerId) return false;
	    const businessId = ownerId;
	    window.click360User = {
	      uid: user.uid,
	      email: user.email || data.email,
	      role,
	      name: data.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario"),
	      photoURL: data.photoURL || user.photoURL || '',
	      status: data.status || "active",
	      approved: data.approved === true,
	      businessLimit: Number(data.businessLimit || 2),
	      ownerId,
	      isOwner: role === 'owner',
	      source
	    };
	    protectCurrentProfile(user, data);
	    ACTIVE_CONTEXT = Object.freeze({
	      authUid: user.uid,
	      ownerUid: ownerId,
	      ownerId,
	      businessId,
	      tenantKey: tenantKeyFor(ownerId, businessId),
	      schemaVersion: SCHEMA_VERSION
	    });
	    tenantGuard.begin(ACTIVE_CONTEXT);
	    BUSINESS_ID = businessId;
	    STATE_DOC = db.collection("businesses").doc(BUSINESS_ID).collection("state").doc("main");
	    LAST_REMOTE_REVISION = Number(localStorage.getItem(tenantStorageKey("REMOTE_REVISION")) || 0);
	    SYNC_CONFLICT_PENDING = localStorage.getItem(syncConflictMarkerKey()) === '1';
	    if (typeof window.click360SetTenantContext !== "function") {
	      throw new Error("La interfaz segura todavía no está lista.");
	    }
	    window.click360SetTenantContext(ACTIVE_CONTEXT);
	    cacheApprovedIdentity(user, window.click360User);
	    return true;
	  }

	  function snapshotString(obj) {
	    try { return JSON.stringify(obj || {}); } catch (e) { return "{}"; }
	  }

	  function buildBusinessPayload() {
	    if (!activeIdentityIsValid() || typeof window.click360GetTenantState !== "function") return null;
	    const state = window.click360GetTenantState();
	    if (!state || !sameTenant(state.identity)) return null;
	    const settings = state.settings || {};
	    const payload = {
	      schemaVersion: SCHEMA_VERSION,
	      identity: activeIdentity(),
	      data: {
	        businesses: Array.isArray(state.businesses) ? state.businesses : [],
	        activeBusinessId: state.activeBusinessId || null,
	        products: Array.isArray(state.products) ? state.products : [],
	        sales: Array.isArray(state.sales) ? state.sales : [],
	        movements: Array.isArray(state.movements) ? state.movements : [],
	        dailyReports: Array.isArray(state.dailyReports) ? state.dailyReports : [],
	        invoices: Array.isArray(state.invoices) ? state.invoices : [],
	        deletedProducts: Array.isArray(state.deletedProducts) ? state.deletedProducts : [],
	        auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs : [],
	        settings: {
	          labelTemplates: Array.isArray(settings.labelTemplates) ? settings.labelTemplates : [],
	          workers: Array.isArray(settings.workers) ? settings.workers : []
	        },
	        updatedAtMs: Number(state.updatedAtMs || Date.now()),
	        updatedAt: state.updatedAt || new Date().toISOString()
	      }
	    };
	    return window.CLICK360_P0_TENANT_GUARD.validBusinessPayload(payload, ACTIVE_CONTEXT) ? payload : null;
	  }

	  function localPayloadUpdatedAtMs() {
	    return Number(buildBusinessPayload()?.data?.updatedAtMs || 0);
	  }

	  function quarantineIncident(kind, details = {}) {
	    const key = `CLICK360_QUARANTINE:${DEVICE_ID}:${Date.now()}:${kind}`;
	    try {
	      safeStorageSet(key, JSON.stringify({ kind, createdAt: new Date().toISOString(), context: ACTIVE_CONTEXT, ...details }));
	      const prefix = `CLICK360_QUARANTINE:${DEVICE_ID}:`;
	      const keys = [];
	      for (let index = 0; index < localStorage.length; index += 1) {
	        const itemKey = localStorage.key(index);
	        if (itemKey?.startsWith(prefix)) keys.push(itemKey);
	      }
	      keys.sort();
	      keys.slice(0, Math.max(0, keys.length - 25)).forEach((itemKey) => localStorage.removeItem(itemKey));
	    } catch (error) {
	      console.warn("No se pudo guardar cuarentena:", error.message);
	    }
	  }

	  function quarantineLegacyLocalState() {
	    const raw = localStorage.getItem(LEGACY_STATE_LS_KEY);
	    const marker = `CLICK360_LEGACY_QUARANTINED:${DEVICE_ID}`;
	    if (!raw || localStorage.getItem(marker)) return;
	    const legacy = safeJsonParse(raw) || {};
	    const candidates = Array.isArray(legacy.businesses)
	      ? legacy.businesses.map(b => ({ id: b.id || null, name: b.name || null })) : [];
	    quarantineIncident("legacy_local_state", {
	      detectedUid: auth.currentUser?.uid || null,
	      detectedEmail: auth.currentUser?.email || null,
	      businessCandidates: candidates,
	      remoteMatches: [],
	      ambiguous: true,
	      legacyStateBytes: window.CLICK360_P0_TENANT_GUARD.utf8Bytes(raw)
	    });
	    safeStorageSet(marker, "1");
	  }

	  function remoteMatchesContext(remote, context) {
	    return !!remote && remote.schemaVersion === SCHEMA_VERSION
	      && remote.ownerId === context?.ownerId
	      && remote.businessId === context?.businessId
	      && remote.ownerUid === context?.ownerUid
	      && remote.tenantKey === context?.tenantKey
	      && window.CLICK360_P0_TENANT_GUARD.validBusinessPayload(remote.payload, context);
	  }
	  function applyRemotePayload(payload) {
	    if (!payload || !sameTenant(payload.identity) || typeof window.click360ApplyTenantState !== "function") {
	      throw new Error("Snapshot remoto pertenece a otro tenant o es inválido.");
	    }
	    const current = window.click360GetTenantState?.() || {};
	    const incoming = payload.data || {};
	    const nextState = {
	      ...incoming,
	      identity: activeIdentity(),
	      // Per-user profile photos and names remain local to the authenticated uid.
	      settings: { ...(incoming.settings || {}), userProfiles: current.settings?.userProfiles || {} }
	    };
	    IS_RESTORING_REMOTE = true;
	    try {
	      window.click360ApplyTenantState(nextState, ACTIVE_CONTEXT);
	    } finally {
	      IS_RESTORING_REMOTE = false;
	    }
	  }

	  function buildV10StateDocument(payload, reason, extra = {}) {
	    const user = auth.currentUser;
	    const revision = Math.max(Date.now(), Number(LAST_REMOTE_REVISION || 0) + 1);
	    return {
	      schemaVersion: SCHEMA_VERSION,
	      ownerUid: ACTIVE_CONTEXT.ownerUid,
	      ownerId: ACTIVE_CONTEXT.ownerId,
	      businessId: ACTIVE_CONTEXT.businessId,
	      tenantKey: ACTIVE_CONTEXT.tenantKey,
	      revision,
	      baseRevision: LAST_REMOTE_REVISION || 0,
	      deviceId: DEVICE_ID,
	      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
	      updatedAtMs: revision,
	      updatedBy: user?.uid || null,
	      updatedByEmail: user?.email || null,
	      reason,
	      payload,
	      ...extra
	    };
	  }

	  function legacyMigrationMessage() {
	    return 'Detectamos datos de una versión anterior. Están protegidos y la operación queda bloqueada hasta que un administrador complete una migración verificada.';
	  }

	  function showLegacyMigrationGate() {
	    showGate(legacyMigrationMessage());
	    setAppBlocked(true);
	  }

	  // Legacy data is migrated only by scripts/migrate-legacy-v9-to-v10.mjs with
	  // administrative credentials. A public browser must never rewrite it.
	  window.click360MigrateLegacyRemote = async function() {
	    throw new Error('La migración legacy es administrativa. Este tenant permanece protegido hasta completar el proceso verificado.');
	  };

  function isExplicitlyActive(data) {
    return !!data && (
      (data.status === 'active' && data.approved === true)
      || (!Object.prototype.hasOwnProperty.call(data, 'status') && data.approved === true)
    );
  }

  function setPendingUser(user, data = {}, status = 'pending') {
    window.click360User = {
      uid: user.uid,
      email: user.email || data.email || '',
      role: data.role || 'worker',
      name: data.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario'),
      photoURL: data.photoURL || user.photoURL || '',
      status,
      businessLimit: Number(data.businessLimit || 2),
      ownerId: data.ownerId || user.uid,
      isOwner: data.isOwner === true || data.role === 'owner'
    };
  }

  async function isApprovedUser(user, expectedEpoch = AUTH_EPOCH) {
    if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
    try {
      const doc = await db.collection('approvedUsers').doc(user.uid).get();
      if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
      let data = doc.exists ? (doc.data() || {}) : null;

      if (data?.status === 'blocked' || data?.status === 'revoked') {
        setPendingUser(user, data, data.status);
        return false;
      }

      if (!data && user.email) {
        const emailDoc = await db.collection('approvedUsersByEmail').doc(user.email.toLowerCase()).get().catch(() => null);
        if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
        const invite = emailDoc?.exists ? (emailDoc.data() || {}) : null;
        if (invite?.status === 'active' && invite.approved === true) {
          data = {
            uid: user.uid,
            email: user.email,
            role: invite.role || 'worker',
            ownerId: invite.ownerId || user.uid,
            name: invite.name || user.displayName || (user.email ? user.email.split('@')[0] : 'Trabajador'),
            status: 'active',
            approved: true,
            businessLimit: Number(invite.businessLimit || 2),
            photoURL: user.photoURL || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            approvedFromEmail: true
          };
          await db.collection('approvedUsers').doc(user.uid).set(data, { merge: true });
          if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
        }
      }

      if (isExplicitlyActive(data)) {
        if (data.businessId && data.businessId !== (data.ownerId || user.uid)) {
          setPendingUser(user, data, 'tenant_configuration_invalid');
          return false;
        }
        return applyApprovedIdentity(user, data, 'approvedUsers', expectedEpoch);
      }

      setPendingUser(user, data || {}, data?.status || 'pending');
      return false;
    } catch (error) {
      if (!isCurrentAuthEpoch(user, expectedEpoch)) return false;
      const cached = getCachedApprovedIdentity(user);
      if (cached && (!navigator.onLine || error.code === 'unavailable')) {
        const applied = applyApprovedIdentity(user, cached, 'offline_cache', expectedEpoch);
        if (applied) setSyncStatus('offline', 'Trabajando sin internet con la última aprobación guardada.');
        return applied;
      }
      console.warn('No se pudo verificar la aprobación:', error.message);
      return false;
    }
  }

  window.click360DebugAuth = function() {
    return {
      authenticated: !!auth.currentUser,
      approved: AUTH_APPROVED,
      tenantKey: ACTIVE_CONTEXT?.tenantKey || null,
      syncStatus: syncStatus.status
    };
  };
	  window.click360InviteWorkerEmail = async function(email, name) {
	    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
	    const uid = window.click360User.uid;
	    const normalizedEmail = String(email || "").trim().toLowerCase();
	    const inviteToken = window.crypto?.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
	    await db.collection("approvedUsersByEmail").doc(normalizedEmail).set({
	      email: normalizedEmail,
	      role: "worker",
	      ownerId: uid,
	      inviteToken,
	      status: "active",
	      approved: true,
	      name: name,
	      businessLimit: Number(window.click360User.businessLimit || 2),
	      createdAt: firebase.firestore.FieldValue.serverTimestamp()
	    });
	    return { inviteToken, ownerId: uid };
	  };

	  window.click360CancelInviteEmail = async function(email) {
	    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
	    await db.collection("approvedUsersByEmail").doc(email.toLowerCase()).set({
	      status: "blocked",
	      approved: false,
	      revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
	      revokedBy: window.click360User.uid
	    }, { merge: true });
	  };

	  window.click360RemoveWorkerUid = async function(workerUid) {
	    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
	    await db.collection("approvedUsers").doc(workerUid).set({
	      status: "blocked",
	      approved: false,
	      revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
	      revokedBy: window.click360User.uid
	    }, { merge: true });
	  };

	  window.click360RevokeWorker = async function(email, workerUid = '') {
	    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
	    const normalizedEmail = String(email || '').trim().toLowerCase();
	    if (!normalizedEmail) throw new Error('Correo de trabajador inválido.');
	    const inviteRef = db.collection('approvedUsersByEmail').doc(normalizedEmail);
	    const inviteSnapshot = await inviteRef.get();
	    const batch = db.batch();
	    let writes = 0;
	    if (inviteSnapshot.exists) {
	      batch.set(inviteRef, {
	        status: 'blocked',
	        approved: false,
	        revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
	        revokedBy: window.click360User.uid
	      }, { merge: true });
	      writes += 1;
	    }
	    if (workerUid) {
	      batch.set(db.collection('approvedUsers').doc(workerUid), {
	        status: 'blocked',
	        approved: false,
	        revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
	        revokedBy: window.click360User.uid
	      }, { merge: true });
	      writes += 1;
	    }
	    if (!writes) throw new Error('No se encontró una invitación ni una cuenta de trabajador para revocar.');
	    await batch.commit();
	  };

	  function syncError(code, message, details = {}) {
	    const error = new Error(message);
	    error.code = code;
	    error.details = details;
	    return error;
	  }

	  async function pushLocalToFirestoreOnce(reason = 'auto') {
	    const user = auth.currentUser;
	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	    if (legacyMigrationRequired()) {
	      setSyncStatus('migration_required', legacyMigrationMessage());
	      return false;
	    }
	    if (SYNC_CONFLICT_PENDING) {
	      setSyncStatus('error', 'Hay un conflicto pendiente. Descarga o respalda los datos antes de volver a sincronizar.');
	      return false;
	    }
	    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user) || !AUTH_APPROVED || IS_RESTORING_REMOTE || !PULL_COMPLETE || !tenantGuard.canWrite(context)) return false;
	    if (!navigator.onLine) {
	      setSyncStatus('offline', 'Sin internet. Cambios pendientes de subir.');
	      return false;
	    }

	    const payload = buildBusinessPayload();
	    const payloadBytes = window.CLICK360_P0_TENANT_GUARD.utf8Bytes(payload || {});
	    if (!payload || !sameTenant(payload.identity)) {
	      quarantineIncident('blocked_push_identity', { reason });
	      setSyncStatus('error', 'Se bloqueó una escritura porque la identidad o el contenido del tenant no coincide.');
	      return false;
	    }
	    if (payloadBytes > MAX_CLOUD_PAYLOAD_BYTES) {
	      setSyncStatus('error', `Los datos ocupan ${Math.ceil(payloadBytes / 1024)} KB y superan el límite seguro de sincronización. Reduce imágenes antes de continuar.`);
	      return false;
	    }

	    const expectedRevision = Number(LAST_REMOTE_REVISION || 0);
	    const documentData = buildV10StateDocument(payload, reason);
	    setSyncStatus('syncing', 'Guardando cambios en Firestore.', { reason });

	    try {
	      const wrote = await window.CLICK360_P0_TENANT_GUARD.guardedWrite(tenantGuard, context, async () => {
	        await db.runTransaction(async (transaction) => {
	          if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) throw syncError('click360/stale-auth', 'La cuenta cambió antes de sincronizar.');
	          const current = await transaction.get(stateDoc);
	          if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) throw syncError('click360/stale-auth', 'La cuenta cambió durante la sincronización.');
	          if (!current.exists) {
	            if (expectedRevision !== 0) throw syncError('click360/revision-conflict', 'El documento remoto fue reemplazado.', { expectedRevision, remoteRevision: null });
	          } else {
	            const remote = current.data() || {};
	            const remoteRevision = Number(remote.revision || remote.updatedAtMs || 0);
	            if (!remoteMatchesContext(remote, context)) throw syncError('click360/remote-identity', 'La identidad remota no coincide.', { remoteRevision });
	            if (remoteRevision !== expectedRevision) throw syncError('click360/revision-conflict', 'Hay cambios remotos sin resolver.', { expectedRevision, remoteRevision });
	          }
	          transaction.set(stateDoc, documentData);
	        });
	      });
	      if (!wrote) {
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        return false;
	      }
	      if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
	      const hash = snapshotString(payload);
	      safeStorageSet(tenantStorageKeyFor(context, 'LAST_APPLIED_REMOTE_HASH'), hash);
	      safeStorageSet(tenantStorageKeyFor(context, 'REMOTE_REVISION'), String(documentData.revision));
	      LAST_REMOTE_REVISION = documentData.revision;
	      LOCAL_WRITE_PENDING_UNTIL = 0;
	      setSyncStatus('synced', 'Datos guardados en la nube.', { reason, revision: documentData.revision, payloadBytes });
	      return true;
	    } catch (error) {
	      if (error.code === 'click360/stale-auth') return false;
	      if (error.code === 'click360/revision-conflict' || error.code === 'click360/remote-identity') {
	        markSyncConflict({ reason, ...error.details, localRevision: expectedRevision });
	        setSyncStatus('error', 'Se detectaron cambios simultáneos. Tus cambios locales siguen protegidos y no se sobrescribió la nube.');
	        return false;
	      }
	      console.warn('CLICK360 no pudo sincronizar:', error.message);
	      setSyncStatus('error', error.message || 'No se pudo sincronizar.');
	      return false;
	    }
	  }

	  async function pushLocalToFirestore(reason = 'auto') {
	    const context = ACTIVE_CONTEXT;
	    const schedulerKey = context ? `${AUTH_EPOCH}:${context.authUid}:${context.tenantKey}` : '';
	    if (!schedulerKey) return false;
	    const existing = PUSH_SCHEDULERS.get(schedulerKey);
	    if (existing) {
	      existing.queuedReason = reason;
	      return existing.promise;
	    }
	    const scheduler = { queuedReason: null, promise: null };
	    scheduler.promise = (async () => {
	      let nextReason = reason;
	      let result = false;
	      while (nextReason) {
	        scheduler.queuedReason = null;
	        result = await pushLocalToFirestoreOnce(nextReason);
	        nextReason = result ? scheduler.queuedReason : null;
	      }
	      return result;
	    })();
	    PUSH_SCHEDULERS.set(schedulerKey, scheduler);
	    try { return await scheduler.promise; }
	    finally { PUSH_SCHEDULERS.delete(schedulerKey); }
	  }

	  async function pullRemoteOnce({ force = false, reload = false } = {}) {
	    const user = auth.currentUser;
	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	  try {
	    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
	    const localCacheStatus = window.click360GetTenantCacheStatus?.(context) || { valid: false, reason: 'cache_status_unavailable' };
	    if (!navigator.onLine && !force) {
	        if (!verifiedOfflineTenantCache()) {
	          tenantGuard.block();
	          PULL_COMPLETE = false;
	          setSyncStatus('blocked_identity', 'Sin internet y no existe una caché propia, válida y aprobada para esta cuenta.');
	          return false;
	        }
	        tenantGuard.allow(context);
	        PULL_COMPLETE = true;
	        setSyncStatus('offline', 'Sin internet. Usando la última caché verificada de esta cuenta.');
	        return false;
	      }
	      setSyncStatus('syncing', 'Leyendo datos de Firestore.');
	      const snap = await stateDoc.get();
	      if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
	    if (!snap.exists) {
	      if (localCacheStatus.reason !== 'cache_missing') {
	        INITIAL_TENANT_SEED_REQUIRED = false;
	        tenantGuard.block();
	        PULL_COMPLETE = false;
	        quarantineIncident('remote_missing_with_existing_cache', { path: stateDoc.path, cacheReason: localCacheStatus.reason });
	        setSyncStatus('error', 'El documento remoto no existe, pero este dispositivo conserva datos o una caché dañada. Se bloqueó la creación automática para evitar pérdida de información.');
	        return false;
	      }
	      LAST_REMOTE_REVISION = 0;
	        safeStorageSet(tenantStorageKey('REMOTE_REVISION'), '0');
	        tenantGuard.allow(context);
	        PULL_COMPLETE = true;
	        INITIAL_TENANT_SEED_REQUIRED = true;
	        setSyncStatus('pending', 'Tenant nuevo listo. La primera sincronización se hará al desbloquear la cuenta.');
	        return false;
	      }

	      const remoteData = snap.data() || {};
	      if (remoteData.schemaVersion !== SCHEMA_VERSION) {
	        INITIAL_TENANT_SEED_REQUIRED = false;
	        tenantGuard.requireLegacy(context, { document: remoteData, path: stateDoc.path });
	        safeStorageSet(legacyMigrationMarkerKey(), '1');
	        quarantineIncident('legacy_remote_state', {
	          path: stateDoc.path,
	          remoteMetadata: { businessId: remoteData.businessId || null, updatedBy: remoteData.updatedBy || null, updatedByEmail: remoteData.updatedByEmail || null, revision: remoteData.revision || null }
	        });
	        PULL_COMPLETE = false;
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        return false;
	      }
	      if (!remoteMatchesContext(remoteData, context)) {
	        INITIAL_TENANT_SEED_REQUIRED = false;
	        tenantGuard.block();
	        safeStorageSet(tenantCorruptMarkerKey(), '1');
	        quarantineIncident('blocked_pull_identity', { path: stateDoc.path, remoteIdentity: { ownerUid: remoteData.ownerUid, ownerId: remoteData.ownerId, businessId: remoteData.businessId, tenantKey: remoteData.tenantKey } });
	        PULL_COMPLETE = false;
	        setSyncStatus('error', 'Se bloqueó una descarga con identidad o contenido inválido. Tus datos locales siguen intactos.');
	        return false;
	      }

	      const remotePayload = remoteData.payload;
	      const remoteRevision = Number(remoteData.revision || remoteData.updatedAtMs || 0);
	      const remoteHash = snapshotString(remotePayload);
	    const localPayload = buildBusinessPayload();
	    const localHash = snapshotString(localPayload);
	    const alreadyApplied = localStorage.getItem(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'));
	    const localChanged = localCacheStatus.valid === true && (
	      Date.now() < LOCAL_WRITE_PENDING_UNTIL
	      || !alreadyApplied
	      || localHash !== alreadyApplied
	    );

	      INITIAL_TENANT_SEED_REQUIRED = false;
	      localStorage.removeItem(legacyMigrationMarkerKey());
	      localStorage.removeItem(tenantCorruptMarkerKey());
	      LAST_REMOTE_REVISION = remoteRevision;
	      safeStorageSet(tenantStorageKey('REMOTE_REVISION'), String(remoteRevision));
	      tenantGuard.allow(context);
	      PULL_COMPLETE = true;
	    if (force || (remoteHash && remoteHash !== localHash && remoteHash !== alreadyApplied)) {
	      if (localChanged && !force) {
	          markSyncConflict({ path: stateDoc.path, remoteRevision, localUpdatedAtMs: localPayloadUpdatedAtMs(), source: 'pull' });
	          setSyncStatus('error', 'Hay cambios locales y remotos simultáneos. No se sobrescribió ninguna versión.');
	          return false;
	        }
	        applyRemotePayload(remotePayload);
	        safeStorageSet(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'), remoteHash);
	        if (force) clearSyncConflict();
	        setSyncStatus('synced', 'Datos actualizados desde la nube.', { revision: remoteRevision });
	        if (window.click360ReloadState) window.click360ReloadState();
	        if (reload && window.click360Route) window.click360Route(window.location.hash.replace('#','') || 'home');
	      return true;
	    }
	    if (force || remoteHash === localHash) clearSyncConflict();
	      setSyncStatus('synced', 'Datos locales y nube coinciden.', { revision: remoteRevision });
	      return false;
	  } catch (error) {
	    if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return false;
	    const transientOffline = ['unavailable', 'deadline-exceeded', 'failed-precondition'].includes(error.code);
	    if (!force && transientOffline && verifiedOfflineTenantCache()) {
	      tenantGuard.allow(context);
	      PULL_COMPLETE = true;
	      setSyncStatus('offline', 'La red no respondió. Usando la última caché verificada de esta cuenta.');
	      return false;
	    }
	    PULL_COMPLETE = false;
	      console.warn('CLICK360 no pudo traer nube:', error.message);
	      setSyncStatus(navigator.onLine ? 'error' : 'offline', error.message || 'No se pudo leer la nube.');
	      return false;
	    }
	  }

  function listenRemoteChanges() {
    if (REMOTE_UNSUBSCRIBE) return;

	    const context = ACTIVE_CONTEXT;
	    const stateDoc = STATE_DOC;
	    const expectedEpoch = AUTH_EPOCH;
	    const user = auth.currentUser;
	    REMOTE_UNSUBSCRIBE = stateDoc.onSnapshot((snap) => {
	      if (!AUTH_APPROVED || !PULL_COMPLETE || !snap.exists || !isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return;

	      const remoteData = snap.data() || {};
	      if (remoteData.schemaVersion !== SCHEMA_VERSION) {
	        tenantGuard.requireLegacy(context, { document: remoteData, path: stateDoc.path });
	        safeStorageSet(legacyMigrationMarkerKey(), '1');
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        showLegacyMigrationGate();
	        return;
	      }
	      if (!remoteMatchesContext(remoteData, context)) {
	        tenantGuard.block();
	        safeStorageSet(tenantCorruptMarkerKey(), '1');
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        quarantineIncident("blocked_listener_identity", { path: stateDoc.path });
	        setSyncStatus("error", "Cambio remoto de otro tenant bloqueado.");
	        showGate('Se detectó un cambio remoto de otra cuenta. La operación fue bloqueada para proteger los datos.');
	        return;
	      }
	      const remotePayload = remoteData.payload;
	      LAST_REMOTE_REVISION = Number(remoteData.revision || remoteData.updatedAtMs || LAST_REMOTE_REVISION || 0);
	      safeStorageSet(tenantStorageKey("REMOTE_REVISION"), String(LAST_REMOTE_REVISION || 0));
	      const remoteHash = snapshotString(remotePayload);
      const localHash = snapshotString(buildBusinessPayload());
      const lastApplied = localStorage.getItem(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"));

	      if (remoteHash && remoteHash !== "{}" && remoteHash !== localHash && remoteHash !== lastApplied && !IS_RESTORING_REMOTE) {
	        if (Date.now() < LOCAL_WRITE_PENDING_UNTIL) {
	          markSyncConflict({ path: stateDoc.path, remoteRevision: LAST_REMOTE_REVISION, localUpdatedAtMs: localPayloadUpdatedAtMs(), source: 'listener' });
	          setSyncStatus('error', 'Se detectaron cambios simultáneos. No se sobrescribió ninguna versión.');
	          return;
	        }
	        applyRemotePayload(remotePayload);
	        safeStorageSet(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"), remoteHash);
	        setSyncStatus("synced", "Cambios remotos aplicados.", { revision: LAST_REMOTE_REVISION });
	        console.log("CLICK360 recibió cambios remotos.");

        if (window.click360ReloadState) window.click360ReloadState();

        const hasOpenModal = !!document.querySelector('#modalRoot .modalOverlay.show');
        const hasActiveInput = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

        if (!hasOpenModal && !hasActiveInput) {
          if (window.click360Route) {
            const currentRoute = window.location.hash.replace('#','') || 'home';
            window.click360Route(currentRoute);
          } else {
             location.reload();
          }
        }
      }
	    }, (err) => {
	      if (!isActiveSyncScope(context, stateDoc, expectedEpoch, user)) return;
	      console.warn("No se pudo escuchar cambios remotos:", err.message);
	      setSyncStatus(navigator.onLine ? "error" : "offline", err.message || "No se pudo escuchar la nube.");
	    });
	  }

  function showGate(message = "Inicia sesión con Google para continuar.") {
    setAppBlocked(true);

    let gate = document.getElementById("click360-auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "click360-auth-gate";
      gate.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.96);color:white;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:24px;box-sizing:border-box;";
      gate.innerHTML = `
        <div style="width:100%;max-width:430px;border:1px solid rgba(255,255,255,.16);border-radius:28px;padding:30px;background:#111;box-shadow:0 30px 80px rgba(0,0,0,.65);">
          <h1 style="margin:0 0 8px;font-size:36px;letter-spacing:.5px;">CLICK 360</h1>
          <p style="opacity:.72;margin:0 0 24px;font-size:17px;line-height:1.35;">Acceso privado con Google.</p>

          <button id="c360-google-login" style="width:100%;padding:17px;border-radius:18px;border:1px solid #444;background:#fff;color:#000;font-weight:900;font-size:17px;margin-bottom:12px;cursor:pointer;display:none;">Entrar con Google</button>
          <button id="c360-change-google" style="width:100%;padding:13px;border-radius:18px;border:1px solid #333;background:#000;color:#f4c431;font-weight:800;font-size:14px;cursor:pointer;display:none;">Cambiar cuenta / Cerrar sesión</button>
          <button id="c360-clear-cache" style="width:100%;padding:10px;border-radius:18px;border:1px dashed #555;background:#000;color:#aaa;font-weight:600;font-size:12px;cursor:pointer;margin-top:12px;display:none;">Actualizar archivos de la app</button>

          <p id="c360-auth-msg" style="margin-top:14px;color:#ffdc6b;font-size:14px;word-break:break-word;line-height:1.45;"></p>
        </div>
      `;
      document.body.appendChild(gate);

      document.getElementById("c360-google-login").onclick = signInGoogle;
      document.getElementById("c360-change-google").onclick = async () => {
        if(window.click360Logout) await window.click360Logout();
        else {
           await auth.signOut();
           location.reload();
        }
      };

      document.getElementById("c360-clear-cache").onclick = async () => {
        const btn = document.getElementById("c360-clear-cache");
        btn.textContent = "Actualizando...";
        btn.disabled = true;
        try {
	          if ('serviceWorker' in navigator) {
	            const registration = await navigator.serviceWorker.getRegistration();
	            if (registration) await registration.unregister();
	          }
	          if ('caches' in window) {
	            const keys = await caches.keys();
	            for (let key of keys) {
	              if (key.startsWith(CLICK360_CACHE_PREFIX)) await caches.delete(key);
	            }
          }
          // Asset caches are disposable; tenant data and sign-in state are not.
          window.location.reload(true);
        } catch (e) {
          alert("Error al limpiar caché: " + e.message);
          btn.textContent = "Actualizar archivos de la app";
          btn.disabled = false;
        }
      };
    }

    const msg = document.getElementById("c360-auth-msg");
    if (msg) msg.innerHTML = message;

    // Show/hide buttons dynamically based on verification vs waiting state
    const loginBtn = document.getElementById("c360-google-login");
    const changeBtn = document.getElementById("c360-change-google");
    const clearBtn = document.getElementById("c360-clear-cache");

    if (message.includes("Inicia sesión") || message.includes("pendiente") || message.includes("bloqueada") || message.includes("aprobaron")) {
      if (loginBtn) loginBtn.style.display = "block";
      if (changeBtn) changeBtn.style.display = "block";
      if (clearBtn) clearBtn.style.display = "block";
      if (message.includes("bloqueada")) {
        if (loginBtn) loginBtn.style.display = "none";
      }
    } else {
      if (loginBtn) loginBtn.style.display = "none";
      if (changeBtn) changeBtn.style.display = "none";
      if (clearBtn) clearBtn.style.display = "none";
    }
  }

  function showPending(user) {
    showGate(`
      Tu cuenta (<b>${escapeHtml(user.email || "sin email")}</b>) está pendiente de aprobación.<br><br>
      UID de usuario: <code style="background: #222; padding: 4px 8px; border-radius: 4px; color: #ff9f43; font-family: monospace; font-size: 13px; display: inline-block; margin: 4px 0; user-select: all;">${escapeHtml(user.uid)}</code><br><br>
      Por favor, dile a tu administrador que apruebe tu acceso usando este UID en Firestore.
    `);

    const loginBtn = document.getElementById("c360-google-login");
    if(loginBtn) {
      loginBtn.textContent = "Ya me aprobaron (Actualizar)";
      loginBtn.onclick = async () => {
         const epoch = AUTH_EPOCH;
         const ok = await isApprovedUser(user, epoch);
         if(ok) await enterApprovedApp(user, epoch);
         else showPending(user);
      };
    }
  }

  function unlockApp() {
    if (!tenantGuard.canUnlock(ACTIVE_CONTEXT) || legacyMigrationRequired()) {
      showLegacyMigrationGate();
      return false;
    }
    AUTH_APPROVED = true;
    setAppBlocked(false);

    const gate = document.getElementById("click360-auth-gate");

    try {
      if(window.click360Route) {
         const currentRoute = window.location.hash.replace('#','') || 'home';
         window.click360Route(currentRoute);
      }
      if (gate) gate.remove();
    } catch(e) {
      console.error("Error durante unlockApp:", e);
      const msg = document.getElementById("c360-auth-msg");
      const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (msg) {
        msg.innerHTML = `<span style="color:#ff4444; font-weight:bold;">Error de Inicio: ${esc(e.message)}</span><br><br><pre style="text-align:left; background:#111; padding:8px; border-radius:8px; font-size:11px; overflow-x:auto; max-height:200px; color:#ff8888; font-family:monospace; margin:0;">${esc(e.stack || '')}</pre>`;
      } else {
        alert("Error de Inicio: " + e.message);
      }
    }
  }

  function providerGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  function signInGoogle() {
    const msg = document.getElementById("c360-auth-msg");
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isIOS && isStandalone) {
      if (msg) {
        msg.innerHTML = `<div style="text-align:left; padding:12px; background:rgba(214,170,44,0.1); border:1px solid var(--gold); border-radius:16px; font-size:13px; line-height:1.4; color:var(--text);">
          <b>Nota para iPhone (PWA):</b><br>
          Debido a restricciones de seguridad de iOS en apps de pantalla de inicio, por favor:<br><br>
          1. Abre el navegador <b>Safari</b> normal.<br>
          2. Ve a <b>roddysmith23-stack.github.io/CLICK-360</b> e inicia sesión con tu cuenta.<br>
          3. Una vez iniciada sesión en Safari, vuelve a abrir esta app desde tu pantalla de inicio.
        </div>`;
      }
      return;
    }

    if (msg) msg.textContent = "Abriendo Google...";

    auth.signInWithPopup(providerGoogle()).catch(err => {
      console.warn("Popup falló:", err.message);
      if (err.code === 'auth/popup-blocked') {
        if (msg) msg.innerHTML = "Tu navegador bloqueó la ventana de Google.<br>Por favor, <b>permite las ventanas emergentes</b> o intenta desde Chrome/Safari normal.";
      } else if (err.code === 'auth/operation-not-supported-in-this-environment') {
        if (msg) msg.textContent = "Redireccionando a Google...";
        auth.signInWithRedirect(providerGoogle());
      } else if (err.code !== 'auth/popup-closed-by-user') {
        if (msg) msg.innerHTML = "Error al iniciar sesión con Google. Intenta abrir la app directamente desde Safari o Chrome.<br><br>Error: " + escapeHtml(err.message);
      }
    });
  }

  function debounce(fn, wait = 1000) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  const debouncedSync = debounce(() => pushLocalToFirestore("local_change"), 1200);

	  window.addEventListener('click360-local-state-saved', (event) => {
	    if (!IS_RESTORING_REMOTE && AUTH_APPROVED && PULL_COMPLETE
	      && event.detail?.tenantKey === ACTIVE_CONTEXT?.tenantKey) {
	      LOCAL_WRITE_PENDING_UNTIL = Date.now() + 6000;
	      setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? "Cambio local pendiente de nube." : "Cambio local guardado sin internet.");
	      debouncedSync();
	    }
	  });

  // Sync when user returns to the app (tab/app switch)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && AUTH_APPROVED && PULL_COMPLETE && STATE_DOC) {
      pullRemoteOnce({ force: false, reload: true }).catch(() => {});
    } else if (document.visibilityState === "hidden" && AUTH_APPROVED && PULL_COMPLETE) {
      pushLocalToFirestore("visibility_hidden").catch(() => {});
    }
  });

	  window.click360SyncNow = () => pushLocalToFirestore("manual");
	  window.click360RefreshNow = () => pullRemoteOnce({ force: true, reload: true });
	  window.click360DebugSyncIdentity = () => ({
	    uid: auth.currentUser?.uid || null,
	    email: auth.currentUser?.email || null,
	    role: window.click360User?.role || null,
	    ownerId: window.click360User?.ownerId || null,
	    businessId: BUSINESS_ID,
	    tenantKey: ACTIVE_CONTEXT?.tenantKey || null,
	    stateDocPath: STATE_DOC?.path || null,
	    deviceId: DEVICE_ID,
	    revision: LAST_REMOTE_REVISION,
	    status: { ...syncStatus },
	    localUpdatedAtMs: localPayloadUpdatedAtMs()
	  });
	  function deactivateActiveAccount() {
	    AUTH_EPOCH += 1;
	    AUTH_APPROVED = false;
	    PULL_COMPLETE = false;
	    IS_RESTORING_REMOTE = false;
	    INITIAL_TENANT_SEED_REQUIRED = false;
	    LOCAL_WRITE_PENDING_UNTIL = 0;
	    if (REMOTE_UNSUBSCRIBE) { REMOTE_UNSUBSCRIBE(); REMOTE_UNSUBSCRIBE = null; }
	    if (USER_STATUS_UNSUBSCRIBE) { USER_STATUS_UNSUBSCRIBE(); USER_STATUS_UNSUBSCRIBE = null; }
	    BUSINESS_ID = null;
	    STATE_DOC = null;
	    ACTIVE_CONTEXT = null;
	    LAST_REMOTE_REVISION = 0;
	    SYNC_CONFLICT_PENDING = false;
	    tenantGuard.reset();
	    window.click360User = null;
	    if (typeof window.click360ClearTenantContext === "function") window.click360ClearTenantContext();
	  }
	  window.click360Logout = async () => {
    deactivateActiveAccount();
    try { await auth.signOut(); } catch(e) { console.warn("No se pudo cerrar sesión:", e.message); }
    showGate("Inicia sesión con Google para continuar.");
  };

  function listenUserApproval(user, expectedEpoch = AUTH_EPOCH) {
    if (USER_STATUS_UNSUBSCRIBE) return;
    const context = ACTIVE_CONTEXT;
	  USER_STATUS_UNSUBSCRIBE = db.collection("approvedUsers").doc(user.uid).onSnapshot((snap) => {
	    if (!AUTH_APPROVED || !isCurrentAuthEpoch(user, expectedEpoch) || ACTIVE_CONTEXT !== context) return;
	    const data = snap.exists ? snap.data() : null;
	    const stillApproved = isExplicitlyActive(data);
	    const ownerId = data?.ownerId || user.uid;
	    const identityChanged = ownerId !== context.ownerId
	      || (data?.businessId && data.businessId !== ownerId)
	      || (data?.role || 'owner') !== window.click360User?.role;
	    if (!stillApproved || identityChanged) {
	      AUTH_APPROVED = false;
	      PULL_COMPLETE = false;
        if (REMOTE_UNSUBSCRIBE) {
          REMOTE_UNSUBSCRIBE();
          REMOTE_UNSUBSCRIBE = null;
        }
	        showGate(`
	          ${identityChanged ? 'La configuración de tu acceso cambió y debe verificarse de nuevo.' : 'Tu acceso a CLICK 360 fue revocado o bloqueado.'}<br><br>
	          UID de usuario: <code style="background:#222;padding:4px 8px;border-radius:4px;color:#ff9f43;font-family:monospace;font-size:13px;display:inline-block;margin:4px 0;user-select:all;">${escapeHtml(user.uid)}</code>
	        `);
	      return;
	    }
	    const previousProfile = `${window.click360User.name || ''}\n${window.click360User.photoURL || ''}`;
	    window.click360User.name = data.name || user.displayName || window.click360User.name;
	    window.click360User.photoURL = data.photoURL || user.photoURL || '';
	    protectCurrentProfile(user, data);
	    cacheApprovedIdentity(user, window.click360User);
	    const nextProfile = `${window.click360User.name || ''}\n${window.click360User.photoURL || ''}`;
	    const editing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
	    if (previousProfile !== nextProfile && !editing && !document.querySelector('#modalRoot .modalOverlay.show')) {
	      window.click360Route?.(window.location.hash.replace('#', '') || 'home');
	    }
	  }, (err) => console.warn("No se pudo escuchar estado de usuario:", err.message));
  }

  async function enterApprovedApp(user, expectedEpoch = AUTH_EPOCH) {
	    if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	    quarantineLegacyLocalState();
    await pullRemoteOnce({ force: false, reload: false });
	    if (!isCurrentAuthEpoch(user, expectedEpoch) || !activeIdentityIsValid(user)) return false;
	    if (legacyMigrationRequired()) {
	      showLegacyMigrationGate();
	      return false;
	    }
	    if (!tenantGuard.canUnlock(ACTIVE_CONTEXT)) {
	      showGate('No se pudo verificar de forma segura la identidad y los datos de esta cuenta. La operación permanece bloqueada para proteger la información.');
	      return false;
	    }
	    if (INITIAL_TENANT_SEED_REQUIRED) {
	      if (window.click360PersistTenantState?.() !== true) {
	        tenantGuard.block();
	        PULL_COMPLETE = false;
	        showGate('No se pudo guardar la copia local inicial. La cuenta permanece bloqueada para proteger la información.');
	        return false;
	      }
	      AUTH_APPROVED = true;
	      const seeded = await pushLocalToFirestore('initial_tenant_seed');
	      if (!seeded && navigator.onLine) {
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        tenantGuard.block();
	        showGate('No se pudo crear y verificar el documento inicial en Firestore. La cuenta permanece bloqueada.');
	        return false;
	      }
	      INITIAL_TENANT_SEED_REQUIRED = false;
	    }
	  const userRole = (window.click360User && window.click360User.role) || 'owner';
	  const userName = (window.click360User && (window.click360User.name || window.click360User.email)) || 'Usuario';
	  const newSession = { username: userName, role: userRole };
	  if(window.click360SetSession) window.click360SetSession(newSession);
	  unlockApp();
	    window.click360FlushPendingProfile?.().catch(() => {});
    listenRemoteChanges();
    listenUserApproval(user, expectedEpoch);
    return true;
  }

  let HAS_BOOTED = false;

  async function boot() {
    if(HAS_BOOTED) return;
    HAS_BOOTED = true;

    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) {
      console.warn("Persistencia local no disponible:", e.message);
    }

    showGate("Verificando acceso Google...");


    auth.onAuthStateChanged(async user => {
	      const epoch = AUTH_EPOCH + 1;
	      deactivateActiveAccount();
      if (!user) {
        showGate("Inicia sesión con Google para continuar.");
        return;
      }

	      showGate("Verificando aprobación en CLICK360...");
	      setSyncStatus(navigator.onLine ? "checking" : "offline", navigator.onLine ? "Verificando aprobación." : "Sin internet. Buscando aprobación guardada.");
	      const approved = await isApprovedUser(user, epoch);
	      if (epoch !== AUTH_EPOCH || auth.currentUser?.uid !== user.uid) return;

	      if (!approved) {
	        if (window.click360User && ["blocked", "revoked"].includes(window.click360User.status)) {
	          showGate(`
	            Tu cuenta (<b>${escapeHtml(user.email || "sin email")}</b>) ha sido bloqueada o revocada.<br><br>
	            Por favor, ponte en contacto con el administrador o soporte.
	          `);
	          const loginBtn = document.getElementById("c360-google-login");
	          if (loginBtn) loginBtn.style.display = "none";
	        } else if (window.click360User && window.click360User.status === "tenant_configuration_invalid") {
	          showGate("La configuración de esta cuenta no coincide con el tenant seguro. La operación fue bloqueada para proteger los datos; requiere corrección administrativa.");
	          const loginBtn = document.getElementById("c360-google-login");
	          if (loginBtn) loginBtn.style.display = "none";
        } else if (window.click360User && window.click360User.role === "worker") {
          showGate(`
	            Tu solicitud de acceso como trabajador (<b>${escapeHtml(user.email || "sin email")}</b>) está <b>pendiente de aprobación</b> por el dueño del negocio.<br><br>
	            UID de usuario: <code style="background: #222; padding: 4px 8px; border-radius: 4px; color: #ff9f43; font-family: monospace; font-size: 13px; display: inline-block; margin: 4px 0; user-select: all;">${escapeHtml(user.uid)}</code><br><br>
            Por favor, pídele al administrador que apruebe tu acceso desde la sección "Trabajadores" en su sistema usando tu UID.
          `);
          const loginBtn = document.getElementById("c360-google-login");
          if (loginBtn) {
            loginBtn.textContent = "Ya me aprobaron (Actualizar)";
            loginBtn.onclick = async () => {
              showGate("Verificando aprobación en CLICK 360...");
	              const activeEpoch = AUTH_EPOCH;
	              const ok = await isApprovedUser(user, activeEpoch);
	              if (ok) await enterApprovedApp(user, activeEpoch);
              else showPending(user);
            };
          }
        } else {
          showPending(user);
        }
        return;
      }

      await enterApprovedApp(user, epoch);
    });
  }

  boot();
})();
