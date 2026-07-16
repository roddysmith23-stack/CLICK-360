import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const validManifest = {
  projectId: "click360-staging-7620168025",
  environment: "staging",
  version: "0.1.0-staging.1",
  sha: "a".repeat(40),
  imageDigest: `sha256:${"b".repeat(64)}`,
  rollbackImageDigest: `sha256:${"c".repeat(64)}`,
  healthStatus: "READY",
  flags: { bootstrap_shadow: true, observability_v1: true, maintenance_mode: false },
  tests: {
    lint: "PASS",
    typecheck: "PASS",
    unit: "PASS",
    shadow: "PASS",
    build: "PASS",
    e2e: "PASS"
  },
  productionDeployment: false,
  shadowWrites: 0,
  releaseManagerResult: "PENDING"
};

test("CLI emite solo GO y persiste el resultado en el manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "click360-release-"));
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(validManifest));
  const scriptPath = new URL("../scripts/release-manager.mjs", import.meta.url);
  const execution = spawnSync(process.execPath, [scriptPath.pathname, manifestPath], { encoding: "utf8" });
  assert.equal(execution.status, 0);
  assert.equal(execution.stdout, "GO\n");
  assert.equal(execution.stderr, "");
  const updated = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(updated.releaseManagerResult, "GO");
});

test("CLI emite solo NO_GO cuando falta evidencia", async () => {
  const directory = await mkdtemp(join(tmpdir(), "click360-release-"));
  const manifestPath = join(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({ ...validManifest, imageDigest: "MISSING" }));
  const scriptPath = new URL("../scripts/release-manager.mjs", import.meta.url);
  const execution = spawnSync(process.execPath, [scriptPath.pathname, manifestPath], { encoding: "utf8" });
  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, "NO_GO\n");
  assert.equal(execution.stderr, "");
});
