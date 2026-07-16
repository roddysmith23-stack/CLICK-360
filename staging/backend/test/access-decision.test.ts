import assert from "node:assert/strict";
import test from "node:test";
import { compareAccessDecisions } from "../src/access-decision.js";
import type { AccessSnapshot } from "../src/types.js";
import { enabledFlags, readySnapshot } from "./helpers.js";

test("PRO Lifetime válido coincide con legacy READY", () => {
  const decision = compareAccessDecisions(readySnapshot(), enabledFlags, 1_000);
  assert.equal(decision.result, "MATCH");
  assert.equal(decision.newDecision, "READY");
  assert.equal(decision.legacyDecision, "READY");
});

test("kill switch bloquea el shadow sin conceder acceso", () => {
  const decision = compareAccessDecisions(readySnapshot(), {
    ...enabledFlags,
    bootstrapShadow: false
  });
  assert.equal(decision.result, "BLOCKED");
  assert.equal(decision.reason, "BOOTSTRAP_SHADOW_KILL_SWITCH");
});

test("mantenimiento bloquea incluso una cuenta válida", () => {
  const decision = compareAccessDecisions(readySnapshot(), {
    ...enabledFlags,
    maintenanceMode: true
  });
  assert.equal(decision.result, "BLOCKED");
  assert.equal(decision.reason, "MAINTENANCE_MODE");
});

test("legacy ambiguo nunca produce MATCH", () => {
  const decision = compareAccessDecisions(readySnapshot({
    legacy: { decision: "LEGACY_AMBIGUOUS", reason: "MULTIPLE_OWNERS" }
  }), enabledFlags);
  assert.equal(decision.result, "LEGACY_AMBIGUOUS");
});

test("organización ausente produce datos insuficientes", () => {
  const decision = compareAccessDecisions(readySnapshot({ organization: null }), enabledFlags);
  assert.equal(decision.result, "INSUFFICIENT_DATA");
  assert.equal(decision.reason, "ORGANIZATION_MISSING");
});

test("trial vencido difiere de un legacy que todavía permite acceso", () => {
  const snapshot: AccessSnapshot = readySnapshot({
    access: {
      accountType: "trial_expired",
      status: "active",
      plan: "trial",
      trialExpiresAtMs: 900,
      organizationId: "org-trial-expired"
    },
    organization: { id: "org-trial-expired", status: "active" }
  });
  const decision = compareAccessDecisions(snapshot, enabledFlags, 1_000);
  assert.equal(decision.result, "DIFFERENCE");
  assert.equal(decision.newDecision, "BLOCKED");
  assert.equal(decision.legacyDecision, "READY");
});

test("suspendido coincide con legacy bloqueado", () => {
  const snapshot: AccessSnapshot = readySnapshot({
    access: {
      accountType: "suspended",
      status: "suspended",
      plan: "pro",
      organizationId: "org-suspended"
    },
    legacy: { decision: "BLOCKED", reason: "LEGACY_SUSPENDED" },
    organization: { id: "org-suspended", status: "active" }
  });
  const decision = compareAccessDecisions(snapshot, enabledFlags);
  assert.equal(decision.result, "MATCH");
  assert.equal(decision.newDecision, "BLOCKED");
});

test("contrato lifetime incompleto queda bloqueado", () => {
  const decision = compareAccessDecisions(readySnapshot({
    access: {
      accountType: "pro_lifetime",
      status: "active",
      plan: "pro",
      planCode: "pro_lifetime",
      billingStatus: "subscription",
      lifetime: true,
      organizationId: "org-qa-pro-lifetime"
    }
  }), enabledFlags);
  assert.equal(decision.result, "DIFFERENCE");
  assert.equal(decision.newDecision, "BLOCKED");
});

test("planCode lifetime con lifetime false queda bloqueado", () => {
  const decision = compareAccessDecisions(readySnapshot({
    access: {
      accountType: "pro_lifetime_invalid",
      status: "active",
      plan: "pro",
      planCode: "pro_lifetime",
      billingStatus: "lifetime",
      lifetime: false,
      organizationId: "org-qa-pro-lifetime"
    }
  }), enabledFlags);
  assert.equal(decision.result, "DIFFERENCE");
  assert.equal(decision.newDecision, "BLOCKED");
});
