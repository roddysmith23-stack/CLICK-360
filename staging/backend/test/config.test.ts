import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { pseudonymizeUid, sanitizedError } from "../src/observability.js";

const validEnvironment = {
  GOOGLE_CLOUD_PROJECT: "click360-staging-7620168025",
  CLICK360_ENVIRONMENT: "staging",
  APP_VERSION: "0.1.0-staging.1",
  RELEASE_SHA: "0123456789abcdef0123456789abcdef01234567",
  BUILD_TIME: "2026-07-16T00:00:00.000Z",
  SHADOW_MODE: "true",
  UID_PSEUDONYM_SECRET: "test-only-secret-value-with-at-least-32-bytes",
  PORT: "8080"
};

test("configuración rechaza de forma dura cualquier proyecto distinto de staging", () => {
  assert.throws(() => loadConfig({ ...validEnvironment, GOOGLE_CLOUD_PROJECT: "click-360" }));
});

test("UID queda seudonimizado de forma determinista", () => {
  const first = pseudonymizeUid("qa-user", validEnvironment.UID_PSEUDONYM_SECRET);
  const second = pseudonymizeUid("qa-user", validEnvironment.UID_PSEUDONYM_SECRET);
  assert.equal(first, second);
  assert.notEqual(first, "qa-user");
  assert.equal(first.length, 20);
});

test("errores sanitizados eliminan correos", () => {
  const safe = sanitizedError(new Error("Denied for qa.person@example.com"));
  assert.equal(safe.message, "Operation failed");
});
