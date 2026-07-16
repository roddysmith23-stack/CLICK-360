import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "click360-staging-7620168025";
const projectArgument = process.argv.find((entry) => entry.startsWith("--project="))?.slice(10);
if (projectArgument !== PROJECT_ID) throw new Error("STAGING_PROJECT_GUARD_FAILED");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

const fixturePath = new URL("../../fixtures/qa-fixtures.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const firestore = getFirestore(app);
const observed = {
  flags: (await firestore.doc("stagingConfig/featureFlags").get()).data(),
  health: (await firestore.doc("stagingHealth/bootstrap").get()).data(),
  profiles: []
};

for (const profile of fixture.profiles) {
  const [access, legacy, organization] = await Promise.all([
    firestore.doc(`stagingAccountAccess/${profile.uid}`).get(),
    firestore.doc(`stagingLegacyAccess/${profile.uid}`).get(),
    profile.organization
      ? firestore.doc(`stagingOrganizations/${profile.organization.id}`).get()
      : Promise.resolve(null)
  ]);
  observed.profiles.push({
    uid: profile.uid,
    access: access.data() ?? null,
    legacy: legacy.data() ?? null,
    organization: organization?.data() ?? null
  });
}

const expected = {
  flags: fixture.featureFlags,
  health: fixture.health,
  profiles: fixture.profiles.map(({ uid, access, legacy, organization }) => ({
    uid,
    access,
    legacy,
    organization
  }))
};
const expectedHash = hash(expected);
const observedHash = hash(observed);
if (expectedHash !== observedHash) throw new Error("REMOTE_FIXTURE_HASH_MISMATCH");

console.log(JSON.stringify({
  projectId: PROJECT_ID,
  verified: true,
  profileCount: observed.profiles.length,
  expectedHash,
  observedHash
}, null, 2));
