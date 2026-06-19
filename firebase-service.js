firebase.initializeApp(window.CLICK360_FIREBASE_CONFIG);

window.click360Auth = firebase.auth();
window.click360Db = firebase.firestore();

const BUSINESS_ID = "demo-click360";
const STATE_DOC = window.click360Db
  .collection("businesses")
  .doc(BUSINESS_ID)
  .collection("state")
  .doc("main");

function getLocalSnapshot() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    data[key] = localStorage.getItem(key);
  }
  return data;
}

async function pushLocalToFirestore(reason = "auto") {
  try {
    const user = window.click360Auth.currentUser;
    if (!user) return;

    await STATE_DOC.set({
      businessId: BUSINESS_ID,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: user.uid,
      reason,
      localStorage: getLocalSnapshot()
    }, { merge: true });

    console.log("CLICK360 sincronizado con Firestore:", reason);
  } catch (err) {
    console.warn("CLICK360 no pudo sincronizar Firestore:", err.message);
  }
}

async function pullFirestoreToLocal() {
  try {
    const snap = await STATE_DOC.get();
    if (!snap.exists) return;

    const data = snap.data();
    if (!data.localStorage) return;

    const hasLocalData = localStorage.length > 0;
    if (hasLocalData && localStorage.getItem("CLICK360_FIREBASE_RESTORED")) return;

    Object.entries(data.localStorage).forEach(([key, value]) => {
      localStorage.setItem(key, value);
    });

    localStorage.setItem("CLICK360_FIREBASE_RESTORED", "1");
    console.log("CLICK360 restaurado desde Firestore");

    if (!hasLocalData) location.reload();
  } catch (err) {
    console.warn("CLICK360 no pudo restaurar Firestore:", err.message);
  }
}

function debounce(fn, wait = 800) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const debouncedSync = debounce(() => pushLocalToFirestore("local_change"), 1000);

const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  originalSetItem.apply(this, arguments);
  debouncedSync();
};

window.addEventListener("click", () => debouncedSync());
window.addEventListener("beforeunload", () => pushLocalToFirestore("beforeunload"));

window.click360SyncNow = () => pushLocalToFirestore("manual");

window.click360Auth.signInAnonymously()
  .then(async () => {
    console.log("CLICK360 Firebase conectado");
    await pullFirestoreToLocal();
    await pushLocalToFirestore("startup");
  })
  .catch((err) => {
    console.error("CLICK360 Firebase Auth error:", err.message);
  });
