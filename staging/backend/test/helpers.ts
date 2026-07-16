import type {
  AccessSnapshot,
  FeatureFlags,
  HealthState,
  RuntimeConfig,
  StagingRepository,
  TokenVerifier
} from "../src/types.js";

export const testConfig: RuntimeConfig = {
  projectId: "click360-staging-7620168025",
  environment: "staging",
  appVersion: "0.1.0-staging.1",
  releaseSha: "0123456789abcdef0123456789abcdef01234567",
  buildTime: "2026-07-16T00:00:00.000Z",
  shadowMode: true,
  uidPseudonymSecret: "test-only-secret-value-with-at-least-32-bytes",
  port: 8080
};

export const enabledFlags: FeatureFlags = {
  bootstrapShadow: true,
  observabilityV1: true,
  maintenanceMode: false
};

export class FakeRepository implements StagingRepository {
  constructor(
    private readonly snapshot: AccessSnapshot,
    private readonly flags: FeatureFlags = enabledFlags,
    private readonly health: HealthState | null = {
      ready: true,
      environment: "staging",
      schemaVersion: 1
    }
  ) {}

  async getFeatureFlags(): Promise<FeatureFlags> {
    return this.flags;
  }

  async getAccessSnapshot(_uid: string): Promise<AccessSnapshot> {
    return this.snapshot;
  }

  async getHealthState(): Promise<HealthState | null> {
    return this.health;
  }
}

export class FakeTokenVerifier implements TokenVerifier {
  readonly tokens: string[] = [];

  constructor(private readonly uid = "qa-pro-lifetime-0001") {}

  async verify(token: string): Promise<{ uid: string }> {
    this.tokens.push(token);
    if (token === "invalid") throw new Error("TOKEN_REJECTED");
    return { uid: this.uid };
  }
}

export function readySnapshot(overrides: Partial<AccessSnapshot> = {}): AccessSnapshot {
  return {
    access: {
      accountType: "pro_lifetime",
      status: "active",
      plan: "pro",
      planCode: "pro_lifetime",
      billingStatus: "lifetime",
      lifetime: true,
      organizationId: "org-qa-pro-lifetime"
    },
    legacy: { decision: "READY", reason: "LEGACY_ALLOWED" },
    organization: { id: "org-qa-pro-lifetime", status: "active" },
    ...overrides
  };
}
