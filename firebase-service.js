(function () {
  if (!window.firebase || !window.CLICK360_FIREBASE_CONFIG) {
    console.error("CLICK360 Firebase no está cargado.");
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(window.CLICK360_FIREBASE_CONFIG);

  const auth = firebase.auth();
  const db = firebase.firestore();

  window.click360Auth = auth;
  window.click360Db = db;

  let STATE_DOC = null;

  let AUTH_APPROVED = false;
  let PULL_COMPLETE = false;
  let IS_RESTORING_REMOTE = false;
  let REMOTE_UNSUBSCRIBE = null;

  const rawSetItem = localStorage.setItem.bind(localStorage);

  if (new URLSearchParams(location.search).get("resetC360") === "1") {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("CLICK360_")) localStorage.removeItem(k);
    });
    sessionStorage.clear();
    history.replaceState({}, "", location.pathname + "?v=final-mvp");
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

  function safeJsonParse(value) {
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  function normalizeCode(code) {
    if (!code) return "";
    return String(code)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .trim();
  }

  function deepNormalizeProductCodes(obj) {
    if (!obj || typeof obj !== "object") return false;
    let changed = false;

    if (Array.isArray(obj)) {
      obj.forEach(x => { if (deepNormalizeProductCodes(x)) changed = true; });
      return changed;
    }

    if (obj.code && (obj.name || obj.title || obj.price !== undefined || obj.stock !== undefined || obj.quantity !== undefined)) {
      const clean = normalizeCode(obj.code);
      if (clean && obj.code !== clean) {
        obj.originalCode = obj.originalCode || obj.code;
        obj.code = clean;
        obj.normalizedCode = clean;
        changed = true;
      } else if (!obj.normalizedCode || obj.normalizedCode !== clean) {
        obj.normalizedCode = clean;
        changed = true;
      }
    }

    Object.keys(obj).forEach(k => {
      if (deepNormalizeProductCodes(obj[k])) changed = true;
    });

    return changed;
  }

  function normalizeAllLocalProductCodes() {
    let changed = false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.startsWith("firebase:") || key.startsWith("CLICK360_")) continue;

      const parsed = safeJsonParse(localStorage.getItem(key));
      if (parsed && deepNormalizeProductCodes(parsed)) {
        rawSetItem(key, JSON.stringify(parsed));
        changed = true;
      }
    }
    return changed;
  }

  function snapshotString(obj) {
    try { return JSON.stringify(obj || {}); } catch (e) { return "{}"; }
  }

  function getLocalSnapshot() {
    normalizeAllLocalProductCodes();

    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.startsWith("firebase:") || key.startsWith("CLICK360_")) continue;
      data[key] = localStorage.getItem(key);
    }
    return data;
  }

  function applyRemoteStorage(remoteStorage) {
    IS_RESTORING_REMOTE = true;
    const localKeys = [];
    for(let i=0; i<localStorage.length; i++){
      const k = localStorage.key(i);
      if(!k.startsWith("firebase:") && !k.startsWith("CLICK360_")) localKeys.push(k);
    }
    
    localKeys.forEach(k => localStorage.removeItem(k));

    Object.entries(remoteStorage || {}).forEach(([key, value]) => {
      rawSetItem(key, value);
    });

    normalizeAllLocalProductCodes();
    IS_RESTORING_REMOTE = false;
  }

  async function isApprovedUser(user) {
    if (!user) return false;
    try {
      const doc = await db.collection("approvedUsers").doc(user.uid).get();
      if (doc.exists && doc.data().status === "active") {
        const d = doc.data();
        window.click360User = {
          uid: user.uid,
          email: user.email || d.email,
          role: d.role || "worker",
          name: d.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario")
        };
        const bizId = d.ownerId || user.uid; // Si es worker debería tener ownerId, si no usa su propio uid como negocio
        STATE_DOC = db.collection("businesses").doc(bizId).collection("state").doc("main");
        return true;
      }
      return false;
    } catch(e) {
      console.error("Error al verificar aprobación", e);
      return false;
    }
  }

  async function pushLocalToFirestore(reason = "auto") {
    try {
      const user = auth.currentUser;
      if (!user || !AUTH_APPROVED || IS_RESTORING_REMOTE || !PULL_COMPLETE) return;

      const snapshot = getLocalSnapshot();
      if(Object.keys(snapshot).length === 0) return;

      await STATE_DOC.set({
        businessId: BUSINESS_ID,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
        updatedBy: user.uid,
        updatedByEmail: user.email || null,
        reason,
        localStorage: snapshot
      }, { merge: true });

      console.log("CLICK360 sincronizado:", reason);
    } catch (e) {
      console.warn("CLICK360 no pudo sincronizar:", e.message);
    }
  }

  async function pullRemoteOnce({ force = false, reload = false } = {}) {
    try {
      const snap = await STATE_DOC.get();
      if (!snap.exists) {
        PULL_COMPLETE = true;
        const local = getLocalSnapshot();
        if(Object.keys(local).length > 0) {
          await pushLocalToFirestore("initial_seed");
        }
        return false;
      }

      const remoteStorage = snap.data().localStorage || {};
      const remoteHash = snapshotString(remoteStorage);
      const localHash = snapshotString(getLocalSnapshot());
      const alreadyApplied = localStorage.getItem("CLICK360_LAST_APPLIED_REMOTE_HASH");

      if (force || (remoteHash && remoteHash !== "{}" && remoteHash !== localHash && remoteHash !== alreadyApplied)) {
        applyRemoteStorage(remoteStorage);
        localStorage.setItem("CLICK360_LAST_APPLIED_REMOTE_HASH", remoteHash);
        PULL_COMPLETE = true;

        if (reload) {
          if(window.click360Route) {
            const currentRoute = window.location.hash.replace('#','') || 'home';
            window.click360Route(currentRoute);
            const toastEl = document.getElementById("toast");
            if(toastEl) { toastEl.textContent = "Actualizado desde la nube"; toastEl.className = "toast show ok"; setTimeout(()=>toastEl.className="toast", 2800); }
          } else {
             location.reload();
          }
          return true;
        }
      }

      PULL_COMPLETE = true;
      return false;
    } catch (e) {
      PULL_COMPLETE = true;
      console.warn("CLICK360 no pudo traer nube:", e.message);
      return false;
    }
  }

  function listenRemoteChanges() {
    if (REMOTE_UNSUBSCRIBE) return;

    REMOTE_UNSUBSCRIBE = STATE_DOC.onSnapshot((snap) => {
      if (!AUTH_APPROVED || !PULL_COMPLETE || !snap.exists) return;

      const remoteStorage = snap.data().localStorage || {};
      const remoteHash = snapshotString(remoteStorage);
      const lastApplied = localStorage.getItem("CLICK360_LAST_APPLIED_REMOTE_HASH");

      if (remoteHash && remoteHash !== "{}" && remoteHash !== lastApplied && !IS_RESTORING_REMOTE) {
        applyRemoteStorage(remoteStorage);
        localStorage.setItem("CLICK360_LAST_APPLIED_REMOTE_HASH", remoteHash);
        console.log("CLICK360 recibió cambios remotos.");
        if(window.click360Route) {
          const currentRoute = window.location.hash.replace('#','') || 'home';
          window.click360Route(currentRoute);
        }
      }
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

          <button id="c360-google-login" style="width:100%;padding:17px;border-radius:18px;border:1px solid #444;background:#fff;color:#000;font-weight:900;font-size:17px;margin-bottom:12px;cursor:pointer;">Entrar con Google</button>
          <button id="c360-change-google" style="width:100%;padding:13px;border-radius:18px;border:1px solid #333;background:#000;color:#f4c431;font-weight:800;font-size:14px;cursor:pointer;">Cambiar cuenta / Cerrar sesión</button>

          <p style="opacity:.55;font-size:12px;margin-top:14px;line-height:1.4;">El acceso se aprueba desde Firebase: approvedUsers/UID con status active.</p>
          <p id="c360-auth-msg" style="margin-top:14px;color:#ffdc6b;font-size:14px;word-break:break-word;line-height:1.45;"></p>
        </div>
      `;
      document.body.appendChild(gate);

      document.getElementById("c360-google-login").onclick = signInGoogle;
      document.getElementById("c360-change-google").onclick = async () => {
        await auth.signOut();
        await signInGoogle();
      };
    }

    const msg = document.getElementById("c360-auth-msg");
    if (msg) msg.innerHTML = message;
  }

  function showPending(user) {
    showGate(`
      Cuenta pendiente de aprobación.<br><br>
      Email: <b>${user.email || "sin email"}</b><br>
      UID:<br><b>${user.uid}</b><br><br>
      En Firebase crea:<br>
      <b>approvedUsers/${user.uid}</b><br><br>
      Campos:<br>
      <b>email</b> = ${user.email || ""}<br>
      <b>status</b> = active<br>
      <b>role</b> = owner
    `);
    
    const loginBtn = document.getElementById("c360-google-login");
    if(loginBtn) {
      loginBtn.textContent = "Ya me aprobaron (Actualizar)";
      loginBtn.onclick = async () => {
         const ok = await isApprovedUser(user);
         if(ok) location.reload();
         else showPending(user);
      };
    }
  }

  function unlockApp() {
    AUTH_APPROVED = true;
    setAppBlocked(false);

    const gate = document.getElementById("click360-auth-gate");
    if (gate) gate.remove();

    createControls();
    
    if(window.click360Route) {
       const currentRoute = window.location.hash.replace('#','') || 'home';
       window.click360Route(currentRoute);
    }
  }

  function providerGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  async function signInGoogle() {
    const msg = document.getElementById("c360-auth-msg");
    try {
      if (msg) msg.textContent = "Abriendo Google...";
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        await auth.signInWithRedirect(providerGoogle());
      } else {
        try {
          await auth.signInWithPopup(providerGoogle());
        } catch (e) {
          console.warn("Popup falló, usando redirect:", e.message);
          await auth.signInWithRedirect(providerGoogle());
        }
      }
    } catch (e) {
      if (msg) msg.innerHTML = "Google no pudo abrirse. Abre la app en Safari o Chrome normal.<br><br>Error: " + e.message;
    }
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
    if (!IS_RESTORING_REMOTE && AUTH_APPROVED && PULL_COMPLETE) {
      normalizeAllLocalProductCodes();
      debouncedSync();
    }
  };

  window.addEventListener("beforeunload", () => {
    if (AUTH_APPROVED && PULL_COMPLETE) pushLocalToFirestore("beforeunload");
  });

  window.click360SyncNow = () => pushLocalToFirestore("manual");
  window.click360RefreshNow = () => pullRemoteOnce({ force: true, reload: true });

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

    try {
      await auth.getRedirectResult();
    } catch (e) {
      console.warn("Redirect error:", e.message);
    }

    auth.onAuthStateChanged(async user => {
      if (!user) {
        showGate("Inicia sesión con Google para continuar.");
        return;
      }

      showGate("Verificando aprobación en CLICK360...");
      const approved = await isApprovedUser(user);

      if (!approved) {
        showPending(user);
        return;
      }

      await pullRemoteOnce({ force: true, reload: false });
      unlockApp();
      listenRemoteChanges();
      
      const s = JSON.parse(localStorage.getItem('click360_mvp_qa_final_session_v1') || 'null');
      if(!s) {
          localStorage.setItem('click360_mvp_qa_final_session_v1', JSON.stringify({username: 'demo', role: 'owner'}));
      }
    });
  }

  boot();
})();
