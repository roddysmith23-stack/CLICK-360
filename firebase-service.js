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
  let BUSINESS_ID = null;
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

  function deepNormalizeProductCodes(obj) {
    let changed = false;
    if (Array.isArray(obj)) {
      obj.forEach(item => { if (deepNormalizeProductCodes(item)) changed = true; });
    } else if (obj !== null && typeof obj === 'object') {
      if (obj.code && typeof obj.code === 'string') {
        const oldCode = obj.code;
        const newCode = oldCode.toUpperCase().trim();
        if (oldCode !== newCode) {
          obj.code = newCode;
          changed = true;
        }
      }
      Object.values(obj).forEach(val => {
        if (deepNormalizeProductCodes(val)) changed = true;
      });
    }
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
      // Check if there is an invite in URL or in cache
      const urlParams = new URLSearchParams(location.search);
      const cachedOwnerId = localStorage.getItem("CLICK360_PENDING_INVITE_OWNER");
      const isInvite = urlParams.get("invite") === "true" || !!cachedOwnerId;
      const inviteOwnerId = urlParams.get("ownerId") || cachedOwnerId;

      let doc = await db.collection("approvedUsers").doc(user.uid).get();
      let d = null;
      
      if (doc.exists && doc.data().status !== "inactive") {
        d = doc.data();
      } else if (user.email) {
        const emailDoc = await db.collection("approvedUsersByEmail").doc(user.email.toLowerCase()).get();
        if (emailDoc.exists && emailDoc.data().status !== "inactive") {
          d = emailDoc.data();
          await db.collection("approvedUsers").doc(user.uid).set({
            ...d,
            uid: user.uid,
            status: "active",
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          await db.collection("approvedUsersByEmail").doc(user.email.toLowerCase()).delete();
        }
      }

      // Auto-register pre-approved workers under the owner
      const preApprovedWorkers = ['shary10mmvv@gmail.com', 'debbya632@gmail.com', 'cheyos@hotmail.es'];
      if (!d && user.email && preApprovedWorkers.includes(user.email.toLowerCase())) {
        let ownerId = null;
        try {
          const snap = await db.collection("approvedUsers").where("role", "==", "owner").get();
          if (!snap.empty) {
            snap.forEach(doc => {
              const email = (doc.data().email || '').toLowerCase();
              if (email === 'sanyagullo1997@gmail.com' || email === 'roddysmith23@hotmail.com') {
                ownerId = doc.id;
              }
            });
            if (!ownerId) ownerId = snap.docs[0].id;
          }
        } catch(e) {
          console.error("Error finding owner for pre-approved worker:", e);
        }
        
        if (ownerId) {
          d = {
            uid: user.uid,
            email: user.email,
            role: "worker",
            ownerId: ownerId,
            name: user.displayName || user.email.split('@')[0],
            status: "active",
            photoURL: user.photoURL || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          await db.collection("approvedUsers").doc(user.uid).set(d);
        }
      }

      // Auto-register new users
      if (!d) {
        if (isInvite && inviteOwnerId) {
          // Register as a pending worker
          d = {
            uid: user.uid,
            email: user.email,
            role: "worker",
            ownerId: inviteOwnerId,
            name: user.displayName || (user.email ? user.email.split('@')[0] : "Trabajador"),
            status: "pending",
            photoURL: user.photoURL || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          await db.collection("approvedUsers").doc(user.uid).set(d);
          localStorage.removeItem("CLICK360_PENDING_INVITE_OWNER");
        } else {
          // Register as a new owner
          d = {
            uid: user.uid,
            email: user.email,
            role: "owner",
            ownerId: user.uid,
            name: user.displayName || (user.email ? user.email.split('@')[0] : "Propietario"),
            status: "active",
            photoURL: user.photoURL || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          await db.collection("approvedUsers").doc(user.uid).set(d);
        }
      }

      if (d) {
        if (d.status === "pending") {
          window.click360User = {
            uid: user.uid,
            email: user.email || d.email,
            role: "worker",
            name: d.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario"),
            photoURL: d.photoURL || user.photoURL || '',
            status: "pending"
          };
          return false;
        }

        window.click360User = {
          uid: user.uid,
          email: user.email || d.email,
          role: d.role || "worker",
          name: d.name || user.displayName || (user.email ? user.email.split('@')[0] : "Usuario"),
          photoURL: d.photoURL || user.photoURL || ''
        };
        BUSINESS_ID = d.ownerId || user.uid;
        STATE_DOC = db.collection("businesses").doc(BUSINESS_ID).collection("state").doc("main");
        return true;
      }
      return false;
    } catch(e) {
      console.error("Error al verificar aprobación", e);
      return false;
    }
  }
  window.click360InviteWorker = async function(email) {
    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
  };

  window.click360GetWorkers = async function() {
    if(!window.click360User || window.click360User.role !== 'owner') return [];
    const uid = window.click360User.uid;
    const snap = await db.collection("approvedUsers").where("ownerId", "==", uid).get();
    const workers = [];
    snap.forEach(d => {
      if (d.id !== uid) {
        workers.push({ id: d.id, ...d.data() });
      }
    });
    return workers;
  };

  window.click360ApproveWorker = async function(workerUid) {
    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
    
    // Enforce 2 active workers limit
    const workers = await window.click360GetWorkers();
    const activeCount = workers.filter(w => w.status === 'active').length;
    if (activeCount >= 2) {
      throw new Error("Límite de trabajadores alcanzado (Máximo 2 en plan gratuito).");
    }
    
    await db.collection("approvedUsers").doc(workerUid).update({
      status: "active",
      approvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };

  window.click360RejectWorker = async function(workerUid) {
    if(!window.click360User || window.click360User.role !== 'owner') throw new Error("No tienes permisos");
    await db.collection("approvedUsers").doc(workerUid).delete();
  };

  async function pushLocalToFirestore(reason = "auto") {
    try {
      const user = auth.currentUser;
      if (!user || !AUTH_APPROVED || IS_RESTORING_REMOTE || !PULL_COMPLETE || !STATE_DOC || !BUSINESS_ID) return;

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

      const hash = snapshotString(snapshot);
      rawSetItem("CLICK360_LAST_APPLIED_REMOTE_HASH", hash);

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

        if (window.click360ReloadState) window.click360ReloadState();

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
      const localHash = snapshotString(getLocalSnapshot());
      const lastApplied = localStorage.getItem("CLICK360_LAST_APPLIED_REMOTE_HASH");

      if (remoteHash && remoteHash !== "{}" && remoteHash !== localHash && remoteHash !== lastApplied && !IS_RESTORING_REMOTE) {
        applyRemoteStorage(remoteStorage);
        localStorage.setItem("CLICK360_LAST_APPLIED_REMOTE_HASH", remoteHash);
        console.log("CLICK360 recibió cambios remotos.");
        
        if (window.click360ReloadState) window.click360ReloadState();

        if(window.click360Route) {
          const currentRoute = window.location.hash.replace('#','') || 'home';
          window.click360Route(currentRoute);
          const toastEl = document.getElementById("toast");
          if(toastEl) { toastEl.textContent = "Actualizado desde la nube"; toastEl.className = "toast show ok"; setTimeout(()=>toastEl.className="toast", 2800); }
        } else {
           location.reload();
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
    }

    const msg = document.getElementById("c360-auth-msg");
    if (msg) msg.innerHTML = message;
  }

  function showPending(user) {
    showGate(`
      Tu cuenta (<b>${user.email || "sin email"}</b>) está pendiente de aprobación por el dueño del negocio.<br><br>
      Por favor, dile a tu administrador que envíe la invitación a este correo desde el sistema.
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
    }
    
    if (isIOS && isStandalone) {
      if (msg) {
        msg.innerHTML = `<div style="text-align:left; padding:12px; background:rgba(214,170,44,0.1); border:1px solid var(--gold); border-radius:16px; font-size:13px; line-height:1.4; color:var(--text);">
          <b>Nota para iPhone (PWA):</b><br>
          Debido a restricciones de seguridad de iOS en apps de pantalla de inicio, por favor:<br><br>
          1. Abre el navegador <b>Safari</b> normal.<br>
          2. Ve a <b>click-360.firebaseapp.com</b> e inicia sesión con tu cuenta.<br>
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
  window.click360Logout = async () => {
    try {
      await auth.signOut();
      localStorage.removeItem("click360_mvp_qa_final_state_v1");
      localStorage.removeItem("click360_mvp_qa_final_session_v1");
      localStorage.removeItem("CLICK360_LAST_APPLIED_REMOTE_HASH");
      sessionStorage.clear();
      location.reload();
    } catch(e) {}
  };

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
      if (!user) {
        showGate("Inicia sesión con Google para continuar.");
        return;
      }

      showGate("Verificando aprobación en CLICK360...");
      const approved = await isApprovedUser(user);

      if (!approved) {
        if (window.click360User && window.click360User.status === "pending") {
          showGate(`
            Tu solicitud de acceso como trabajador (<b>${user.email || "sin email"}</b>) está <b>pendiente de aprobación</b> por el dueño del negocio.<br><br>
            Por favor, pídele al administrador que apruebe tu acceso desde la sección "Trabajadores" en su sistema.
          `);
          const loginBtn = document.getElementById("c360-google-login");
          if (loginBtn) {
            loginBtn.textContent = "Ya me aprobaron (Actualizar)";
            loginBtn.onclick = () => location.reload();
          }
        } else {
          showPending(user);
        }
        return;
      }

      const s = JSON.parse(localStorage.getItem('click360_mvp_qa_final_session_v1') || 'null');
      if(!s) {
          const newSession = {username: 'demo', role: 'owner'};
          localStorage.setItem('click360_mvp_qa_final_session_v1', JSON.stringify(newSession));
          if(window.click360SetSession) window.click360SetSession(newSession);
      } else {
          if(window.click360SetSession) window.click360SetSession(s);
      }

      await pullRemoteOnce({ force: true, reload: false });
      unlockApp();
      listenRemoteChanges();
    });
  }

  boot();
})();
