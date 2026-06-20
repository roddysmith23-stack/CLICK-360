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

window.click360Auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

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
        <input id="c360-email" placeholder="Correo" style="width:100%;padding:14px;margin-bottom:10px;border-radius:12px;border:1px solid #333;background:#000;color:#fff;">
        <input id="c360-pass" type="password" placeholder="Contraseña" style="width:100%;padding:14px;margin-bottom:14px;border-radius:12px;border:1px solid #333;background:#000;color:#fff;">
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
      msg.textContent = "Google falló: " + e.message;
    }
  };
}

function createLogoutButton() {
  if (document.getElementById("click360-firebase-logout")) return;

  const btn = document.createElement("button");
  btn.id = "click360-firebase-logout";
  btn.textContent = "Cerrar sesión";
  btn.style.cssText = `
    position:fixed;right:18px;top:18px;z-index:999998;
    padding:10px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.2);
    background:#111;color:#fff;font-weight:800;box-shadow:0 10px 30px rgba(0,0,0,.35);
  `;

  btn.onclick = async () => {
    try { await pushLocalToFirestore("logout"); } catch(e) {}
    localStorage.clear();
    sessionStorage.clear();
    await window.click360Auth.signOut();
    location.reload();
  };

  document.body.appendChild(btn);
}

function getLocalSnapshot() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
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
    localStorage.setItem(key, value);
  });
  localStorage.setItem("CLICK360_REMOTE_HASH", snapshotString(remoteStorage));
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
    if (!user || !AUTH_APPROVED || IS_RESTORING_REMOTE) return;

    const localSnapshot = getLocalSnapshot();

    await STATE_DOC.set({
      businessId: BUSINESS_ID,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
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

async function pullFirestoreToLocalAndReloadIfNeeded() {
  try {
    const snap = await STATE_DOC.get();
    if (!snap.exists) return false;

    const remoteStorage = snap.data().localStorage || {};
    const remoteHash = snapshotString(remoteStorage);
    const localHash = snapshotString(getLocalSnapshot());

    if (remoteHash && remoteHash !== "{}" && remoteHash !== localHash) {
      applyRemoteStorage(remoteStorage);
      console.log("CLICK360 restaurado desde Firestore. Recargando app...");
      if (!sessionStorage.getItem("CLICK360_RELOADED_AFTER_PULL")) {
        sessionStorage.setItem("CLICK360_RELOADED_AFTER_PULL", "1");
        location.reload();
        return true;
      }
    }

    return false;
  } catch (err) {
    console.warn("CLICK360 no pudo restaurar Firestore:", err.message);
    return false;
  }
}

function listenRemoteChanges() {
  STATE_DOC.onSnapshot((snap) => {
    if (!AUTH_APPROVED || !snap.exists) return;

    const remoteStorage = snap.data().localStorage || {};
    const remoteHash = snapshotString(remoteStorage);
    const localHash = snapshotString(getLocalSnapshot());

    if (remoteHash && remoteHash !== "{}" && remoteHash !== localHash) {
      applyRemoteStorage(remoteStorage);
      console.log("CLICK360 recibió cambios remotos. Recargando...");
      if (!sessionStorage.getItem("CLICK360_RELOADED_REMOTE_CHANGE")) {
        sessionStorage.setItem("CLICK360_RELOADED_REMOTE_CHANGE", "1");
        location.reload();
      }
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

const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  originalSetItem.apply(this, arguments);
  if (!IS_RESTORING_REMOTE) debouncedSync();
};

window.addEventListener("click", () => debouncedSync());
window.addEventListener("beforeunload", () => pushLocalToFirestore("beforeunload"));
window.click360SyncNow = () => pushLocalToFirestore("manual");

createAuthOverlay();
createLogoutButton();
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

  const reloading = await pullFirestoreToLocalAndReloadIfNeeded();
  if (reloading) return;

  unlockApp();
  listenRemoteChanges();
  await pushLocalToFirestore("startup");
});
