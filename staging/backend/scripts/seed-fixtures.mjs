import { readFile } from "node:fs/promises";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "click360-staging-7620168025";
const CONFIRMATION = "SEED CLICK360 STAGING SYNTHETIC FIXTURES";
const args = new Map(process.argv.slice(2).map((entry) => {
  const [key, ...rest] = entry.split("=");
  return [key, rest.join("=")];
}));

if (args.get("--project") !== PROJECT_ID) {
  throw new Error("STAGING_PROJECT_GUARD_FAILED");
}

const fixturePath = new URL("../../fixtures/qa-fixtures.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const summary = {
  projectId: PROJECT_ID,
  schemaVersion: fixture.schemaVersion,
  profileCount: fixture.profiles.length,
  collections: [
    "stagingConfig",
    "stagingHealth",
    "stagingAccountAccess",
    "stagingLegacyAccess",
    "stagingOrganizations"
  ],
  forbiddenCollections: ["businesses", "accountAccess", "approvedUsers"]
};

if (args.get("--apply") !== "true") {
  console.log(JSON.stringify({ mode: "DRY_RUN", confirmation: CONFIRMATION, ...summary }, null, 2));
  process.exit(0);
}

if (args.get("--confirm") !== CONFIRMATION) {
  throw new Error("LITERAL_CONFIRMATION_REQUIRED");
}

const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const firestore = getFirestore(app);
const batch = firestore.batch();
batch.set(firestore.doc("stagingConfig/featureFlags"), fixture.featureFlags);
batch.set(firestore.doc("stagingHealth/bootstrap"), fixture.health);

for (const profile of fixture.profiles) {
  batch.set(firestore.doc(`stagingAccountAccess/${profile.uid}`), profile.access);
  batch.set(firestore.doc(`stagingLegacyAccess/${profile.uid}`), profile.legacy);
  if (profile.organization) {
    batch.set(firestore.doc(`stagingOrganizations/${profile.organization.id}`), profile.organization);
  }
}

await batch.commit();

const [flags, health] = await Promise.all([
  firestore.doc("stagingConfig/featureFlags").get(),
  firestore.doc("stagingHealth/bootstrap").get()
]);
if (!flags.exists || !health.exists || health.get("environment") !== "staging") {
  throw new Error("FIXTURE_VERIFICATION_FAILED");
}

console.log(JSON.stringify({ mode: "APPLY", verified: true, ...summary }, null, 2));
