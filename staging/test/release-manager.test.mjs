import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseManifest } from "../scripts/release-manager-core.mjs";

const validManifest = {
  projectId: "click360-staging-7620168025",
  environment: "staging",
  version: "0.1.0-staging.1",
  sha: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
  rollbackImageDigest: `sha256:${"c".repeat(64)}`,
  healthStatus: "READY",
  flags: {
    bootstrap_shadow: true,
    observability_v1: true,
    maintenance_mode: false
  },
  tests: {
    lint: "PASS",
    typecheck: "PASS",
    unit: "PASS",
    shadow: "PASS",
    build: "PASS",
    e2e: "PASS"
  },
  productionDeployment: false,
  shadowWrites: 0
};

test("manifest completo emite GO", () => {
  assert.equal(evaluateReleaseManifest(validManifest), "GO");
});

test("E2E ausente emite NO_GO", () => {
  assert.equal(evaluateReleaseManifest({
    ...validManifest,
    tests: { ...validManifest.tests, e2e: "PENDING" }
  }), "NO_GO");
});

test("referencia a producción emite NO_GO", () => {
  assert.equal(evaluateReleaseManifest({ ...validManifest, projectId: "click-360" }), "NO_GO");
});

test("cualquier escritura shadow emite NO_GO", () => {
  assert.equal(evaluateReleaseManifest({ ...validManifest, shadowWrites: 1 }), "NO_GO");
});
