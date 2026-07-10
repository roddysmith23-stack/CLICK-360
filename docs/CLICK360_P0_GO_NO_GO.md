# CLICK 360 P0 GO / NO-GO

## Current decision: NO-GO

The code protections, local fixtures, regression harnesses, CI workflow, and administrative tooling are complete on the hotfix branch. Production approval is blocked until the following external-state gates are completed with an authorized Firebase credential:

1. Run the read-only Firebase audit and retain the generated report outside Git.
2. Review all `CROSS_TENANT_SUSPECT`, `LEGACY_AMBIGUOUS`, and `ORPHANED` tenants; do not migrate them.
3. Run the administrative migration dry-run and migrate only audit-approved `LEGACY_CLEAR_OWNER` tenants.
4. Execute real A/B, offline/reconnect, and same-account two-device checks.
5. Confirm GitHub Actions is green on PR #1.

Until then, the PR remains draft. No merge, GitHub Pages publication, or Firestore Rules deployment is authorized.

## Tooling dependency note

`npm audit` reports eight moderate transitive advisories in the Firebase Admin toolchain. The available automatic fix requires a breaking Firebase Admin upgrade, so it was not applied inside this P0 safety hotfix. It does not affect the public browser bundle; it remains a maintenance item for the administrative tooling before a production rollout.
