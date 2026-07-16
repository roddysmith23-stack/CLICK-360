import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { FakeRepository, FakeTokenVerifier, readySnapshot, testConfig } from "./helpers.js";

test("health endpoints expose only the approved fields", async () => {
  const app = buildApp({
    config: testConfig,
    repository: new FakeRepository(readySnapshot()),
    tokenVerifier: new FakeTokenVerifier(),
    logger: false
  });

  const live = await app.inject({ method: "GET", url: "/health/live" });
  assert.equal(live.statusCode, 200);
  assert.deepEqual(live.json(), { status: "LIVE" });

  const ready = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.json(), { status: "READY" });

  const version = await app.inject({ method: "GET", url: "/health/version" });
  assert.equal(version.statusCode, 200);
  assert.deepEqual(Object.keys(version.json()).sort(), [
    "buildTime",
    "environment",
    "sha",
    "shadowMode",
    "version"
  ]);
  await app.close();
});

test("bootstrap exige Firebase Auth y no acepta UID del body", async () => {
  const verifier = new FakeTokenVerifier("uid-from-verified-token");
  const app = buildApp({
    config: testConfig,
    repository: new FakeRepository(readySnapshot()),
    tokenVerifier: verifier,
    logger: false
  });

  const unauthenticated = await app.inject({ method: "POST", url: "/v1/session/bootstrap" });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.json().reason, "AUTH_REQUIRED");

  const injectedUid = await app.inject({
    method: "POST",
    url: "/v1/session/bootstrap",
    headers: { authorization: "Bearer valid" },
    payload: { uid: "attacker-controlled" }
  });
  assert.equal(injectedUid.statusCode, 400);
  assert.equal(injectedUid.json().reason, "BODY_MUST_BE_EMPTY");
  assert.equal(verifier.tokens.length, 0);
  await app.close();
});

test("bootstrap usa únicamente el UID verificado y devuelve MATCH", async () => {
  const verifier = new FakeTokenVerifier("uid-from-verified-token");
  const app = buildApp({
    config: testConfig,
    repository: new FakeRepository(readySnapshot()),
    tokenVerifier: verifier,
    logger: false,
    now: () => 2_000
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/session/bootstrap",
    headers: { authorization: "Bearer verified-token" },
    payload: {}
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().result, "MATCH");
  assert.deepEqual(verifier.tokens, ["verified-token"]);
  assert.match(response.json().requestId, /^[0-9a-f-]{36}$/);
  await app.close();
});

test("error interno queda sanitizado en la respuesta", async () => {
  const repository = new FakeRepository(readySnapshot());
  repository.getFeatureFlags = async () => {
    throw new Error("failure for private@example.com");
  };
  const app = buildApp({
    config: testConfig,
    repository,
    tokenVerifier: new FakeTokenVerifier(),
    logger: false
  });

  const response = await app.inject({
    method: "POST",
    url: "/v1/session/bootstrap",
    headers: { authorization: "Bearer verified-token" },
    payload: {}
  });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().result, "ERROR");
  assert.doesNotMatch(response.body, /private@example\.com/);
  await app.close();
});
