# CLICK 360 P1.5D Dependency Security Remediation

Status: `NO_GO_DEPENDENCY_REMEDIATION`
Scope: repository and CI only. No Firebase, Rules, Authentication, account data, production Hosting, or customer data was changed.

## Decision

This is Route C: there is no released, compatible, patched dependency chain for the production audit finding at the time of this assessment. The security job stays blocking. This change separates the evidence for application QA, fixture-only administrative tooling QA, and security audit; it does not suppress or downgrade the vulnerability.

## Reproducible Baseline

Base: `58b3f85` (`main`)
Package lock baseline: `firebase-admin@14.1.0`
Node used locally: `24.11.1`; CI remains Node `22`.

This is not an application release and does not change the current customer-facing version, cache, static bundle, Firebase configuration, or Hosting target.

Commands executed:

```sh
npm audit --json
npm audit --omit=dev --audit-level=moderate
npm ls --omit=dev firebase-admin google-gax rimraf glob minimatch brace-expansion --all
npm install --ignore-scripts --no-audit firebase-admin@14.2.0  # isolated /tmp trial only
```

### Production Dependency Tree

```text
firebase-admin@14.1.0
  @google-cloud/firestore@8.6.0
    google-gax@5.0.7
      rimraf@5.0.10
        glob@10.5.0
          minimatch@9.0.9
            brace-expansion@2.1.2
```

`npm audit --omit=dev` reports five high findings. The root advisory is `GHSA-mh99-v99m-4gvg` (unbounded `brace-expansion` causing process-memory exhaustion). Its affected chain is `google-gax -> rimraf -> glob -> minimatch -> brace-expansion`.

The full dependency audit reports 20 findings (15 high, 5 moderate). The additional findings are under development tooling such as `firebase-tools`; they are not shipped by the static PWA, but remain relevant to developer and emulator tooling.

### Repository Tree After This PR

No dependency or lockfile change is committed because no compatible stable patch exists. The checked-in production dependency tree is intentionally identical to the baseline above. The isolated `firebase-admin@14.2.0` trial also retained the affected Firestore / GAX chain, so it was not committed as a cosmetic update.

## Exposure Matrix

| Surface | Packages / files | Runs for customers | Assessment |
| --- | --- | ---: | --- |
| Static PWA / Firebase Hosting | `index.html`, browser modules, `vendor/`, assets copied by `scripts/build-static-release.mjs` | Yes | `firebase-admin`, `google-gax`, and this Node chain are absent from the allowlisted static release. |
| Administrative access tooling | `scripts/admin-access-v16.mjs`, `scripts/normalize-approved-owner-access.mjs` | No | Imports `firebase-admin`; live use needs explicit operator input and ADC. Not run in CI. |
| Audit and migration tooling | `scripts/audit-firestore-legacy.mjs`, `scripts/migrate-legacy-v9-to-v10.mjs` | No | Imports `firebase-admin`; CI executes only fixture / dry-run paths. |
| Emulator and Rules QA | `firebase-tools`, `@firebase/rules-unit-testing`, `scripts/run-firestore-emulator-qa.sh` | No | Development-only. Its findings remain visible in the full audit. |
| Firebase CLI deployment tooling | `firebase-tools` | No | Development-only and never bundled into `dist/`. |
| Actually deployed code | `dist/` allowlist of 18 entries | Yes | No Node package directory is copied. The deployed browser runtime is not the affected Node process. |

This boundary reduces direct customer exposure but does not excuse a vulnerable administrative dependency. The root package remains the truthful owner of the dependency and the audit remains required.

## Remediation Investigation

| Attempt | Result | Decision |
| --- | --- | --- |
| `npm audit fix --package-lock-only --dry-run` | Zero package changes proposed. | No automatic fix exists. |
| Isolated `firebase-admin@14.2.0` install | Still resolves `@google-cloud/firestore@8.6.0`, `google-gax@5.0.7`, and the same five high findings under the existing compatible lock. | Not a remediation. |
| Latest stable Firestore 8.7.0 | Declares `google-gax ^5.0.1`; stable `google-gax` tops out at 5.0.8, which remains inside the advisory range `5.0.5 - 5.0.8`. | Not a remediation. |
| `google-gax` prereleases | Only `5.1.1-rc.1` and `6.0.1-experimental` avoid the stable release line. | Rejected: prerelease / experimental plus override would not be a demonstrated compatible production fix. |
| Out-of-range overrides, `--force`, or direct transitive replacement | Could conceal the audit while bypassing `google-gax`'s tested range. | Rejected by policy. |
| Moving `firebase-admin` into a nested package now | Would change audit classification without fixing the vulnerable administrative process. | Deferred; only acceptable with independently audited tooling and a compatible fix. |

## CI Security Policy

The workflow now has three independent required jobs:

1. `v16-qa`: PWA, Rules, simulators, static build, and secret scan.
2. `admin-fixture-qa`: audit and migration scripts against the committed synthetic fixture, plus the administrative safety harness. No ADC, real project, or customer data is provided.
3. `security-audit`: `npm ci` followed by `npm audit --omit=dev --audit-level=moderate`.

No job uses `continue-on-error`. A security failure remains a failed check and must block merge; the independent jobs still reveal whether functional QA passed.

GitHub Actions run `30249609929` verified this split: `v16-qa` passed, `admin-fixture-qa` passed, and only `security-audit` failed on the known audit gate. GitHub emitted an informational Node 20 deprecation warning for upstream action runtime internals; the workflow explicitly configures application setup with Node 22.

## Validation on This Branch

| Command | Result | Notes |
| --- | --- | --- |
| `npm ci` | PASS | Clean lockfile installation completed. |
| `npm run qa` | PASS | Includes the new dependency-boundary policy harness. |
| `npm run qa:rules` | PASS | Runs solely against `demo-click360-p0-rules` in the Firestore emulator. Expected denied-write assertions are reported as PASS. |
| `npm run qa:simulator:quick` | PASS | 240 actions, synthetic simulator data only. |
| `npm run qa:simulator:full` | PASS | 2,600 actions, synthetic simulator data only. |
| `npm run build:static` | PASS | Copies the 18 allowlisted static entries; no `node_modules` directory is deployed. |
| `npm run qa:admin:fixtures` | PASS | Audit fixture, migration dry run, and administrative safety harness; no ADC or live Firebase access. |
| `npm audit --omit=dev --audit-level=moderate` | FAIL (expected gate) | Five high findings from the unresolved administrative SDK chain. |
| `npm audit --json` | FAIL (expected gate) | 15 high and 5 moderate findings when development tooling is included. |

The browser Firebase configuration already committed in the application is public client configuration, not a service-account credential. This branch adds no private key, token, customer data, or Firebase write path.

## Compensating Controls While Blocked

- The static release script copies an explicit allowlist and never copies `node_modules`.
- Administrative scripts are project-locked and require deliberate arguments; fixture QA never initializes Firebase Admin.
- The repository ignores credential files and CI performs a private-key scan.
- No production credentials or customer fixtures are included in this branch.
- The security audit runs on every pull request and push to `main`; dependency remediation remains required before merge.

## Rollback

This branch makes no Firebase or deployment change. To reverse the CI/documentation changes, revert its commits. The existing main branch and production Hosting remain untouched. Do not use a rollback to bypass the security job; resolve the dependency chain in a follow-up only when a compatible stable release is available.

## Follow-up Gate

Re-evaluate when Google publishes a stable `google-gax` outside the advisory range and a compatible Firestore/Admin chain. A future remediation PR must run both production and full audits, fixture QA, Rules QA, simulator QA, static build, and a clean `npm ci` before it can change this verdict.
