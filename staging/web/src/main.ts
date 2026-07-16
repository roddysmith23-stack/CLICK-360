import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { STAGING_CONFIG } from "./config";
import "./styles.css";

type ShadowResponse = {
  requestId: string;
  appVersion: string;
  result: string;
  reason: string;
  severity: string;
  recommendation: string;
};

const app = initializeApp(STAGING_CONFIG.firebase);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`STAGING_UI_CONTRACT_MISSING:${selector}`);
  return element;
}

const loginButton = requiredElement<HTMLButtonElement>("#login-button");
const logoutButton = requiredElement<HTMLButtonElement>("#logout-button");
const sessionStatus = requiredElement<HTMLElement>("#session-status");
const shadowStatus = requiredElement<HTMLElement>("#shadow-status");
const versionStatus = requiredElement<HTMLElement>("#version-status");
const resultDetail = requiredElement<HTMLElement>("#result-detail");

async function loadVersion(): Promise<void> {
  try {
    const response = await fetch(`${STAGING_CONFIG.apiBaseUrl}/health/version`, { cache: "no-store" });
    const payload = await response.json() as { version?: string; environment?: string };
    versionStatus.textContent = response.ok && payload.environment === "staging"
      ? payload.version ?? "No disponible"
      : "No disponible";
  } catch {
    versionStatus.textContent = "Backend no disponible";
  }
}

async function runShadow(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  shadowStatus.textContent = "Validando";
  resultDetail.textContent = "Comparando el acceso sintético sin realizar escrituras.";

  try {
    const idToken = await user.getIdToken(true);
    const response = await fetch(`${STAGING_CONFIG.apiBaseUrl}/v1/session/bootstrap`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: "{}",
      cache: "no-store"
    });
    const payload = await response.json() as ShadowResponse;
    shadowStatus.textContent = payload.result ?? "ERROR";
    shadowStatus.dataset.result = payload.result ?? "ERROR";
    resultDetail.textContent = `${payload.reason}. Referencia ${payload.requestId}.`;
  } catch {
    shadowStatus.textContent = "ERROR";
    shadowStatus.dataset.result = "ERROR";
    resultDetail.textContent = "No se pudo consultar el backend de staging. Ningún dato fue modificado.";
  }
}

loginButton.addEventListener("click", async () => {
  loginButton.disabled = true;
  try {
    await signInWithPopup(auth, provider);
  } catch {
    resultDetail.textContent = "No se completó el acceso QA.";
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  sessionStatus.textContent = user ? "Identidad QA verificada" : "Sin autenticar";
  loginButton.hidden = Boolean(user);
  logoutButton.hidden = !user;
  if (user) {
    void runShadow();
  } else {
    shadowStatus.textContent = "Pendiente";
    delete shadowStatus.dataset.result;
    resultDetail.textContent = "Inicia sesión con la identidad QA autorizada.";
  }
});

void loadVersion();
