import { readFile, writeFile } from "node:fs/promises";
import { evaluateReleaseManifest } from "./release-manager-core.mjs";

const manifestPath = process.argv[2];
if (!manifestPath) {
  process.stdout.write("NO_GO\n");
  process.exit(1);
}

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const result = evaluateReleaseManifest(manifest);
  await writeFile(manifestPath, `${JSON.stringify({
    ...manifest,
    releaseManagerResult: result
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${result}\n`);
  process.exit(result === "GO" ? 0 : 1);
} catch {
  process.stdout.write("NO_GO\n");
  process.exit(1);
}
