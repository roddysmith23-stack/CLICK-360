export const SHADOW_RESULTS = [
  "MATCH",
  "DIFFERENCE",
  "INSUFFICIENT_DATA",
  "LEGACY_AMBIGUOUS",
  "BLOCKED",
  "ERROR"
] as const;

export type ShadowResult = (typeof SHADOW_RESULTS)[number];
export type DecisionState = "READY" | "BLOCKED" | "INSUFFICIENT_DATA" | "LEGACY_AMBIGUOUS";
export type Severity = "info" | "warning" | "critical";

export interface RuntimeConfig {
  readonly projectId: string;
  readonly environment: "staging";
  readonly appVersion: string;
  readonly releaseSha: string;
  readonly buildTime: string;
  readonly shadowMode: true;
  readonly uidPseudonymSecret: string;
  readonly port: number;
}

export interface FeatureFlags {
  readonly bootstrapShadow: boolean;
  readonly observabilityV1: boolean;
  readonly maintenanceMode: boolean;
}

export interface AccountAccess {
  readonly accountType: string;
  readonly status: string;
  readonly plan: string;
  readonly planCode?: string;
  readonly billingStatus?: string;
  readonly lifetime?: boolean;
  readonly organizationId?: string;
  readonly trialExpiresAtMs?: number;
}

export interface LegacyAccess {
  readonly decision: DecisionState;
  readonly reason: string;
}

export interface Organization {
  readonly id: string;
  readonly status: string;
}

export interface AccessSnapshot {
  readonly access: AccountAccess | null;
  readonly legacy: LegacyAccess | null;
  readonly organization: Organization | null;
}

export interface CalculatedDecision {
  readonly state: DecisionState;
  readonly reason: string;
}

export interface ShadowDecision {
  readonly result: ShadowResult;
  readonly reason: string;
  readonly severity: Severity;
  readonly recommendation: string;
  readonly newDecision: DecisionState;
  readonly legacyDecision: DecisionState;
  readonly accountType: string;
}

export interface HealthState {
  readonly ready: boolean;
  readonly environment: string;
  readonly schemaVersion: number;
}

export interface StagingRepository {
  getFeatureFlags(): Promise<FeatureFlags>;
  getAccessSnapshot(uid: string): Promise<AccessSnapshot>;
  getHealthState(): Promise<HealthState | null>;
}

export interface VerifiedIdentity {
  readonly uid: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}
