# CLICK 360 P2 Web/Admin Dependency Boundary

Status: `NO_GO_P2_FUNCTIONS_SECURITY`
Scope: source layout, scripts, package locks, and CI only. No Firebase service, production data, Rules, Authentication, Hosting, or deployment is changed.

## Package Map

| Surface | Location | Dependency owner | CI |
| --- | --- | --- | --- |
| Static PWA | repository root | browser assets and PWA QA dependencies | `web-runtime-qa` |
| P2 Cloud Functions | `functions` | Cloud Functions runtime and its own lockfile | `functions-fixture-qa`, `functions-security-audit` |
| Node administration | `tools/admin` | `firebase-admin` and its own lockfile | `admin-fixture-qa`, `admin-security-audit` |

`dist/` remains generated from the explicit allowlist in `scripts/build-static-release.mjs`; it cannot contain `node_modules`, `firebase-admin`, or `google-gax`.

## Moved Tools

- Audit: `tools/admin/scripts/audit-firestore-legacy.mjs`
- Legacy migration: `tools/admin/scripts/migrate-legacy-v9-to-v10.mjs`
- Access activation/suspension: `tools/admin/scripts/admin-access-v16.mjs`
- Owner normalization: `tools/admin/scripts/normalize-approved-owner-access.mjs`
- Supporting libraries, synthetic fixture, and administrative harnesses now live under `tools/admin`.

Root compatibility wrappers delegate explicitly to this package. They do not import the Admin SDK.

## Results

- Root: `npm ci`, PWA QA, Rules emulator QA, simulators, static build, and `npm audit --omit=dev` passed with 0 vulnerabilities.
- P2 Functions: syntax and unit QA, Rules emulator, Functions/Auth/Firestore emulator, multiuser emulator, and Chromium/WebKit E2E passed using only `demo-click360-p2-staging`.
- Functions production audit: failed with 8 moderate findings. The concrete chain is `firebase-admin@13.10.0 -> @google-cloud/firestore@7.11.6 -> google-gax@4.6.1 -> uuid@9.0.1`, with an additional storage path through `retry-request@7.0.2 -> teeny-request@9.0.0 -> uuid@9.0.1`. `npm audit` identifies `firebase-admin@14.2.0` as the available major-version remediation.
- Administration: remains a separate package and remains blocking when its own package surface changes. It was intentionally not executed for this P2 Functions-only CI routing correction.

## CI Routing

Two workflows enforce independent package surfaces:

- `.github/workflows/web-functions-qa.yml` detects `web` and `functions` paths. It runs web/runtime checks and the blocking `functions-security-audit` without invoking `tools/admin`.
- `.github/workflows/admin-qa.yml` detects only administrative package paths and compatibility wrappers. Its fixture and audit jobs remain blocking for genuine administrative changes.

The Functions workflow never routes a `functions/**` change to `tools/admin`. A combined P2 Functions and workflow-definition change leaves administrative package jobs skipped; an isolated administrative workflow change still validates the administrative surface. No job uses `continue-on-error`.

## Current Gate

`NO_GO_P2_FUNCTIONS_SECURITY` is intentional and honest: the false administrative failure is removed, but the Functions package now has a separately visible blocking production audit. No dependency was upgraded, overridden, suppressed, or force-fixed in this change.

## Rollback

Revert this branch's commits to restore the prior monorepo layout. No data rollback is required because no cloud write, migration, or deployment occurs.
