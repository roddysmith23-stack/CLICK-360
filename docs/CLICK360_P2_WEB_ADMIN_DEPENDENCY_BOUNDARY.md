# CLICK 360 P2 Web/Admin Dependency Boundary

Status: `NO_GO_DEPENDENCY_SCOPE_RISK`
Scope: source layout, scripts, package locks, and CI only. No Firebase service, production data, Rules, Authentication, Hosting, or deployment is changed.

## Package Map

| Surface | Location | Dependency owner | CI |
| --- | --- | --- | --- |
| Static PWA | repository root | browser assets and PWA QA dependencies | `web-runtime-qa` |
| Node administration | `tools/admin` | `firebase-admin` and its own lockfile | `admin-fixture-qa`, `admin-security-audit` |

`dist/` remains generated from the 18-entry allowlist in `scripts/build-static-release.mjs`; it cannot contain `node_modules`, `firebase-admin`, or `google-gax`.

## Moved Tools

- Audit: `tools/admin/scripts/audit-firestore-legacy.mjs`
- Legacy migration: `tools/admin/scripts/migrate-legacy-v9-to-v10.mjs`
- Access activation/suspension: `tools/admin/scripts/admin-access-v16.mjs`
- Owner normalization: `tools/admin/scripts/normalize-approved-owner-access.mjs`
- Supporting libraries, synthetic fixture, and administrative harnesses now live under `tools/admin`.

Root compatibility wrappers delegate explicitly to this package. They do not import the Admin SDK.

## Results

- Root: `npm ci`, PWA QA, Rules emulator QA, simulators, static build, and `npm audit --omit=dev` passed with 0 vulnerabilities.
- Administration: fixture audit, migration dry-run, migration/contamination harnesses, access harness, and reconciliation harness passed without ADC or live Firebase access.
- Administration audit: intentionally failed with 11 findings (5 high, 6 moderate), including the known `google-gax -> rimraf -> glob -> minimatch -> brace-expansion` chain. It remains a blocking check when an administrative path changes.

## CI Routing

`web-runtime-qa`, `web-audit`, `web-rules-qa`, `web-simulators`, `labels-e2e`, and `web-safe-harness` run independently. A `changes` job enables both administrative jobs only when an administrative package, compatibility wrapper, or this workflow changes; `functions-qa` is skipped unless `functions/` changes. No job uses `continue-on-error`.

The Label Canvas E2E uses the local Codex Playwright wrapper when available and falls back to the same `@playwright/cli` through `npx` in CI. The fallback was executed locally with `CODEX_HOME` intentionally absent.

## Merge Gate

The PWA's product audit is green and its static `dist/` contains no administrative SDK, `google-gax`, or private-key material. This first boundary change also modifies `tools/admin`, so `admin-security-audit` must run and must remain red until a stable compatible upstream remediation exists. It cannot be skipped or made non-blocking without hiding the administrative dependency risk.

## Rollback

Revert this branch's commits to restore the prior monorepo layout. No data rollback is required because no cloud write, migration, or deployment occurs.
