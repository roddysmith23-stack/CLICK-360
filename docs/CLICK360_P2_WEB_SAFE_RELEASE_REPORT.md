# CLICK 360 P2 Web-Safe Release

## Candidate

- Branch: `release/p2-web-safe-no-data-migration`
- Base: `main` at `58b3f8558c639a534a2c5e3b2da65f4e88e7ce60`
- Visible version: `1.0.5-p2-web-safe`
- Asset and Service Worker cache: `mvp-launch-v16-2-p2-web-safe-r1`

## Included

- Universal Label Canvas, based on one physical millimetre document and one print plan for preview, system print and PDF.
- Existing label templates, profiles and print history remain compatible. The canvas reads them and writes only after an explicit user save or delete action in the existing label workflow.
- Safer print resource validation and browser regression fixtures.
- App-only cache refresh: only Cache Storage entries beginning with `click360-` are removed; tenant state, IndexedDB, local storage, Google session and Firestore documents are untouched.
- A physical dependency boundary: the PWA remains at the repository root, while Node-only audit, migration, and account-access tools live under `tools/admin` with an independent lockfile.

## Explicitly Excluded

- P2 Functions, Cloud Run, repositories, Functions deployment and staging cloud configuration.
- Firestore Rules, Auth, OAuth, claims, `accountAccess`, Functions, migrations against Firebase, and all real-data scripts.
- Changes to `businesses/*/state/main`, inventory, sales, cash, reports or customer records.
- P2 workers, restaurant advanced, logistics and Owner Preview in the customer app. Their static gates remain false because their cloud contracts are not part of this release.

## Static P2 Gates

`p2-web-safe-flags.js` is a client presentation gate, not an authorization system:

| Gate | Value | Effect |
| --- | --- | --- |
| `p2UniversalLabelsEnabled` | `true` | Opens the Universal Label Canvas from the existing labels entry point. |
| `p2WorkersEnabled` | `false` | No worker UI or write path is shipped. |
| `p2RestaurantAdvancedEnabled` | `false` | No advanced restaurant UI or write path is shipped. |
| `p2LogisticsEnabled` | `false` | No logistics UI or write path is shipped. |
| `p2OwnerPreviewEnabled` | `false` | The local preview stays outside this customer release. |

## Data-Safety Audit

The audit uses `rg`, excluding generated dependencies and `dist`.

| Search | Classification | Result |
| --- | --- | --- |
| `deleteDoc` | Safe | No source result in this release. |
| `writeBatch`, `setDoc` | Test only | Existing Firestore emulator fixtures; no changed production client code. |
| `businesses/*/state/main` | Existing documentation and tests | No changed path or client mutation in this release. |
| `migration` | Admin-only tooling | Moved to `tools/admin`; only synthetic fixture dry-runs are executed. |
| `firebase deploy` | No release change | No workflow, script, or deployment command is added. |
| `localStorage.clear` | Safe | No use added. The cache refresh only touches named Cache Storage entries. |

`qa-p2-web-safe-release-harness.cjs` rejects unexpected paths and new destructive/cloud operations in the diff against `main`.

## Verification

Required before review:

```sh
npm ci
npm run qa
npm run qa:rules
npm run qa:simulator:quick
npm run qa:simulator:full
npm run qa:labels:e2e
npm run build:static
npm audit --omit=dev --audit-level=moderate
node qa-p2-web-safe-release-harness.cjs
node qa-p2-web-admin-boundary-harness.cjs
```

No test in this release uses ADC, Firebase production, real accounts, Functions deployment or a production Rules deploy.

## Dependency Security Status

The root PWA package now passes `npm audit --omit=dev --audit-level=moderate` with **0 vulnerabilities**. `firebase-admin` is not a root dependency, and the static build scan finds no `firebase-admin`, `google-gax`, or `private_key` value in `dist/`.

The independent `tools/admin` package intentionally remains visible to its own audit. It reports 11 findings (5 high, 6 moderate), including:

`google-gax -> rimraf -> glob -> minimatch -> brace-expansion`.

No force fix, override, release candidate, downgrade, audit suppression, or `continue-on-error` is used. The administrative audit remains a blocking job when `tools/admin` changes. Future PWA-only releases skip administrative jobs through path routing.

**Current security result: `NO_GO_DEPENDENCY_SCOPE_RISK` for merge.** The boundary is applied and the PWA is clean, but this first boundary PR necessarily changes `tools/admin`, so its truthful audit still blocks the Draft PR.

## Rollback

The pre-release production source is `58b3f8558c639a534a2c5e3b2da65f4e88e7ce60`. After a separately approved hosting-only deployment, rollback is source and Hosting only:

```sh
git switch --detach 58b3f8558c639a534a2c5e3b2da65f4e88e7ce60
npm ci
npm run build:static
firebase deploy --only hosting
```

This rollback must be approved independently. It does not deploy Rules or Functions and does not alter Firestore data.

## Approval Boundary

This branch may be reviewed as a web-only change. It must not be merged or deployed until the owner explicitly approves the PR. Any future deployment uses only `firebase deploy --only hosting` from the reviewed release SHA.
