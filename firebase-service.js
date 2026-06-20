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

  const BUSINESS_ID = "demo-click360";
  const STATE_DOC = db.collection("businesses").doc(BUSINESS_ID).collection("state").doc("main");

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
    history.replaceState({}, "", location.pathname + "?v=mvp-stable-1");
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
    app.style.pointerEvents = blocked ? "none" : "";
    app.style.filter = blocked ? "blur(2px)" : "";
    app.style.opacity = blocked ? "0.18" : "";
  }

  function safeJsonParse(value) {
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  function normalizeCode(code) {
    return String(code || "")
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
      if (!key) continue;
      if (key.startsWith("firebase:")) continue;
      if (key.startsWith("CLICK360_")) continue;

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
      if (!key) continue;
      if (key.startsWith("firebase:")) continue;
      if (key.startsWith("CLICK360_")) continue;
      data[key] = localStorage.getItem(key);
    }
    return data;
  }

  function applyRemoteStorage(remoteStorage) {
    IS_RESTORING_REMOTE = true;

    Object.entries(remoteStorage || {}).forEach(([key, value]) => {
      rawSetItem(key, value);
    });

    normalizeAllLocalProductCodes();
    IS_RESTORING_REMOTE = false;
  }

  async function isApprovedUser(user) {
    if (!user) return false;
    const doc = await db.collection("approvedUsers").doc(user.uid).get();
    return doc.exists && doc.data().status === "active";
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
    } catch (e) {
      console.warn("CLICK360 no pudo sincronizar:", e.message);
    }
  }

  async function pullRemoteOnce({ force = false, reload = false } = {}) {
    try {
      const snap = await STATE_DOC.get();
      if (!snap.exists) {
        PULL_COMPLETE = true;
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
          setTimeout(() => location.reload(), 250);
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

      if (remoteHash && remoteHash !== "{}" && remoteHash !== lastApplied) {
        applyRemoteStorage(remoteStorage);
        localStorage.setItem("CLICK360_LAST_APPLIED_REMOTE_HASH", remoteHash);
        console.log("CLICK360 recibió cambios remotos. Usa Actualizar si no ves cambios.");
      }
    });
  }

  function showGate(message = "Inicia sesión con Google para continuar.") {
    setAppBlocked(true);

    let gate = document.getElementById("click360-auth-gate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "click360-auth-gate";
      gate.innerHTML = `
        <div style="position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.96);color:white;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:24px;box-sizing:border-box;">
          <div style="width:100%;max-width:430px;border:1px solid rgba(255,255,255,.16);border-radius:28px;padding:30px;background:#111;box-shadow:0 30px 80px rgba(0,0,0,.65);">
            <h1 style="margin:0 0 8px;font-size:36px;letter-spacing:.5px;">CLICK 360</h1>
            <p style="opacity:.72;margin:0 0 24px;font-size:17px;line-height:1.35;">Acceso privado con Google.</p>

            <button id="c360-google-login" style="width:100%;padding:17px;border-radius:18px;border:1px solid #444;background:#fff;color:#000;font-weight:900;font-size:17px;margin-bottom:12px;">Entrar con Google</button>
            <button id="c360-check-approval" style="width:100%;padding:14px;border-radius:18px;border:1px solid #444;background:#1b1b1b;color:#fff;font-weight:800;font-size:15px;margin-bottom:12px;">Ya me aprobaron / Actualizar acceso</button>
            <button id="c360-change-google" style="width:100%;padding:13px;border-radius:18px;border:1px solid #333;background:#000;color:#f4c431;font-weight:800;font-size:14px;">Cambiar cuenta de Google</button>

            <p style="opacity:.55;font-size:12px;margin-top:14px;line-height:1.4;">El acceso se aprueba desde Firebase: approvedUsers/UID con status active.</p>
            <p id="c360-auth-msg" style="margin-top:14px;color:#ffdc6b;font-size:14px;word-break:break-word;line-height:1.45;"></p>
          </div>
        </div>
      `;
      document.body.appendChild(gate);

      document.getElementById("c360-google-login").onclick = signInGoogle;
      document.getElementById("c360-check-approval").onclick = async () => {
        const user = auth.currentUser;
        if (!user) return signInGoogle();
        const ok = await isApprovedUser(user);
        if (ok) location.reload();
        else showPending(user);
      };
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
  }

  function unlockApp() {
    AUTH_APPROVED = true;
    setAppBlocked(false);

    const gate = document.getElementById("click360-auth-gate");
    if (gate) gate.remove();

    createControls();
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
    if (document.getElementById("click360-cloud-controls")) return;

    const wrap = document.createElement("div");
    wrap.id = "click360-cloud-controls";
    wrap.style.cssText = "position:fixed;right:12px;top:calc(env(safe-area-inset-top, 0px) + 12px);z-index:999998;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:340px;font-family:Arial,sans-serif;";

    wrap.innerHTML = `
      <button id="click360-refresh-cloud" style="padding:9px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:#f4c431;color:#111;font-weight:900;">Actualizar</button>
      <button id="click360-report-day" style="padding:9px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:#111;color:#fff;font-weight:800;">Reporte</button>
      <button id="click360-firebase-logout" style="padding:9px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);background:#111;color:#fff;font-weight:800;">Cerrar sesión</button>
    `;

    document.body.appendChild(wrap);

    document.getElementById("click360-refresh-cloud").onclick = async () => {
      await pullRemoteOnce({ force: true, reload: true });
    };

    document.getElementById("click360-report-day").onclick = () => {
      const choice = prompt("Reporte: escribe DIA, MES o ANO", "DIA");
      const v = String(choice || "DIA").toLowerCase();
      if (v.includes("mes")) printReport("month");
      else if (v.includes("ano") || v.includes("año")) printReport("year");
      else printReport("day");
    };

    document.getElementById("click360-firebase-logout").onclick = async () => {
      await pushLocalToFirestore("logout");
      await auth.signOut();
      location.reload();
    };
  }

  function collectAllData() {
    const result = {
      products: [],
      sales: [],
      movements: []
    };

    const seenProducts = new Set();
    const seenSales = new Set();

    function scan(x) {
      if (!x) return;

      if (Array.isArray(x)) {
        x.forEach(scan);
        return;
      }

      if (typeof x !== "object") return;

      const isProduct = (x.name || x.title) && (x.code || x.sku) && (x.price !== undefined || x.stock !== undefined || x.quantity !== undefined);
      if (isProduct) {
        const code = normalizeCode(x.code || x.sku);
        const id = code + "|" + (x.name || x.title);
        if (!seenProducts.has(id)) {
          seenProducts.add(id);
          result.products.push({
            name: x.name || x.title || "-",
            code,
            stock: Number(x.stock ?? x.quantity ?? 0),
            price: Number(x.price || 0)
          });
        }
      }

      const looksSale = x.type === "sale" || x.sale === true || x.total !== undefined || x.amount !== undefined || x.soldAt || x.productName;
      if (looksSale && (x.total !== undefined || x.amount !== undefined || x.price !== undefined)) {
        const id = JSON.stringify(x).slice(0, 300);
        if (!seenSales.has(id)) {
          seenSales.add(id);
          result.sales.push(x);
        }
      }

      const looksMovement = x.type && !looksSale;
      if (looksMovement) result.movements.push(x);

      Object.values(x).forEach(scan);
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.startsWith("firebase:") || key.startsWith("CLICK360_")) continue;
      const parsed = safeJsonParse(localStorage.getItem(key));
      scan(parsed);
    }

    return result;
  }

  function dateFromItem(item) {
    const v = item.createdAt || item.date || item.timestamp || item.updatedAt || item.soldAt;
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function inPeriod(item, period) {
    const d = dateFromItem(item);
    if (!d) return true;
    const now = new Date();

    if (period === "day") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === "year") return d.getFullYear() === now.getFullYear();

    return true;
  }

  function money(n) {
    return "$" + Number(n || 0).toFixed(2);
  }

  function printReport(period = "day") {
    normalizeAllLocalProductCodes();

    const data = collectAllData();
    const products = data.products;
    const sales = data.sales.filter(s => inPeriod(s, period));
    const movements = data.movements.filter(m => inPeriod(m, period));

    const totalSales = sales.reduce((sum, s) => sum + Number(s.total || s.amount || s.price || 0), 0);
    const inventoryValue = products.reduce((sum, p) => sum + (Number(p.stock || 0) * Number(p.price || 0)), 0);
    const lowStock = products.filter(p => Number(p.stock || 0) <= 1);

    const label = period === "month" ? "REPORTE MENSUAL" : period === "year" ? "REPORTE ANUAL" : "CIERRE DEL DÍA";

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>CLICK 360 — ${label}</title>
        <style>
          body{font-family:Arial,sans-serif;color:#111;padding:24px}
          h1{margin:0 0 6px;font-size:28px}
          h2{margin-top:26px;border-bottom:1px solid #ddd;padding-bottom:8px}
          .muted{color:#666}
          .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0}
          .card{border:1px solid #ddd;border-radius:14px;padding:14px}
          .big{font-size:24px;font-weight:800}
          table{width:100%;border-collapse:collapse;margin-top:12px}
          th,td{border-bottom:1px solid #eee;text-align:left;padding:9px;font-size:13px}
          th{background:#f5f5f5}
          @media print{body{padding:0}.grid{grid-template-columns:repeat(2,1fr)}}
        </style>
      </head>
      <body>
        <h1>CLICK 360 — ${label}</h1>
        <div class="muted">Generado: ${new Date().toLocaleString()}</div>

        <div class="grid">
          <div class="card"><div class="muted">Ventas registradas</div><div class="big">${sales.length}</div></div>
          <div class="card"><div class="muted">Ingresos</div><div class="big">${money(totalSales)}</div></div>
          <div class="card"><div class="muted">Productos</div><div class="big">${products.length}</div></div>
          <div class="card"><div class="muted">Valor inventario</div><div class="big">${money(inventoryValue)}</div></div>
        </div>

        <h2>Inventario actual</h2>
        <table>
          <thead><tr><th>Producto</th><th>Código</th><th>Stock</th><th>Precio</th><th>Total inventario</th></tr></thead>
          <tbody>
            ${products.map(p => `
              <tr>
                <td>${p.name}</td>
                <td>${p.code}</td>
                <td>${p.stock}</td>
                <td>${money(p.price)}</td>
                <td>${money(p.stock * p.price)}</td>
              </tr>
            `).join("") || `<tr><td colspan="5">Sin productos.</td></tr>`}
          </tbody>
        </table>

        <h2>Stock bajo</h2>
        <table>
          <thead><tr><th>Producto</th><th>Código</th><th>Stock</th></tr></thead>
          <tbody>
            ${lowStock.map(p => `<tr><td>${p.name}</td><td>${p.code}</td><td>${p.stock}</td></tr>`).join("") || `<tr><td colspan="3">Sin stock bajo.</td></tr>`}
          </tbody>
        </table>

        <h2>Ventas / movimientos</h2>
        <table>
          <thead><tr><th>Fecha</th><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead>
          <tbody>
            ${sales.map(s => `
              <tr>
                <td>${dateFromItem(s)?.toLocaleString() || "-"}</td>
                <td>${s.productName || s.name || s.code || "-"}</td>
                <td>${s.quantity || s.qty || 1}</td>
                <td>${money(s.total || s.amount || s.price)}</td>
              </tr>
            `).join("") || `<tr><td colspan="4">Sin ventas registradas en este periodo.</td></tr>`}
          </tbody>
        </table>

        <script>setTimeout(()=>window.print(),500);</script>
      </body>
      </html>
    `;

    const w = window.open("", "_blank");
    if (!w) {
      alert("Permite ventanas emergentes para imprimir el reporte.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
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

  window.addEventListener("click", () => {
    if (AUTH_APPROVED && PULL_COMPLETE) debouncedSync();
  });

  window.addEventListener("beforeunload", () => {
    if (AUTH_APPROVED && PULL_COMPLETE) pushLocalToFirestore("beforeunload");
  });

  window.click360SyncNow = () => pushLocalToFirestore("manual");
  window.click360RefreshNow = () => pullRemoteOnce({ force: true, reload: true });

  async function boot() {
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

      const approved = await isApprovedUser(user);

      if (!approved) {
        showPending(user);
        return;
      }

      await pullRemoteOnce({ force: false, reload: false });
      unlockApp();
      listenRemoteChanges();
      await pushLocalToFirestore("startup");
    });
  }

  boot();
})();
