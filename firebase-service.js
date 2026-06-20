(function () {
  if (!window.firebase || !window.CLICK360_FIREBASE_CONFIG) {
    console.error("CLICK360 Firebase no está cargado.");
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(window.CLICK360_FIREBASE_CONFIG);
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  window.click360Auth = auth;
  window.click360Db = db;

  const BUSINESS_ID = "demo-click360";
  const STATE_DOC = db.collection("businesses").doc(BUSINESS_ID).collection("state").doc("main");

  let AUTH_APPROVED = false;
  let PULL_COMPLETE = false;
  let IS_RESTORING_REMOTE = false;
  let REMOTE_UNSUBSCRIBE = null;

  const rawSetItem = localStorage.setItem.bind(localStorage);

  function removeOldAuthElements() {
    const ids = [
      "click360-auth-gate",
      "click360-cloud-controls",
      "click360-firebase-logout",
      "click360-refresh-cloud",
      "click360-report-day"
    ];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function normalizeCode(code) {
    return String(code || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .trim();
  }

  function safeJsonParse(value) {
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  function deepNormalizeProductCodes(obj) {
    if (!obj || typeof obj !== "object") return false;
    let changed = false;

    if (Array.isArray(obj)) {
      obj.forEach(item => {
        if (deepNormalizeProductCodes(item)) changed = true;
      });
      return changed;
    }

    if (obj.code && (obj.name || obj.price !== undefined || obj.stock !== undefined || obj.quantity !== undefined)) {
      const clean = normalizeCode(obj.code);
      if (clean && obj.code !== clean) {
        obj.originalCode = obj.originalCode || obj.code;
        obj.code = clean;
        changed = true;
      }
    }

    Object.keys(obj).forEach(k => {
      if (deepNormalizeProductCodes(obj[k])) changed = true;
    });

    return changed;
  }

  function normalizeAllLocalProductCodes() {
    let changedAny = false;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("firebase:")) continue;
      if (key.startsWith("CLICK360_")) continue;

      const raw = localStorage.getItem(key);
      const parsed = safeJsonParse(raw);

      if (parsed && deepNormalizeProductCodes(parsed)) {
        rawSetItem(key, JSON.stringify(parsed));
        changedAny = true;
      }
    }

    return changedAny;
  }

  function setAppBlocked(blocked) {
    const app = document.getElementById("app");
    if (!app) return;

    if (blocked) {
      app.style.pointerEvents = "none";
      app.style.filter = "blur(2px)";
      app.style.opacity = "0.18";
    } else {
      app.style.pointerEvents = "";
      app.style.filter = "";
      app.style.opacity = "";
    }
  }

  function createAuthGate() {
    removeOldAuthElements();

    const gate = document.createElement("div");
    gate.id = "click360-auth-gate";
    gate.innerHTML = `
      <div style="
        position:fixed;
        inset:0;
        z-index:2147483647;
        background:rgba(0,0,0,.96);
        color:white;
        display:flex;
        align-items:center;
        justify-content:center;
        font-family:Arial,sans-serif;
        padding:24px;
        box-sizing:border-box;
      ">
        <div style="
          width:100%;
          max-width:430px;
          border:1px solid rgba(255,255,255,.16);
          border-radius:28px;
          padding:30px;
          background:#111;
          box-shadow:0 30px 80px rgba(0,0,0,.65);
        ">
          <h1 style="margin:0 0 8px;font-size:36px;letter-spacing:.5px;">CLICK 360</h1>
          <p style="opacity:.72;margin:0 0 24px;font-size:17px;line-height:1.35;">
            Acceso privado con Google.
          </p>

          <button id="c360-google-login" style="
            width:100%;
            padding:17px;
            border-radius:18px;
            border:1px solid #444;
            background:#fff;
            color:#000;
            font-weight:900;
            font-size:17px;
            margin-bottom:12px;
          ">
            Entrar con Google
          </button>

          <button id="c360-check-approval" style="
            width:100%;
            padding:14px;
            border-radius:18px;
            border:1px solid #444;
            background:#1b1b1b;
            color:#fff;
            font-weight:800;
            font-size:15px;
            margin-bottom:12px;
          ">
            Ya me aprobaron / Actualizar acceso
          </button>

          <button id="c360-change-google" style="
            width:100%;
            padding:13px;
            border-radius:18px;
            border:1px solid #333;
            background:#000;
            color:#f4c431;
            font-weight:800;
            font-size:14px;
          ">
            Cambiar cuenta de Google
          </button>

          <p style="opacity:.55;font-size:12px;margin-top:14px;line-height:1.4;">
            El acceso se aprueba desde Firebase creando el documento approvedUsers/UID con status active.
          </p>

          <p id="c360-auth-msg" style="
            margin-top:14px;
            color:#ffdc6b;
            font-size:14px;
            word-break:break-word;
            line-height:1.45;
          "></p>
        </div>
      </div>
    `;

    document.body.appendChild(gate);

    document.getElementById("c360-google-login").onclick = signInGoogleOnly;
    document.getElementById("c360-check-approval").onclick = checkApprovalNow;
    document.getElementById("c360-change-google").onclick = async () => {
      try {
        await auth.signOut();
        await signInGoogleOnly();
      } catch (e) {
        showAuthMessage("No se pudo cambiar cuenta: " + e.message);
      }
    };
  }

  function showAuthMessage(html) {
    const msg = document.getElementById("c360-auth-msg");
    if (msg) msg.innerHTML = html;
  }

  function lockApp(message) {
    AUTH_APPROVED = false;
    setAppBlocked(true);

    if (!document.getElementById("click360-auth-gate")) {
      createAuthGate();
    }

    const gate = document.getElementById("click360-auth-gate");
    if (gate) gate.style.display = "block";

    showAuthMessage(message || "Inicia sesión con Google para continuar.");
  }

  function unlockApp() {
    AUTH_APPROVED = true;
    setAppBlocked(false);

    const gate = document.getElementById("click360-auth-gate");
    if (gate) gate.remove();

    createControlButtons();
  }

  function googleProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  async function signInGoogleOnly() {
    try {
      showAuthMessage("Abriendo Google...");

      const provider = googleProvider();
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        await auth.signInWithRedirect(provider);
        return;
      }

      try {
        await auth.signInWithPopup(provider);
      } catch (e) {
        console.warn("Popup falló, usando redirect:", e.message);
        await auth.signInWithRedirect(provider);
      }
    } catch (e) {
      showAuthMessage(`
        Google no pudo abrirse.<br><br>
        Abre la app en Safari o Chrome normal, no desde navegador interno ni modo privado.<br><br>
        Error: ${e.message}
      `);
    }
  }

  async function checkApprovalNow() {
    const user = auth.currentUser;

    if (!user) {
      await signInGoogleOnly();
      return;
    }

    const approved = await isApprovedUser(user);

    if (approved) {
      location.reload();
      return;
    }

    lockApp(`
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
  }

  function createControlButtons() {
    if (document.getElementById("click360-cloud-controls")) return;

    const wrap = document.createElement("div");
    wrap.id = "click360-cloud-controls";
    wrap.style.cssText = `
      position:fixed;
      right:12px;
      top:calc(env(safe-area-inset-top, 0px) + 12px);
      z-index:999998;
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      justify-content:flex-end;
      max-width:340px;
      font-family:Arial,sans-serif;
    `;

    wrap.innerHTML = `
      <button id="click360-refresh-cloud" style="padding:9px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:#f4c431;color:#111;font-weight:900;box-shadow:0 10px 30px rgba(0,0,0,.35);">Actualizar</button>
      <button id="click360-report-day" style="padding:9px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:#111;color:#fff;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.35);">Reporte</button>
      <button id="click360-firebase-logout" style="padding:9px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:#111;color:#fff;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.35);">Cerrar sesión</button>
    `;

    document.body.appendChild(wrap);

    document.getElementById("click360-refresh-cloud").onclick = async () => {
      await pullFirestoreToLocalAndReloadIfNeeded(true);
    };

    document.getElementById("click360-report-day").onclick = () => {
      const choice = prompt("Reporte: escribe DIA, MES o ANO", "DIA");
      const v = String(choice || "DIA").toLowerCase();
      if (v.includes("mes")) printReport("month");
      else if (v.includes("ano") || v.includes("año")) printReport("year");
      else printReport("day");
    };

    document.getElementById("click360-firebase-logout").onclick = async () => {
      try { await pushLocalToFirestore("logout"); } catch(e) {}
      await auth.signOut();
      location.reload();
    };
  }

  function getLocalSnapshot() {
    normalizeAllLocalProductCodes();

    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("firebase:")) continue;
      if (key.startsWith("CLICK360_")) continue;
      data[key] = localStorage.getItem(key);
    }

    return data;
  }

  function snapshotString(obj) {
    try { return JSON.stringify(obj || {}); } catch(e) { return "{}"; }
  }

  function applyRemoteStorage(remoteStorage) {
    IS_RESTORING_REMOTE = true;

    Object.entries(remoteStorage || {}).forEach(([key, value]) => {
      rawSetItem(key, value);
    });

    normalizeAllLocalProductCodes();
    rawSetItem("CLICK360_REMOTE_HASH", snapshotString(remoteStorage));
    IS_RESTORING_REMOTE = false;
  }

  async function isApprovedUser(user) {
    if (!user) return false;

    const doc = await db.collection("approvedUsers").doc(user.uid).get();
    if (!doc.exists) return false;

    return doc.data().status === "active";
  }

  async function pushLocalToFirestore(reason = "auto") {
    try {
      const user = auth.currentUser;
      if (!user || !AUTH_APPROVED || IS_RESTORING_REMOTE || !PULL_COMPLETE) return;

      await STATE_DOC.set({
        businessId: BUSINESS_ID,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
        updatedBy: user.uid,
        updatedByEmail: user.email || null,
        reason,
        localStorage: getLocalSnapshot()
      }, { merge: true });

      console.log("CLICK360 sincronizado:", reason);
    } catch (err) {
      console.warn("CLICK360 no pudo sincronizar:", err.message);
    }
  }

  async function pullFirestoreToLocalAndReloadIfNeeded(force = false) {
    try {
      const snap = await STATE_DOC.get();

      if (!snap.exists) {
        PULL_COMPLETE = true;
        return false;
      }

      const remoteStorage = snap.data().localStorage || {};
      const remoteHash = snapshotString(remoteStorage);
      const localHash = snapshotString(getLocalSnapshot());
      const lastHash = sessionStorage.getItem("CLICK360_LAST_REMOTE_HASH");

      if (force || (remoteHash && remoteHash !== "{}" && remoteHash !== localHash)) {
        applyRemoteStorage(remoteStorage);
        sessionStorage.setItem("CLICK360_LAST_REMOTE_HASH", remoteHash);
        PULL_COMPLETE = true;

        if (force || lastHash !== remoteHash) {
          setTimeout(() => location.reload(), 250);
          return true;
        }
      }

      PULL_COMPLETE = true;
      return false;
    } catch (err) {
      PULL_COMPLETE = true;
      console.warn("CLICK360 no pudo restaurar:", err.message);
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
      const lastHash = sessionStorage.getItem("CLICK360_LAST_REMOTE_HASH");

      if (remoteHash && remoteHash !== "{}" && remoteHash !== localHash && lastHash !== remoteHash) {
        applyRemoteStorage(remoteStorage);
        sessionStorage.setItem("CLICK360_LAST_REMOTE_HASH", remoteHash);
        setTimeout(() => location.reload(), 250);
      }
    });
  }

  function debounce(fn, wait = 900) {
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

  window.addEventListener("click", () => {
    if (AUTH_APPROVED && PULL_COMPLETE) debouncedSync();
  });

  window.addEventListener("beforeunload", () => {
    if (AUTH_APPROVED && PULL_COMPLETE) pushLocalToFirestore("beforeunload");
  });

  window.click360SyncNow = () => pushLocalToFirestore("manual");
  window.click360RefreshNow = () => pullFirestoreToLocalAndReloadIfNeeded(true);

  function findMainState() {
    let best = null;
    let bestScore = -1;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const parsed = safeJsonParse(localStorage.getItem(key));
      if (!parsed || typeof parsed !== "object") continue;

      const score =
        (Array.isArray(parsed.products) ? parsed.products.length * 10 : 0) +
        (Array.isArray(parsed.sales) ? parsed.sales.length * 10 : 0) +
        (Array.isArray(parsed.movements) ? parsed.movements.length * 5 : 0) +
        (Array.isArray(parsed.businesses) ? parsed.businesses.length : 0);

      if (score > bestScore) {
        bestScore = score;
        best = parsed;
      }
    }

    return best || {};
  }

  function money(n) {
    const num = Number(n || 0);
    return "$" + num.toFixed(2);
  }

  function printReport(period = "day") {
    normalizeAllLocalProductCodes();

    const state = findMainState();
    const products = Array.isArray(state.products) ? state.products : [];
    const sales = Array.isArray(state.sales) ? state.sales : [];
    const movements = Array.isArray(state.movements) ? state.movements : [];

    const totalSales = sales.reduce((sum, s) => {
      return sum + Number(s.total || s.amount || s.price || 0);
    }, 0);

    const lowStock = products.filter(p => Number(p.stock ?? p.quantity ?? 0) <= 1);

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>CLICK 360 — Reporte</title>
        <style>
          body { font-family: Arial, sans-serif; color:#111; padding:24px; }
          h1 { margin:0 0 6px; font-size:28px; }
          h2 { margin-top:28px; border-bottom:1px solid #ddd; padding-bottom:8px; }
          .muted { color:#666; }
          .grid { display:grid; grid-template-columns: repeat(3, 1fr); gap:12px; margin:20px 0; }
          .card { border:1px solid #ddd; border-radius:14px; padding:14px; }
          .big { font-size:26px; font-weight:800; }
          table { width:100%; border-collapse:collapse; margin-top:12px; }
          th, td { border-bottom:1px solid #eee; text-align:left; padding:9px; font-size:13px; }
          th { background:#f5f5f5; }
          @media print { button { display:none; } body { padding:0; } }
        </style>
      </head>
      <body>
        <h1>CLICK 360 — Reporte</h1>
        <div class="muted">Generado: ${new Date().toLocaleString()}</div>

        <div class="grid">
          <div class="card"><div class="muted">Ventas registradas</div><div class="big">${sales.length}</div></div>
          <div class="card"><div class="muted">Total ventas</div><div class="big">${money(totalSales)}</div></div>
          <div class="card"><div class="muted">Productos</div><div class="big">${products.length}</div></div>
        </div>

        <h2>Inventario actual</h2>
        <table>
          <thead><tr><th>Producto</th><th>Código</th><th>Stock</th><th>Precio</th></tr></thead>
          <tbody>
            ${products.map(p => `
              <tr>
                <td>${p.name || p.title || "-"}</td>
                <td>${p.code || p.sku || "-"}</td>
                <td>${p.stock ?? p.quantity ?? 0}</td>
                <td>${money(p.price)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <h2>Stock bajo</h2>
        <table>
          <thead><tr><th>Producto</th><th>Código</th><th>Stock</th></tr></thead>
          <tbody>
            ${lowStock.map(p => `
              <tr>
                <td>${p.name || p.title || "-"}</td>
                <td>${p.code || p.sku || "-"}</td>
                <td>${p.stock ?? p.quantity ?? 0}</td>
              </tr>
            `).join("") || `<tr><td colspan="3">Sin productos en stock bajo.</td></tr>`}
          </tbody>
        </table>

        <h2>Ventas / movimientos</h2>
        <table>
          <thead><tr><th>Tipo</th><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead>
          <tbody>
            ${sales.map(s => `
              <tr>
                <td>Venta</td>
                <td>${s.productName || s.name || s.code || "-"}</td>
                <td>${s.quantity || 1}</td>
                <td>${money(s.total || s.amount || s.price)}</td>
              </tr>
            `).join("")}
            ${movements.map(m => `
              <tr>
                <td>${m.type || "Movimiento"}</td>
                <td>${m.productName || m.name || m.code || "-"}</td>
                <td>${m.quantity || m.qty || "-"}</td>
                <td>-</td>
              </tr>
            `).join("")}
            ${(sales.length + movements.length) === 0 ? `<tr><td colspan="4">Sin ventas o movimientos registrados.</td></tr>` : ""}
          </tbody>
        </table>

        <script>setTimeout(() => window.print(), 500);</script>
      </body>
      </html>
    `;

    const w = window.open("", "_blank");
    if (!w) {
      alert("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function boot() {
    try {
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (e) {
      console.warn("Persistencia local no disponible:", e.message);
    }

    setAppBlocked(true);
    createAuthGate();

    try {
      await auth.getRedirectResult();
    } catch (e) {
      console.warn("Redirect error:", e.message);
      showAuthMessage("Google no completó el ingreso. Toca Entrar con Google nuevamente.");
    }

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        lockApp("Inicia sesión con Google para continuar.");
        return;
      }

      const approved = await isApprovedUser(user);

      if (!approved) {
        lockApp(`
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
        return;
      }

      const reloading = await pullFirestoreToLocalAndReloadIfNeeded(false);
      if (reloading) return;

      unlockApp();
      listenRemoteChanges();
      await pushLocalToFirestore("startup");
    });
  }

  boot();
})();
