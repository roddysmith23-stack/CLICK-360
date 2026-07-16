import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compareAccessDecisions } from "../src/access-decision.js";
import type { AccessSnapshot, FeatureFlags, ShadowResult } from "../src/types.js";

type Fixture = {
  featureFlags: {
    bootstrap_shadow: boolean;
    observability_v1: boolean;
    maintenance_mode: boolean;
  };
  profiles: Array<AccessSnapshot & { uid: string; expected: ShadowResult }>;
};

test("matriz sintética produce los resultados shadow esperados", async () => {
  const fixturePath = new URL("../../fixtures/qa-fixtures.json", import.meta.url);
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  const flags: FeatureFlags = {
    bootstrapShadow: fixture.featureFlags.bootstrap_shadow,
    observabilityV1: fixture.featureFlags.observability_v1,
    maintenanceMode: fixture.featureFlags.maintenance_mode
  };
  const matrix = fixture.profiles.map((profile) => ({
    uid: profile.uid,
    expected: profile.expected,
    actual: compareAccessDecisions(profile, flags, Date.UTC(2026, 6, 16)).result
  }));
  assert.deepEqual(matrix.filter((entry) => entry.expected !== entry.actual), []);
  assert.equal(matrix.length, 11);
});
