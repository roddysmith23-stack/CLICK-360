import { spawnSync } from "node:child_process";

function assertNoMatches(pattern, paths) {
  const result = spawnSync("git", ["grep", "-nE", pattern, "--", ...paths], {
    encoding: "utf8"
  });
  if (result.status === 0) {
    process.stderr.write(result.stdout);
    throw new Error("REPOSITORY_GUARD_FAILED");
  }
  if (result.status !== 1) {
    throw new Error(`REPOSITORY_SCAN_ERROR:${result.stderr.trim()}`);
  }
}

const privateKeyPattern = ["BEGIN PRIVATE ", "KEY|private_", "key\"[[:space:]]*:"].join("");
const productionDeployPattern = ["firebase deploy.*click", "-360"].join("");

assertNoMatches(privateKeyPattern, [":!fixtures/**", ":!vendor/**", ":!.github/workflows/p0-qa.yml"]);
assertNoMatches(productionDeployPattern, [".github", "staging"]);
process.stdout.write("REPOSITORY_GUARD_PASS\n");
