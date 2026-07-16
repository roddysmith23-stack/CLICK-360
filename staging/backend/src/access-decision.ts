import type {
  AccessSnapshot,
  CalculatedDecision,
  FeatureFlags,
  ShadowDecision
} from "./types.js";

function isPaidLifetime(access: NonNullable<AccessSnapshot["access"]>): boolean {
  return access.status === "active"
    && access.lifetime === true
    && access.planCode === "pro_lifetime"
    && access.billingStatus === "lifetime";
}

function calculateNewDecision(snapshot: AccessSnapshot, nowMs: number): CalculatedDecision {
  const access = snapshot.access;
  if (!access) {
    return { state: "INSUFFICIENT_DATA", reason: "ACCOUNT_ACCESS_MISSING" };
  }

  if (["suspended", "blocked", "disabled"].includes(access.status)) {
    return { state: "BLOCKED", reason: "ACCOUNT_NOT_ACTIVE" };
  }

  if (access.plan === "trial") {
    if (!access.trialExpiresAtMs) {
      return { state: "INSUFFICIENT_DATA", reason: "TRIAL_EXPIRATION_MISSING" };
    }
    if (access.trialExpiresAtMs <= nowMs) {
      return { state: "BLOCKED", reason: "TRIAL_EXPIRED" };
    }
  } else if (access.status !== "active" && !["paid_base", "paid_pro", "founder"].includes(access.status)) {
    return { state: "BLOCKED", reason: "ACCESS_CONTRACT_INVALID" };
  }

  const hasLifetimeSignal = access.lifetime === true
    || access.planCode === "pro_lifetime"
    || access.billingStatus === "lifetime";
  if (hasLifetimeSignal && !isPaidLifetime(access)) {
    return { state: "BLOCKED", reason: "LIFETIME_CONTRACT_INVALID" };
  }

  if (!access.organizationId) {
    return { state: "INSUFFICIENT_DATA", reason: "ORGANIZATION_REFERENCE_MISSING" };
  }

  if (!snapshot.organization) {
    return { state: "INSUFFICIENT_DATA", reason: "ORGANIZATION_MISSING" };
  }

  if (snapshot.organization.id !== access.organizationId || snapshot.organization.status !== "active") {
    return { state: "BLOCKED", reason: "ORGANIZATION_NOT_ACTIVE" };
  }

  return { state: "READY", reason: "ACCESS_AND_ORGANIZATION_VALID" };
}

function calculateLegacyDecision(snapshot: AccessSnapshot): CalculatedDecision {
  if (!snapshot.legacy) {
    return { state: "INSUFFICIENT_DATA", reason: "LEGACY_ACCESS_MISSING" };
  }
  return { state: snapshot.legacy.decision, reason: snapshot.legacy.reason };
}

export function compareAccessDecisions(
  snapshot: AccessSnapshot,
  flags: FeatureFlags,
  nowMs = Date.now()
): ShadowDecision {
  const accountType = snapshot.access?.accountType ?? "unknown";

  if (flags.maintenanceMode) {
    return {
      result: "BLOCKED",
      reason: "MAINTENANCE_MODE",
      severity: "warning",
      recommendation: "RETRY_AFTER_MAINTENANCE",
      newDecision: "BLOCKED",
      legacyDecision: snapshot.legacy?.decision ?? "INSUFFICIENT_DATA",
      accountType
    };
  }

  if (!flags.bootstrapShadow) {
    return {
      result: "BLOCKED",
      reason: "BOOTSTRAP_SHADOW_KILL_SWITCH",
      severity: "warning",
      recommendation: "ENABLE_FLAG_AFTER_VALIDATION",
      newDecision: "BLOCKED",
      legacyDecision: snapshot.legacy?.decision ?? "INSUFFICIENT_DATA",
      accountType
    };
  }

  const next = calculateNewDecision(snapshot, nowMs);
  const legacy = calculateLegacyDecision(snapshot);

  if (legacy.state === "LEGACY_AMBIGUOUS") {
    return {
      result: "LEGACY_AMBIGUOUS",
      reason: legacy.reason,
      severity: "critical",
      recommendation: "REVIEW_SYNTHETIC_FIXTURE",
      newDecision: next.state,
      legacyDecision: legacy.state,
      accountType
    };
  }

  if (next.state === "INSUFFICIENT_DATA" || legacy.state === "INSUFFICIENT_DATA") {
    return {
      result: "INSUFFICIENT_DATA",
      reason: next.state === "INSUFFICIENT_DATA" ? next.reason : legacy.reason,
      severity: "warning",
      recommendation: "COMPLETE_SYNTHETIC_FIXTURE",
      newDecision: next.state,
      legacyDecision: legacy.state,
      accountType
    };
  }

  if (next.state !== legacy.state) {
    return {
      result: "DIFFERENCE",
      reason: `NEW_${next.reason}__LEGACY_${legacy.reason}`,
      severity: "critical",
      recommendation: "KEEP_SHADOW_AND_REVIEW",
      newDecision: next.state,
      legacyDecision: legacy.state,
      accountType
    };
  }

  return {
    result: "MATCH",
    reason: next.reason,
    severity: "info",
    recommendation: "NO_ACTION_SHADOW_ONLY",
    newDecision: next.state,
    legacyDecision: legacy.state,
    accountType
  };
}
