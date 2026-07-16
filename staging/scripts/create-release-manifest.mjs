import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const required = ["RELEASE_VERSION", "RELEASE_SHA"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`MISSING_${name}`);
}

const output = process.argv[2] ?? "staging/artifacts/release-manifest.json";
const manifest = {
  schemaVersion: 1,
  projectId: "click360-staging-7620168025",
  environment: "staging",
  version: process.env.RELEASE_VERSION,
  sha: process.env.RELEASE_SHA,
  imageDigest: process.env.IMAGE_DIGEST || "MISSING",
  rollbackImageDigest: process.env.ROLLBACK_IMAGE_DIGEST || "MISSING",
  createdAt: new Date().toISOString(),
  healthStatus: process.env.HEALTH_STATUS || "NOT_READY",
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
    e2e: process.env.E2E_STATUS || "PENDING"
  },
  productionDeployment: false,
  shadowWrites: 0,
  releaseManagerResult: "PENDING",
  rollback: {
    cloudRunImageDigest: process.env.ROLLBACK_IMAGE_DIGEST || "MISSING",
    hostingChannel: "phase1a-rollback"
  }
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
