import { readFile } from "node:fs/promises";

const files = [
  new URL("../firebase.staging.json", import.meta.url),
  new URL("../backend/src/config.ts", import.meta.url),
  new URL("../../.github/workflows/staging-phase1a.yml", import.meta.url)
];
const requiredProject = "click360-staging-7620168025";
for (const file of files) {
  const content = await readFile(file, "utf8");
  if (!content.includes(requiredProject)) throw new Error(`STAGING_ID_MISSING:${file.pathname}`);
  if (/projects:\s*\{[^}]*default:\s*["']click-360["']/s.test(content)) {
    throw new Error(`PRODUCTION_PROJECT_REFERENCE:${file.pathname}`);
  }
}

const firebaseConfig = JSON.parse(await readFile(files[0], "utf8"));
if (firebaseConfig.hosting.site !== requiredProject) throw new Error("HOSTING_SITE_GUARD_FAILED");
process.stdout.write("STAGING_ONLY_GUARD_PASS\n");
