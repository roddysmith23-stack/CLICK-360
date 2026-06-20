firebase.initializeApp(window.CLICK360_FIREBASE_CONFIG);

window.click360Auth = firebase.auth();
window.click360Db = firebase.firestore();

const BUSINESS_ID = "demo-click360";
const STATE_DOC = window.click360Db
  .collection("businesses")
  .doc(BUSINESS_ID)
  .collection("state")
  .doc("main");

let AUTH_APPROVED = false;
let IS_RESTORING_REMOTE = false;
let PULL_COMPLETE = false;
let REMOTE_UNSUBSCRIBE = null;

window.click360Auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

function normalizeCode(code) {
  return String(code || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .trim();
}

function safeJsonParse(value) {
  try { return JSON.parse(value); } catch(e) { return null; }
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

const rawSetItem = localStorage.setItem.bind(localStorage);

function normalizeAllLocalProductCodes(reason = "normalize") {
  let changedAny = false;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("firebase:")) continue;
    if (key.startsWith("CLICK360_REMOTE_")) continue;
    if (key.startsWith("CLICK360_FIREBASE_")) continue;

    const raw = localStorage.getItem(key);
    const parsed = safeJsonParse(raw);

    if (parsed && deepNormalizeProductCodes(parsed)) {
      rawSetItem(key, JSON.stringify(parsed));
      changedAny = true;
    }
  }

  if (changedAny) console.log("CLICK360 códigos normalizados:", reason);
  return changedAny;
}

function lockApp(message = "Inicia sesión para continuar.") {
  AUTH_APPROVED = false;
  const gate = document.getElementById("click360-auth-gate");
  const msg = document.getElementById("c360-auth-msg");
  if (gate) gate.style.display = "flex";
  if (msg) msg.textContent = message;
  document.documentElement.style.overflow = "hidden";
}

function unlockApp() {
  AUTH_APPROVED = true;
  const gate = document.getElementById("click360-auth-gate");
  if (gate) gate.style.display = "none";
  document.documentElement.style.overflow = "";
}

function createAuthOverlay() {
  if (document.getElementById("click360-auth-gate")) return;

  const div = document.createElement("div");
  div.id = "click360-auth-gate";
  div.innerHTML = `
    <div style="position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.96);color:white;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;padding:24px;">
      <div style="width:100%;max-width:420px;border:1px solid rgba(255,255,255,.15);border-radius:24px;padding:28px;background:#111;box-shadow:0 30px 80px rgba(0,0,0,.5);">
        <h1 style="margin:0 0 8px;font-size:30px;">CLICK 360</h1>
        <p style="opacity:.75;margin:0 0 22px;">Acceso privado al sistema de inventario.</p>

        <input id="c360-email" placeholder="Correo" style="width:100%;box-sizing:border-box;padding:14px;margin-bottom:10px;border-radius:12px;border:1px solid #333;background:#000;color:#fff;">
        <input id="c360-pass" type="password" placeholder="Contraseña" style="width:100%;box-sizing:border-box;padding:14px;margin-bottom:14px;border-radius:12px;border:1px solid #333;background:#000;color:#fff;">

        <button id="c360-login" style="width:100%;padding:14px;border-radius:14px;border:0;background:#f4c431;font-weight:800;margin-bottom:10px;">Entrar</button>
        <button id="c360-register" style="width:100%;padding:14px;border-radius:14px;border:1px solid #444;background:#1a1a1a;color:#fff;font-weight:800;margin-bottom:10px;">Crear cuenta</button>
        <button id="c360-google" style="width:100%;padding:14px;border-radius:14px;border:1px solid #444;background:#fff;color:#000;font-weight:800;">Entrar con Google</button>

        <p id="c360-auth-msg" style="margin-top:14px;color:#ffdc6b;font-size:14px;word-break:break-word;"></p>
      </div>
    </div>
  `;
  document.body.appendChild(div);

  const msg = document.getElementById("c360-auth-msg");
  const email = document.getElementById("c360-email");
  const pass = document.getElementById("c360-pass");

  document.getElementById("c360-login").onclick = async () => {
    try {
      msg.textContent = "Ingresando...";
      await window.click360Auth.signInWithEmailAndPassword(email.value.trim(), pass.value);
    } catch (e) {
      msg.textContent = "No se pudo entrar: " + e.message;
    }
  };

  document.getElementById("c360-register").onclick = async () => {
    try {
      msg.textContent = "Creando cuenta...";
      await window.click360Auth.createUserWithEmailAndPassword(email.value.trim(), pass.value);
      msg.textContent = "Cuenta creada. Pendiente de aprobación.";
    } catch (e) {
      msg.textContent = "No se pudo registrar: " + e.message;
    }
  };

  document.getElementById("c360-google").onclick = async () => {
    try {
      msg.textContent = "Abriendo Google...";
      const provider = new firebase.auth.GoogleAuthProvider();
      await window.click360Auth.signInWithPopup(provider);
    } catch (e) {
      msg.textContent = "Google falló. Usa correo/contraseña si estás en celular. " + e.message;
    }
  };
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
    max-width:320px;
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
    await window.click360Auth.signOut();
    location.reload();
  };
}

function getLocalSnapshot() {
  normalizeAllLocalProductCodes("snapshot");

  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith("firebase:")) continue;
    if (key.startsWith("CLICK360_REMOTE_")) continue;
    if (key.startsWith("CLICK360_FIREBASE_")) continue;
    data[key] = localStorage.getItem(key);
  }
  return data;
}

function snapshotString(obj) {
  try { return JSON.stringify(obj || {}); }
  catch(e) { return "{}"; }
}

function applyRemoteStorage(remoteStorage) {
  IS_RESTORING_REMOTE = true;

  Object.entries(remoteStorage || {}).forEach(([key, value]) => {
    rawSetItem(key, value);
  });

  normalizeAllLocalProductCodes("remote_apply");

  rawSetItem("CLICK360_REMOTE_HASH", snapshotString(remoteStorage));
  IS_RESTORING_REMOTE = false;
}

async function isApprovedUser(user) {
  if (!user) return false;
  const doc = await window.click360Db.collection("approvedUsers").doc(user.uid).get();
  if (!doc.exists) return false;
  return doc.data().status === "active";
}

async function pushLocalToFirestore(reason = "auto") {
  try {
    const user = window.click360Auth.currentUser;
    if (!user || !AUTH_APPROVED || IS_RESTORING_REMOTE || !PULL_COMPLETE) return;

    const localSnapshot = getLocalSnapshot();

    await STATE_DOC.set({
      businessId: BUSINESS_ID,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
      updatedBy: user.uid,
      updatedByEmail: user.email || null,
      reason,
      localStorage: localSnapshot
    }, { merge: true });

    console.log("CLICK360 sincronizado con Firestore:", reason);
  } catch (err) {
    console.warn("CLICK360 no pudo sincronizar Firestore:", err.message);
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
        console.log("CLICK360 restaurado desde Firestore. Recargando app...");
        setTimeout(() => location.reload(), 300);
        return true;
      }
    }

    PULL_COMPLETE = true;
    return false;
  } catch (err) {
    PULL_COMPLETE = true;
    console.warn("CLICK360 no pudo restaurar Firestore:", err.message);
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
      console.log("CLICK360 recibió cambios remotos. Recargando...");
      setTimeout(() => location.reload(), 300);
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
    normalizeAllLocalProductCodes("setItem");
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

function getDateValue(item) {
  const v = item.createdAt || item.date || item.timestamp || item.updatedAt || item.soldAt;
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function inPeriod(item, period) {
  const d = getDateValue(item);
  if (!d) return true;

  const now = new Date();

  if (period === "day") {
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  }

  if (period === "month") {
    return d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth();
  }

  if (period === "year") {
    return d.getFullYear() === now.getFullYear();
  }

  return true;
}

function money(n) {
  const num = Number(n || 0);
  return "$" + num.toFixed(2);
}

function printReport(period = "day") {
  normalizeAllLocalProductCodes("report");

  const state = findMainState();
  const products = Array.isArray(state.products) ? state.products : [];
  const sales = Array.isArray(state.sales) ? state.sales.filter(x => inPeriod(x, period)) : [];
  const movements = Array.isArray(state.movements) ? state.movements.filter(x => inPeriod(x, period)) : [];

  const totalSales = sales.reduce((sum, s) => {
    return sum + Number(s.total || s.amount || s.price || 0);
  }, 0);

  const lowStock = products.filter(p => Number(p.stock ?? p.quantity ?? 0) <= 1);

  const titleMap = {
    day: "CIERRE DEL DÍA",
    month: "REPORTE MENSUAL",
    year: "REPORTE ANUAL"
  };

  const html = `
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${titleMap[period] || "REPORTE"} CLICK 360</title>
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
      <h1>CLICK 360 — ${titleMap[period] || "REPORTE"}</h1>
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

      <h2>Ventas / movimientos del periodo</h2>
      <table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead>
        <tbody>
          ${sales.map(s => `
            <tr>
              <td>${getDateValue(s)?.toLocaleString() || "-"}</td>
              <td>Venta</td>
              <td>${s.productName || s.name || s.code || "-"}</td>
              <td>${s.quantity || 1}</td>
              <td>${money(s.total || s.amount || s.price)}</td>
            </tr>
          `).join("")}
          ${movements.map(m => `
            <tr>
              <td>${getDateValue(m)?.toLocaleString() || "-"}</td>
              <td>${m.type || "Movimiento"}</td>
              <td>${m.productName || m.name || m.code || "-"}</td>
              <td>${m.quantity || m.qty || "-"}</td>
              <td>-</td>
            </tr>
          `).join("")}
          ${(sales.length + movements.length) === 0 ? `<tr><td colspan="5">Sin ventas o movimientos registrados en este periodo.</td></tr>` : ""}
        </tbody>
      </table>

      <script>
        setTimeout(() => window.print(), 500);
      </script>
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

createAuthOverlay();
createControlButtons();
lockApp("Inicia sesión para continuar.");

window.click360Auth.onAuthStateChanged(async (user) => {
  if (!user) {
    lockApp("Inicia sesión para continuar.");
    return;
  }

  const approved = await isApprovedUser(user);

  if (!approved) {
    lockApp(`Cuenta pendiente de aprobación. UID: ${user.uid}`);
    console.log("CLICK360 usuario pendiente:", user.uid, user.email);
    return;
  }

  console.log("CLICK360 usuario aprobado:", user.email || user.uid);

  const reloading = await pullFirestoreToLocalAndReloadIfNeeded(false);
  if (reloading) return;

  unlockApp();
  listenRemoteChanges();
  await pushLocalToFirestore("startup");
});
