import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { STAGING_PROJECT_ID } from "./config.js";
import type { TokenVerifier, VerifiedIdentity } from "./types.js";

export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly auth: Auth) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    const decoded = await this.auth.verifyIdToken(token, true);
    return { uid: decoded.uid };
  }
}

export function createTokenVerifier(projectId: string): FirebaseTokenVerifier {
  if (projectId !== STAGING_PROJECT_ID) {
    throw new Error("STAGING_PROJECT_GUARD_FAILED");
  }
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId });
  return new FirebaseTokenVerifier(getAuth(app));
}
