import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { STAGING_PROJECT_ID } from "./config.js";
import type {
  AccessSnapshot,
  AccountAccess,
  FeatureFlags,
  HealthState,
  LegacyAccess,
  Organization,
  StagingRepository
} from "./types.js";

const PATHS = Object.freeze({
  flags: "stagingConfig/featureFlags",
  health: "stagingHealth/bootstrap"
});

function documentData<T>(exists: boolean, data: FirebaseFirestore.DocumentData | undefined): T | null {
  return exists && data ? data as T : null;
}

export class FirestoreStagingRepository implements StagingRepository {
  constructor(private readonly firestore: Firestore) {}

  async getFeatureFlags(): Promise<FeatureFlags> {
    const snapshot = await this.firestore.doc(PATHS.flags).get();
    const data = documentData<Record<string, unknown>>(snapshot.exists, snapshot.data());
    return {
      bootstrapShadow: data?.bootstrap_shadow === true,
      observabilityV1: data?.observability_v1 === true,
      maintenanceMode: data?.maintenance_mode === true
    };
  }

  async getAccessSnapshot(uid: string): Promise<AccessSnapshot> {
    const accessRef = this.firestore.doc(`stagingAccountAccess/${uid}`);
    const legacyRef = this.firestore.doc(`stagingLegacyAccess/${uid}`);
    const [accessDoc, legacyDoc] = await Promise.all([accessRef.get(), legacyRef.get()]);
    const access = documentData<AccountAccess>(accessDoc.exists, accessDoc.data());
    const legacy = documentData<LegacyAccess>(legacyDoc.exists, legacyDoc.data());
    let organization: Organization | null = null;
    if (access?.organizationId) {
      const organizationDoc = await this.firestore.doc(`stagingOrganizations/${access.organizationId}`).get();
      organization = documentData<Organization>(organizationDoc.exists, organizationDoc.data());
    }

    return { access, legacy, organization };
  }

  async getHealthState(): Promise<HealthState | null> {
    const snapshot = await this.firestore.doc(PATHS.health).get();
    return documentData<HealthState>(snapshot.exists, snapshot.data());
  }
}

export function createFirestoreRepository(projectId: string): FirestoreStagingRepository {
  if (projectId !== STAGING_PROJECT_ID) {
    throw new Error("STAGING_PROJECT_GUARD_FAILED");
  }
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId });
  return new FirestoreStagingRepository(getFirestore(app));
}
