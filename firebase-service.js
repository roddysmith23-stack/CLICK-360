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
  const CURRENT_CACHE_KEY = 'click360-p0-legacy-migration-v11';
  try {
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(key => {
          if (key !== CURRENT_CACHE_KEY) {
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

	  const rawSetItem = localStorage.setItem.bind(localStorage);
	  const PROFILE_CACHE_PREFIX = "CLICK360_USER_PROFILE_";
	  const LEGACY_STATE_LS_KEY = 'click360_mvp_qa_final_state_v1';
	  const STATE_LS_PREFIX = 'CLICK360_STATE:';
	  const SESSION_LS_PREFIX = 'CLICK360_SESSION:';
	  const DEVICE_ID_KEY = "CLICK360_DEVICE_ID";
	  const APPROVED_IDENTITY_PREFIX = "CLICK360_APPROVED_IDENTITY:";
	  const SCHEMA_VERSION = 10;
	  function tenantKeyFor(ownerId, businessId) {
	    return `owner:${ownerId}:business:${businessId}`;
	  }
	  function tenantStorageKey(suffix) {
	    return ACTIVE_CONTEXT ? `CLICK360_TENANT:${ACTIVE_CONTEXT.tenantKey}:${suffix}` : '';
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
	  function activeStateStorageKey() {
	    return ACTIVE_CONTEXT ? `${STATE_LS_PREFIX}${ACTIVE_CONTEXT.tenantKey}` : '';
	  }
	  function activeSessionStorageKey() {
	    return ACTIVE_CONTEXT ? `${SESSION_LS_PREFIX}${ACTIVE_CONTEXT.authUid}` : '';
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
	    return !!identity && !!ACTIVE_CONTEXT
	      && identity.ownerId === ACTIVE_CONTEXT.ownerId
	      && identity.businessId === ACTIVE_CONTEXT.businessId
	      && (!identity.ownerUid || identity.ownerUid === ACTIVE_CONTEXT.ownerUid)
	      && (!identity.tenantKey || identity.tenantKey === ACTIVE_CONTEXT.tenantKey);
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
	      id = "device_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
	      rawSetItem(DEVICE_ID_KEY, id);
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

  // Early capture of invite parameters
  const initUrlParams = new URLSearchParams(location.search);
	  if (initUrlParams.get("invite") === "true" && initUrlParams.get("ownerId")) {
	    rawSetItem("CLICK360_PENDING_INVITE_OWNER", initUrlParams.get("ownerId"));
	    if (initUrlParams.get("token")) rawSetItem("CLICK360_PENDING_INVITE_TOKEN", initUrlParams.get("token"));
	  }

  if (initUrlParams.get("resetC360") === "1") {
    // P0: never erase tenant data from a URL parameter. The old reset flag now
    // only removes itself from the address bar.
    history.replaceState({}, "", location.pathname + "?v=p0-legacy-migration-v11");
  }

  function removeOverlayAndControls() {
    ["click360-auth-gate", "click360-cloud-controls"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
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

  async function syncLocalToRemoteManual() {
    await pushLocalToFirestore("manual_sync");
    alert("Sincronización forzada completada");
  }

  async function reloadFromRemoteManual() {
    if(confirm("¿Estás seguro? Esto reemplazará los datos locales con la nube.")){
      await pullRemoteOnce({ force: true, reload: true });
    }
  }

  function renderCloudControls() {
    if (document.getElementById("click360-cloud-controls")) return;
    const div = document.createElement("div");
    div.id = "click360-cloud-controls";
    div.style.position = "fixed";
    div.style.bottom = "10px";
    div.style.left = "10px";
    div.style.zIndex = "999999";
    div.style.background = "rgba(0,0,0,0.8)";
    div.style.padding = "10px";
    div.style.borderRadius = "8px";
    div.style.border = "1px solid #444";
    div.style.display = "flex";
    div.style.gap = "8px";

    const btnPush = document.createElement("button");
    btnPush.textContent = "Forzar Subida";
    btnPush.style.padding = "4px 8px";
    btnPush.style.cursor = "pointer";
    btnPush.onclick = syncLocalToRemoteManual;

    const btnPull = document.createElement("button");
    btnPull.textContent = "Forzar Bajada";
    btnPull.style.padding = "4px 8px";
    btnPull.style.cursor = "pointer";
    btnPull.onclick = reloadFromRemoteManual;

    div.appendChild(btnPush);
    div.appendChild(btnPull);
    document.body.appendChild(div);
  }

  function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  function safeJsonParse(value) {
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  function getCachedProfile(uid) {
    if (!uid) return null;
    return safeJsonParse(localStorage.getItem(PROFILE_CACHE_PREFIX + uid));
  }

	  function protectCurrentProfile(user) {
	    const cached = getCachedProfile(user?.uid);
	    if (!cached || !window.click360User) return;
	    if (cached.name) window.click360User.name = cached.name;
	    if (cached.photoURL) window.click360User.photoURL = cached.photoURL;
	  }
	  function cacheApprovedIdentity(user, data) {
	    if (!user || !data || data.status === "blocked") return;
	    const safe = {
	      uid: user.uid,
	      email: user.email || data.email || "",
	      role: data.role || "owner",
	      name: data.name || user.displayName || "",
	      photoURL: data.photoURL || user.photoURL || "",
	      status: data.status || "active",
	      approved: data.approved === true,
	      ownerId: data.ownerId || user.uid,
	      isOwner: data.isOwner === true || (data.role || "owner") === "owner",
	      businessLimit: Number(data.businessLimit || 2),
	      cachedAtMs: Date.now()
	    };
	    try { rawSetItem(approvedIdentityStorageKey(user.uid), JSON.stringify(safe)); } catch {}
	  }
	  function getCachedApprovedIdentity(user) {
	    if (!user) return null;
	    const cached = safeJsonParse(localStorage.getItem(approvedIdentityStorageKey(user.uid)));
	    if (!cached || cached.uid !== user.uid || cached.status === "blocked") return null;
	    if (cached.email && user.email && cached.email.toLowerCase() !== user.email.toLowerCase()) return null;
	    return cached;
	  }
	  function applyApprovedIdentity(user, data, source = "remote") {
	    const ownerId = data.ownerId || user.uid;
	    // Existing production documents are stored at the owner's root business id.
	    // A dedicated businessId is used only when it was explicitly assigned.
	    const businessId = data.businessId || ownerId;
	    window.click360User = {
	      uid: user.uid,
	      email: user.email || data.email,
	      role: data.role || "owner",
	      name: data.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario"),
	      photoURL: data.photoURL || user.photoURL || '',
	      status: data.status || "active",
	      approved: data.approved === true,
	      businessLimit: Number(data.businessLimit || 2),
	      ownerId,
	      isOwner: data.isOwner === true || (data.role || "owner") === "owner",
	      temporaryOwner: data.temporaryOwner === true,
	      source
	    };
	    protectCurrentProfile(user);
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
	    if (typeof window.click360SetTenantContext !== "function") {
	      throw new Error("La interfaz segura todavía no está lista.");
	    }
	    window.click360SetTenantContext(ACTIVE_CONTEXT);
	    cacheApprovedIdentity(user, window.click360User);
	  }

	  function snapshotString(obj) {
	    try { return JSON.stringify(obj || {}); } catch (e) { return "{}"; }
	  }

	  function buildBusinessPayload() {
	    if (!activeIdentityIsValid() || typeof window.click360GetTenantState !== "function") return null;
	    const state = window.click360GetTenantState();
	    if (!state || !sameTenant(state.identity)) return null;
	    const settings = state.settings || {};
	    return {
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
	  }

	  function localPayloadUpdatedAtMs() {
	    return Number(buildBusinessPayload()?.data?.updatedAtMs || 0);
	  }

	  function quarantineIncident(kind, details = {}) {
	    const key = `CLICK360_QUARANTINE:${DEVICE_ID}:${Date.now()}:${kind}`;
	    try {
	      rawSetItem(key, JSON.stringify({ kind, createdAt: new Date().toISOString(), context: ACTIVE_CONTEXT, ...details }));
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
	      legacyState: raw
	    });
	    rawSetItem(marker, "1");
	  }

	  function remoteMatchesActiveTenant(remote) {
	    return !!remote && remote.schemaVersion === SCHEMA_VERSION
	      && remote.ownerId === ACTIVE_CONTEXT?.ownerId
	      && remote.businessId === ACTIVE_CONTEXT?.businessId
	      && remote.ownerUid === ACTIVE_CONTEXT?.ownerUid
	      && sameTenant(remote.payload?.identity);
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

	  function domainCounts(state) {
	    const settings = state?.settings || {};
	    return {
	      businesses: Array.isArray(state?.businesses) ? state.businesses.length : 0,
	      products: Array.isArray(state?.products) ? state.products.length : 0,
	      sales: Array.isArray(state?.sales) ? state.sales.length : 0,
	      movements: Array.isArray(state?.movements) ? state.movements.length : 0,
	      invoices: Array.isArray(state?.invoices) ? state.invoices.length : 0,
	      dailyReports: Array.isArray(state?.dailyReports) ? state.dailyReports.length : 0,
	      workers: Array.isArray(settings.workers) ? settings.workers.length : 0,
	      labelTemplates: Array.isArray(settings.labelTemplates) ? settings.labelTemplates.length : 0
	    };
	  }

	  function equalCounts(before, after) {
	    return Object.keys(before).every(key => before[key] === after[key]);
	  }

	  function buildV10StateDocument(payload, reason, extra = {}) {
	    const user = auth.currentUser;
	    return {
	      schemaVersion: SCHEMA_VERSION,
	      ownerUid: ACTIVE_CONTEXT.ownerUid,
	      ownerId: ACTIVE_CONTEXT.ownerId,
	      businessId: ACTIVE_CONTEXT.businessId,
	      tenantKey: ACTIVE_CONTEXT.tenantKey,
	      revision: Date.now(),
	      baseRevision: LAST_REMOTE_REVISION || 0,
	      deviceId: DEVICE_ID,
	      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
	      updatedAtMs: Date.now(),
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

	  function isUnequivocalLegacyMigration(legacyDoc, legacyState) {
	    const user = auth.currentUser;
	    const isOwner = window.click360User?.isOwner === true || window.click360User?.role === 'owner';
	    const explicitOwnerMatches = !legacyDoc.ownerId || legacyDoc.ownerId === ACTIVE_CONTEXT.ownerId;
	    const pathMatches = legacyDoc.businessId === ACTIVE_CONTEXT.businessId;
	    const writerMatches = legacyDoc.updatedBy === user?.uid;
	    const ownerMatchesAuth = isOwner && user?.uid === ACTIVE_CONTEXT.ownerId;
	    const contentIsBusinessState = Array.isArray(legacyState.businesses)
	      && Array.isArray(legacyState.products)
	      && Array.isArray(legacyState.sales)
	      && Array.isArray(legacyState.movements);
	    return explicitOwnerMatches && pathMatches && writerMatches && ownerMatchesAuth && contentIsBusinessState;
	  }

	  window.click360MigrateLegacyRemote = async function(confirmation) {
	    if (confirmation !== 'MIGRATE_LEGACY_V9_TO_V10') throw new Error('Confirmación de migración inválida.');
	    if (!legacyMigrationRequired() || !activeIdentityIsValid()) throw new Error('No hay una migración legacy pendiente para este tenant.');
	    if (!tenantGuard.startMigration(ACTIVE_CONTEXT)) throw new Error('No se pudo iniciar la migración segura.');

	    const legacyDoc = tenantGuard.snapshot().legacy?.document;
	    const legacyRawState = legacyDoc?.localStorage?.[LEGACY_STATE_LS_KEY];
	    const legacyState = safeJsonParse(legacyRawState);
	    if (!legacyDoc || !legacyState || !isUnequivocalLegacyMigration(legacyDoc, legacyState)) {
	      tenantGuard.requireLegacy(ACTIVE_CONTEXT, tenantGuard.snapshot().legacy);
	      throw new Error('La identidad o el contenido legacy no son inequívocos. Migración bloqueada.');
	    }

	    const beforeCounts = domainCounts(legacyState);
	    const migratedState = { ...legacyState, identity: activeIdentity(), schemaVersion: SCHEMA_VERSION };
	    IS_RESTORING_REMOTE = true;
	    try {
	      window.click360ApplyTenantState(migratedState, ACTIVE_CONTEXT);
	    } finally {
	      IS_RESTORING_REMOTE = false;
	    }

	    const payload = buildBusinessPayload();
	    const afterCounts = domainCounts(payload?.data);
	    if (!payload || !equalCounts(beforeCounts, afterCounts)) {
	      tenantGuard.requireLegacy(ACTIVE_CONTEXT, tenantGuard.snapshot().legacy);
	      throw new Error('Los conteos antes y después no coinciden. Migración bloqueada.');
	    }

	    const backupRef = db.collection('businesses').doc(BUSINESS_ID).collection('legacyBackups').doc(`v9-${Date.now()}`);
	    const migrationDoc = buildV10StateDocument(payload, 'verified_legacy_v9_to_v10_migration', {
	      migration: { fromSchemaVersion: legacyDoc.schemaVersion || 9, beforeCounts, afterCounts, migratedAtMs: Date.now() }
	    });

	    try {
	      await db.runTransaction(async transaction => {
	        const current = await transaction.get(STATE_DOC);
	        if (!current.exists || snapshotString(current.data()) !== snapshotString(legacyDoc)) {
	          throw new Error('El documento legacy cambió durante la migración. No se sobrescribió.');
	        }
	        transaction.set(backupRef, {
	          schemaVersion: SCHEMA_VERSION,
	          source: 'legacy_v9_before_migration',
	          ownerId: ACTIVE_CONTEXT.ownerId,
	          businessId: ACTIVE_CONTEXT.businessId,
	          backedUpBy: auth.currentUser.uid,
	          backedUpAt: firebase.firestore.FieldValue.serverTimestamp(),
	          originalDocument: legacyDoc,
	          beforeCounts
	        });
	        transaction.set(STATE_DOC, migrationDoc);
	      });
	    } catch (error) {
	      tenantGuard.requireLegacy(ACTIVE_CONTEXT, { document: legacyDoc, path: STATE_DOC.path });
	      PULL_COMPLETE = false;
	      setSyncStatus('migration_required', legacyMigrationMessage());
	      throw error;
	    }

	    LAST_REMOTE_REVISION = Number(migrationDoc.revision || Date.now());
	    rawSetItem(tenantStorageKey('REMOTE_REVISION'), String(LAST_REMOTE_REVISION));
	    rawSetItem(tenantStorageKey('LAST_APPLIED_REMOTE_HASH'), snapshotString(payload));
	    tenantGuard.allow(ACTIVE_CONTEXT);
	    localStorage.removeItem(legacyMigrationMarkerKey());
	    localStorage.removeItem(tenantCorruptMarkerKey());
	    PULL_COMPLETE = true;
	    setSyncStatus('synced', 'Migración verificada completada. Datos protegidos y sincronización habilitada.', { revision: LAST_REMOTE_REVISION });
	    unlockApp();
	    listenRemoteChanges();
	    listenUserApproval(auth.currentUser);
	    return { beforeCounts, afterCounts, backupPath: backupRef.path };
	  };

  async function isApprovedUser(user) {
    if (!user) return false;

    // Temporal owners fallback list (case insensitive)
    const tempOwners = [
      'roddysmith23@hotmail.com',
      'sanyagullo1997@gmail.com',
      'shary10mmv@gmail.com',
      'shary10mmvv@gmail.com',
      'debbyaf32@gmail.com',
      'debbya632@gmail.com',
      'cheyos@hotmail.es'
    ];
    const isTempOwner = user.email && tempOwners.includes(user.email.toLowerCase());

    console.log("[CLICK360 AUTH LOG] UID Autenticado:", user.uid);
    console.log("[CLICK360 AUTH LOG] Email Autenticado:", user.email);
    console.log("[CLICK360 AUTH LOG] Ruta Firestore consultada: approvedUsers/" + user.uid);

    try {
      let doc = await db.collection("approvedUsers").doc(user.uid).get();
      let d = null;

      if (doc.exists) {
        d = doc.data();
        console.log("[CLICK360 AUTH LOG] Documento encontrado en Firestore:", JSON.stringify(d));
      } else {
        console.log("[CLICK360 AUTH LOG] Documento no encontrado en Firestore para el UID:", user.uid);
      }

      // 1. If status is blocked -> BLOQUEAR
      if (d && d.status === "blocked") {
        console.log("[CLICK360 AUTH LOG] Acceso BLOQUEADO. Razón: El documento tiene status === 'blocked'.");
        window.click360User = {
          uid: user.uid,
          email: user.email || d.email,
          role: d.role || "worker",
          name: d.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario"),
          photoURL: d.photoURL || user.photoURL || '',
          status: "blocked",
          businessLimit: Number(d.businessLimit || 2),
          ownerId: d.ownerId || user.uid,
          isOwner: d.isOwner === true || d.role === "owner"
        };
        return false;
      }

      if (!d && user.email) {
        const emailKey = user.email.toLowerCase();
        const emailDoc = await db.collection("approvedUsersByEmail").doc(emailKey).get().catch(() => null);
        if (emailDoc && emailDoc.exists) {
          const emailData = emailDoc.data() || {};
          if (emailData.status === "active" || emailData.approved === true) {
            console.log("[CLICK360 AUTH LOG] Preaprobación por email encontrada. Creando approvedUsers/" + user.uid);
            d = {
              uid: user.uid,
              email: user.email,
              role: emailData.role || "worker",
              ownerId: emailData.ownerId || user.uid,
              name: emailData.name || user.displayName || (user.email ? user.email.split('@')[0] : "Trabajador"),
              status: "active",
              approved: true,
              businessLimit: Number(emailData.businessLimit || 2),
              photoURL: user.photoURL || '',
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              approvedFromEmail: true
            };
	            await db.collection("approvedUsers").doc(user.uid).set(d, { merge: true });
	            localStorage.removeItem("CLICK360_PENDING_INVITE_OWNER");
	            localStorage.removeItem("CLICK360_PENDING_INVITE_TOKEN");
	          }
        }
      }

	      // 2. If status is active OR approved is true -> ENTRAR
	      if (d && (d.status === "active" || d.approved === true)) {
	        console.log("[CLICK360 AUTH LOG] Acceso PERMITIDO. Razón: El documento tiene status === 'active' o approved === true.");
	        applyApprovedIdentity(user, d, "approvedUsers");
	        return true;
	      }

      // 3. If email is in tempOwners list -> ENTRAR as owner (fallback)
      if (isTempOwner) {
        console.log("[CLICK360 AUTH LOG] Acceso PERMITIDO. Razón: El email está en la lista temporal de propietarios.");
        window.click360User = {
          uid: user.uid,
          email: user.email,
          role: "owner",
          name: user.displayName || (user.email ? user.email.split('@')[0] : "Propietario"),
          photoURL: user.photoURL || '',
          status: "active",
          approved: true,
          businessLimit: 2,
          ownerId: user.uid,
          isOwner: true,
          temporaryOwner: true
        };
	        applyApprovedIdentity(user, window.click360User, "temporary_owner");
	        db.collection("approvedUsers").doc(user.uid).set({
          uid: user.uid,
          email: user.email,
          role: "owner",
          name: window.click360User.name,
          photoURL: window.click360User.photoURL || '',
          status: "active",
          approved: true,
          businessLimit: 2,
          ownerId: user.uid,
          isOwner: true,
          temporaryOwner: true,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.warn("No se pudo materializar propietario temporal:", err.message));
        return true;
      }

	      // 4. Invite links are only hints. Real approval must come from approvedUsersByEmail.
	      const urlParams = new URLSearchParams(location.search);
	      const cachedOwnerId = localStorage.getItem("CLICK360_PENDING_INVITE_OWNER");
	      const isInvite = urlParams.get("invite") === "true" || !!cachedOwnerId;
	      const inviteOwnerId = urlParams.get("ownerId") || cachedOwnerId;

	      if (!d && isInvite && inviteOwnerId) {
	        console.log("[CLICK360 AUTH LOG] Invitación detectada, pero falta preaprobación por email.");
	        d = {
	          uid: user.uid,
	          email: user.email,
	          role: "worker",
	          ownerId: inviteOwnerId,
	          name: user.displayName || (user.email ? user.email.split('@')[0] : "Trabajador"),
	          status: "pending",
	          photoURL: user.photoURL || ''
	        };
	      }

      // 5. If status is pending or doesn't exist -> PENDIENTE
      if (d && d.status === "pending") {
        console.log("[CLICK360 AUTH LOG] Acceso BLOQUEADO/PENDIENTE. Razón: El documento tiene status === 'pending'.");
        window.click360User = {
          uid: user.uid,
          email: user.email || d.email,
          role: d.role || "worker",
          name: d.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario"),
          photoURL: d.photoURL || user.photoURL || '',
          status: "pending",
          businessLimit: Number(d.businessLimit || 2),
          ownerId: d.ownerId || user.uid,
          isOwner: d.isOwner === true || d.role === "owner"
        };
        return false;
      }

      console.log("[CLICK360 AUTH LOG] Acceso BLOQUEADO/PENDIENTE. Razón: El documento no existe en Firestore y el email no está en la lista temporal.");
      window.click360User = {
        uid: user.uid,
        email: user.email,
        role: "owner",
        status: "pending",
        businessLimit: 2,
        ownerId: user.uid,
        isOwner: false
      };
      return false;
    } catch(e) {
	      console.error("[CLICK360 AUTH LOG] Error al verificar aprobación:", e);
	      const cached = getCachedApprovedIdentity(user);
	      if (cached && (!navigator.onLine || e.code === "unavailable")) {
	        console.log("[CLICK360 AUTH LOG] Acceso offline permitido con identidad aprobada en caché.");
	        applyApprovedIdentity(user, cached, "offline_cache");
	        setSyncStatus("offline", "Trabajando sin internet con la última aprobación guardada.");
	        return true;
	      }
	      // Even if firestore check fails, check temporal owner fallback!
      if (isTempOwner) {
        console.log("[CLICK360 AUTH LOG] Fallback: Acceso PERMITIDO por lista temporal tras error de Firestore.");
        window.click360User = {
          uid: user.uid,
          email: user.email,
          role: "owner",
          name: user.displayName || (user.email ? user.email.split('@')[0] : "Propietario"),
          photoURL: user.photoURL || '',
          status: "active",
          approved: true,
          businessLimit: 2,
          ownerId: user.uid,
          isOwner: true,
          temporaryOwner: true
	        };
		        applyApprovedIdentity(user, window.click360User, "temporary_owner_offline");
        return true;
      }
      return false;
    }
  }

  // Diagnostic function click360DebugAuth
  window.click360DebugAuth = async function() {
    console.log("=== CLICK 360 DIAGNÓSTICO DE AUTENTICACIÓN ===");
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.log("[DEBUG AUTH] No hay usuario autenticado en Firebase Auth.");
      return;
    }
    console.log("[DEBUG AUTH] currentUser.uid:", currentUser.uid);
    console.log("[DEBUG AUTH] currentUser.email:", currentUser.email);
    const path = "approvedUsers/" + currentUser.uid;
    console.log("[DEBUG AUTH] ruta Firestore consultada:", path);

    try {
      const docSnap = await db.collection("approvedUsers").doc(currentUser.uid).get();
      const exists = docSnap.exists;
      const data = exists ? docSnap.data() : null;
      console.log("[DEBUG AUTH] data encontrada en Firestore:", data);

      const tempOwners = [
        'roddysmith23@hotmail.com',
        'sanyagullo1997@gmail.com',
        'shary10mmv@gmail.com',
        'shary10mmvv@gmail.com',
        'debbyaf32@gmail.com',
        'debbya632@gmail.com',
        'cheyos@hotmail.es'
      ];
      const isTempOwner = currentUser.email && tempOwners.includes(currentUser.email.toLowerCase());

      let decision = "PENDIENTE/BLOQUEADO";
      if (data && data.status === "blocked") {
        decision = "BLOQUEADO (status es blocked)";
      } else if (data && (data.status === "active" || data.approved === true)) {
        decision = "PERMITIDO (por data de Firestore)";
      } else if (isTempOwner) {
        decision = "PERMITIDO (por lista temporal de email)";
      } else if (data && data.status === "pending") {
        decision = "PENDIENTE (status es pending)";
      } else {
        decision = "PENDIENTE (no existe documento y email no en lista temporal)";
      }
      console.log("[DEBUG AUTH] decisión final de acceso:", decision);
    } catch (err) {
      console.error("[DEBUG AUTH] Error al consultar Firestore:", err);
    }
  };
  window.click360InviteWorker = async function(email) {
    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
  };

	  window.click360InviteWorkerEmail = async function(email, name) {
	    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
	    const uid = window.click360User.uid;
	    const normalizedEmail = String(email || "").trim().toLowerCase();
	    const inviteToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
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
	    }, { merge: true }).catch(()=>{});
	  };

	  window.click360RemoveWorkerUid = async function(workerUid) {
	    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
	    await db.collection("approvedUsers").doc(workerUid).set({
	      status: "blocked",
	      approved: false,
	      revokedAt: firebase.firestore.FieldValue.serverTimestamp(),
	      revokedBy: window.click360User.uid
	    }, { merge: true }).catch(()=>{});
	  };

	  async function pushLocalToFirestore(reason = "auto") {
	    try {
	      const user = auth.currentUser;
	      if (legacyMigrationRequired()) {
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        return false;
	      }
	      if (!user || !AUTH_APPROVED || IS_RESTORING_REMOTE || !PULL_COMPLETE || !activeIdentityIsValid(user) || !tenantGuard.canWrite(ACTIVE_CONTEXT)) return false;
	      if (!navigator.onLine) {
	        setSyncStatus("offline", "Sin internet. Cambios pendientes de subir.");
	        return false;
	      }

	      const payload = buildBusinessPayload();
	      if (!payload || !sameTenant(payload.identity)) {
	        quarantineIncident("blocked_push_identity", { reason });
	        setSyncStatus("error", "Se bloqueó una escritura porque la identidad del tenant no coincide.");
	        return false;
	      }
	      setSyncStatus("syncing", "Guardando cambios en Firestore.", { reason });

	      const documentData = buildV10StateDocument(payload, reason);
	      const wrote = await window.CLICK360_P0_TENANT_GUARD.guardedWrite(tenantGuard, ACTIVE_CONTEXT, async () => {
	        await STATE_DOC.set(documentData);
	      });
	      if (!wrote) {
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        return false;
	      }

	      const hash = snapshotString(payload);
	      rawSetItem(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"), hash);
	      rawSetItem(tenantStorageKey("REMOTE_REVISION"), String(documentData.revision));
	      LAST_REMOTE_REVISION = documentData.revision;
	      LOCAL_WRITE_PENDING_UNTIL = 0;
	      setSyncStatus("synced", "Datos guardados en la nube.", { reason, revision: documentData.revision });

	      console.log("CLICK360 sincronizado:", reason);
	      return true;
	    } catch (e) {
	      console.warn("CLICK360 no pudo sincronizar:", e.message);
	      setSyncStatus("error", e.message || "No se pudo sincronizar.");
	      return false;
	    }
	  }

	  async function pullRemoteOnce({ force = false, reload = false } = {}) {
	    try {
	      if (!activeIdentityIsValid()) return false;
	      if (!navigator.onLine && !force) {
	        if (!verifiedOfflineTenantCache()) {
	          tenantGuard.block();
	          PULL_COMPLETE = false;
	          setSyncStatus("blocked_identity", "Sin internet y no existe una caché propia, válida y aprobada para esta cuenta.");
	          return false;
	        }
	        tenantGuard.allow(ACTIVE_CONTEXT);
	        PULL_COMPLETE = true;
	        setSyncStatus("offline", "Sin internet. Usando la última caché verificada de esta cuenta.");
	        return false;
	      }
	      setSyncStatus("syncing", "Leyendo datos de Firestore.");
	      const snap = await STATE_DOC.get();
	      if (!snap.exists) {
	        tenantGuard.allow(ACTIVE_CONTEXT);
	        PULL_COMPLETE = true;
	        INITIAL_TENANT_SEED_REQUIRED = true;
	        setSyncStatus("pending", "Tenant nuevo listo. La primera sincronización se hará al desbloquear la cuenta.");
	        return false;
	      }

	      const remoteData = snap.data() || {};
	      if (remoteData.schemaVersion !== SCHEMA_VERSION) {
	        INITIAL_TENANT_SEED_REQUIRED = false;
	        tenantGuard.requireLegacy(ACTIVE_CONTEXT, { document: remoteData, path: STATE_DOC.path });
	        rawSetItem(legacyMigrationMarkerKey(), '1');
	        quarantineIncident("legacy_remote_state", {
	          path: STATE_DOC.path,
	          remoteMetadata: { businessId: remoteData.businessId || null, updatedBy: remoteData.updatedBy || null, updatedByEmail: remoteData.updatedByEmail || null, revision: remoteData.revision || null }
	        });
	        PULL_COMPLETE = false;
	        setSyncStatus("migration_required", legacyMigrationMessage());
	        return false;
	      }
	      if (!remoteMatchesActiveTenant(remoteData)) {
	        INITIAL_TENANT_SEED_REQUIRED = false;
	        tenantGuard.block();
	        rawSetItem(tenantCorruptMarkerKey(), '1');
	        quarantineIncident("blocked_pull_identity", { path: STATE_DOC.path, remoteIdentity: { ownerUid: remoteData.ownerUid, ownerId: remoteData.ownerId, businessId: remoteData.businessId, tenantKey: remoteData.tenantKey } });
	        PULL_COMPLETE = false;
	        setSyncStatus("error", "Se bloqueó una descarga de otro tenant. Tus datos locales siguen intactos.");
	        return false;
	      }
	      const remotePayload = remoteData.payload;
	      INITIAL_TENANT_SEED_REQUIRED = false;
	      localStorage.removeItem(legacyMigrationMarkerKey());
	      localStorage.removeItem(tenantCorruptMarkerKey());
	      LAST_REMOTE_REVISION = Number(remoteData.revision || remoteData.updatedAtMs || LAST_REMOTE_REVISION || 0);
	      rawSetItem(tenantStorageKey("REMOTE_REVISION"), String(LAST_REMOTE_REVISION || 0));
	      const remoteHash = snapshotString(remotePayload);
	      const localPayload = buildBusinessPayload();
	      const localHash = snapshotString(localPayload);
      const alreadyApplied = localStorage.getItem(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"));

	      tenantGuard.allow(ACTIVE_CONTEXT);
	      PULL_COMPLETE = true;
	      if (force || (remoteHash && remoteHash !== localHash && remoteHash !== alreadyApplied)) {
	        const localChanged = Date.now() < LOCAL_WRITE_PENDING_UNTIL || localPayloadUpdatedAtMs() > Number(remoteData.updatedAtMs || 0) + 1500;
	        if (localChanged && !force) {
	          quarantineIncident("same_tenant_conflict", { path: STATE_DOC.path, localPayload, remotePayload, remoteRevision: LAST_REMOTE_REVISION });
	          await pushLocalToFirestore("same_tenant_conflict_preserved");
	          return false;
	        }
	        applyRemotePayload(remotePayload);
	        rawSetItem(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"), remoteHash);
	        setSyncStatus("synced", "Datos actualizados desde la nube.", { revision: LAST_REMOTE_REVISION });
	        if (window.click360ReloadState) window.click360ReloadState();
	        if (reload && window.click360Route) window.click360Route(window.location.hash.replace('#','') || 'home');
	        return true;
	      }
	      setSyncStatus("synced", "Datos locales y nube coinciden.", { revision: LAST_REMOTE_REVISION });
	      return false;
	    } catch (e) {
	      PULL_COMPLETE = true;
	      console.warn("CLICK360 no pudo traer nube:", e.message);
	      setSyncStatus(navigator.onLine ? "error" : "offline", e.message || "No se pudo leer la nube.");
	      return false;
	    }
	  }

  function listenRemoteChanges() {
    if (REMOTE_UNSUBSCRIBE) return;

	    REMOTE_UNSUBSCRIBE = STATE_DOC.onSnapshot((snap) => {
	      if (!AUTH_APPROVED || !PULL_COMPLETE || !snap.exists || !activeIdentityIsValid()) return;

	      const remoteData = snap.data() || {};
	      if (remoteData.schemaVersion !== SCHEMA_VERSION) {
	        tenantGuard.requireLegacy(ACTIVE_CONTEXT, { document: remoteData, path: STATE_DOC.path });
	        rawSetItem(legacyMigrationMarkerKey(), '1');
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        setSyncStatus('migration_required', legacyMigrationMessage());
	        showLegacyMigrationGate();
	        return;
	      }
	      if (!remoteMatchesActiveTenant(remoteData)) {
	        tenantGuard.block();
	        rawSetItem(tenantCorruptMarkerKey(), '1');
	        AUTH_APPROVED = false;
	        PULL_COMPLETE = false;
	        quarantineIncident("blocked_listener_identity", { path: STATE_DOC.path });
	        setSyncStatus("error", "Cambio remoto de otro tenant bloqueado.");
	        showGate('Se detectó un cambio remoto de otra cuenta. La operación fue bloqueada para proteger los datos.');
	        return;
	      }
	      const remotePayload = remoteData.payload;
	      LAST_REMOTE_REVISION = Number(remoteData.revision || remoteData.updatedAtMs || LAST_REMOTE_REVISION || 0);
	      rawSetItem(tenantStorageKey("REMOTE_REVISION"), String(LAST_REMOTE_REVISION || 0));
	      const remoteHash = snapshotString(remotePayload);
      const localHash = snapshotString(buildBusinessPayload());
      const lastApplied = localStorage.getItem(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"));

	      if (remoteHash && remoteHash !== "{}" && remoteHash !== localHash && remoteHash !== lastApplied && !IS_RESTORING_REMOTE) {
	        if (Date.now() < LOCAL_WRITE_PENDING_UNTIL) {
	          quarantineIncident("same_tenant_listener_conflict", { path: STATE_DOC.path, localPayload: buildBusinessPayload(), remotePayload });
	          pushLocalToFirestore("listener_conflict_preserved").catch(() => {});
	          return;
	        }
	        applyRemotePayload(remotePayload);
	        rawSetItem(tenantStorageKey("LAST_APPLIED_REMOTE_HASH"), remoteHash);
	        setSyncStatus("synced", "Cambios remotos aplicados.", { revision: LAST_REMOTE_REVISION });
	        console.log("CLICK360 recibió cambios remotos.");

        if (window.click360ReloadState) window.click360ReloadState();

        const hasOpenModal = !!document.getElementById('modalRoot');
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
            const regs = await navigator.serviceWorker.getRegistrations();
            for (let reg of regs) {
              await reg.unregister();
            }
          }
          if ('caches' in window) {
            const keys = await caches.keys();
            for (let key of keys) {
              await caches.delete(key);
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
      Tu cuenta (<b>${user.email || "sin email"}</b>) está pendiente de aprobación.<br><br>
      UID de usuario: <code style="background: #222; padding: 4px 8px; border-radius: 4px; color: #ff9f43; font-family: monospace; font-size: 13px; display: inline-block; margin: 4px 0; user-select: all;">${user.uid}</code><br><br>
      Por favor, dile a tu administrador que apruebe tu acceso usando este UID en Firestore.
    `);

    const loginBtn = document.getElementById("c360-google-login");
    if(loginBtn) {
      loginBtn.textContent = "Ya me aprobaron (Actualizar)";
      loginBtn.onclick = async () => {
         const ok = await isApprovedUser(user);
         if(ok) await enterApprovedApp(user);
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
    createControls();

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

    // Save invite parameters before Google login redirects/popups
    const urlParams = new URLSearchParams(location.search);
	    if(urlParams.get("invite") === "true" && urlParams.get("ownerId")) {
	       localStorage.setItem("CLICK360_PENDING_INVITE_OWNER", urlParams.get("ownerId"));
	       if (urlParams.get("token")) localStorage.setItem("CLICK360_PENDING_INVITE_TOKEN", urlParams.get("token"));
	    }

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
        if (msg) msg.innerHTML = "Error al iniciar sesión con Google. Intenta abrir la app directamente desde Safari o Chrome.<br><br>Error: " + err.message;
      }
    });
  }

  function createControls() {
    // Los controles ahora se manejan en la pestaña "Más" de app.js nativamente.
  }

  function debounce(fn, wait = 1000) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  const debouncedSync = debounce(() => pushLocalToFirestore("local_change"), 1200);

  localStorage.setItem = function(key, value) {
    rawSetItem(key, value);
    // Only the active tenant's explicit business state can trigger cloud sync.
    if (!IS_RESTORING_REMOTE && AUTH_APPROVED && PULL_COMPLETE && key === activeStateStorageKey()) {
      LOCAL_WRITE_PENDING_UNTIL = Date.now() + 6000;
      setSyncStatus(navigator.onLine ? "pending" : "offline", navigator.onLine ? "Cambio local pendiente de nube." : "Cambio local guardado sin internet.");
      debouncedSync();
    }
  };

  window.addEventListener("beforeunload", () => {
    if (AUTH_APPROVED && PULL_COMPLETE) pushLocalToFirestore("beforeunload");
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
	    tenantGuard.reset();
	    window.click360User = null;
	    if (typeof window.click360ClearTenantContext === "function") window.click360ClearTenantContext();
	  }
	  window.click360Logout = async () => {
    deactivateActiveAccount();
    try { await auth.signOut(); } catch(e) { console.warn("No se pudo cerrar sesión:", e.message); }
    showGate("Inicia sesión con Google para continuar.");
  };

  function listenUserApproval(user) {
    if (USER_STATUS_UNSUBSCRIBE || window.click360User?.temporaryOwner) return;
    USER_STATUS_UNSUBSCRIBE = db.collection("approvedUsers").doc(user.uid).onSnapshot((snap) => {
      if (!AUTH_APPROVED) return;
      const data = snap.exists ? snap.data() : null;
      const stillApproved = data && data.status !== "blocked" && (data.status === "active" || data.approved === true);
      if (!stillApproved) {
        AUTH_APPROVED = false;
        PULL_COMPLETE = false;
        if (REMOTE_UNSUBSCRIBE) {
          REMOTE_UNSUBSCRIBE();
          REMOTE_UNSUBSCRIBE = null;
        }
        showGate(`
          Tu acceso a CLICK 360 fue revocado o bloqueado.<br><br>
          UID de usuario: <code style="background:#222;padding:4px 8px;border-radius:4px;color:#ff9f43;font-family:monospace;font-size:13px;display:inline-block;margin:4px 0;user-select:all;">${user.uid}</code>
        `);
      }
    }, (err) => console.warn("No se pudo escuchar estado de usuario:", err.message));
  }

  async function enterApprovedApp(user) {
	    if (!activeIdentityIsValid(user)) throw new Error("No se pudo confirmar el tenant de la cuenta.");
	    quarantineLegacyLocalState();
    await pullRemoteOnce({ force: false, reload: false });
	    if (legacyMigrationRequired()) {
	      showLegacyMigrationGate();
	      return false;
	    }
	    if (!tenantGuard.canUnlock(ACTIVE_CONTEXT)) {
	      showGate('No se pudo verificar de forma segura la identidad y los datos de esta cuenta. La operación permanece bloqueada para proteger la información.');
	      return false;
	    }
    const userRole = (window.click360User && window.click360User.role) || 'owner';
    const userName = (window.click360User && (window.click360User.name || window.click360User.email)) || 'demo';
    const newSession = { username: userName, role: userRole };
    if(window.click360SetSession) window.click360SetSession(newSession);
    unlockApp();
	    if (INITIAL_TENANT_SEED_REQUIRED) {
	      INITIAL_TENANT_SEED_REQUIRED = false;
	      await pushLocalToFirestore('initial_tenant_seed');
	    }
    listenRemoteChanges();
    listenUserApproval(user);
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
	      const approved = await isApprovedUser(user);
	      if (epoch !== AUTH_EPOCH || auth.currentUser?.uid !== user.uid) return;

      if (!approved) {
        if (window.click360User && window.click360User.status === "blocked") {
          showGate(`
            Tu cuenta (<b>${user.email || "sin email"}</b>) ha sido bloqueada.<br><br>
            Por favor, ponte en contacto con el administrador o soporte.
          `);
          const loginBtn = document.getElementById("c360-google-login");
          if (loginBtn) loginBtn.style.display = "none";
        } else if (window.click360User && window.click360User.role === "worker") {
          showGate(`
            Tu solicitud de acceso como trabajador (<b>${user.email || "sin email"}</b>) está <b>pendiente de aprobación</b> por el dueño del negocio.<br><br>
            UID de usuario: <code style="background: #222; padding: 4px 8px; border-radius: 4px; color: #ff9f43; font-family: monospace; font-size: 13px; display: inline-block; margin: 4px 0; user-select: all;">${user.uid}</code><br><br>
            Por favor, pídele al administrador que apruebe tu acceso desde la sección "Trabajadores" en su sistema usando tu UID.
          `);
          const loginBtn = document.getElementById("c360-google-login");
          if (loginBtn) {
            loginBtn.textContent = "Ya me aprobaron (Actualizar)";
            loginBtn.onclick = async () => {
              showGate("Verificando aprobación en CLICK 360...");
              const ok = await isApprovedUser(user);
              if (ok) await enterApprovedApp(user);
              else showPending(user);
            };
          }
        } else {
          showPending(user);
        }
        return;
      }

      await enterApprovedApp(user);
    });
  }

  boot();
})();
