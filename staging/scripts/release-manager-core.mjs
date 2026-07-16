const REQUIRED_TESTS = ["lint", "typecheck", "unit", "shadow", "build", "e2e"];

export function evaluateReleaseManifest(manifest) {
  const checks = [
    manifest?.projectId === "click360-staging-7620168025",
    manifest?.environment === "staging",
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest?.version ?? ""),
    /^[a-f0-9]{40}$/.test(manifest?.sha ?? ""),
    /^sha256:[a-f0-9]{64}$/.test(manifest?.imageDigest ?? ""),
    /^sha256:[a-f0-9]{64}$/.test(manifest?.rollbackImageDigest ?? ""),
    manifest?.healthStatus === "READY",
    manifest?.flags?.bootstrap_shadow === true,
    manifest?.flags?.observability_v1 === true,
    manifest?.flags?.maintenance_mode === false,
    manifest?.productionDeployment === false,
    manifest?.shadowWrites === 0,
    REQUIRED_TESTS.every((name) => manifest?.tests?.[name] === "PASS")
  ];
  return checks.every(Boolean) ? "GO" : "NO_GO";
}
