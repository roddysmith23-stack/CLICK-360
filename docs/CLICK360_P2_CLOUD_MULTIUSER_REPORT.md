# CLICK 360 P2 Cloud Multiuser Report

## Scope and safety

All evidence in this report is synthetic and emulator-only. No production
Firebase project, customer UID, Auth account, OAuth setting, Firestore Rule,
Hosting release, `accountAccess`, or `businesses/*/state/main` was modified.
Each browser run receives a fresh synthetic business ID so persistent browser
storage cannot replay a document from a previous emulator process.

## Evidence matrix

| Area | Evidence | Result |
| --- | --- | --- |
| Admin and membership service | Auth + Functions + Firestore Emulator synthetic flow | PASS |
| Invitation | Owner creates a hash-only invite; exact synthetic email accepts it | PASS |
| Restaurant roles | Server opens; kitchen transitions; cashier makes partial/final payment | PASS |
| Restaurant idempotency | Same final payment key returns safe NOOP | PASS |
| Restaurant concurrency | Two distinct simultaneous full payments yield exactly one 200 and one 409 | PASS |
| Restaurant ledgers | Payment cash movement per payment; one sale and inventory intent on final payment | PASS |
| Logistics roles | Assigned seller, collector, owner/admin lifecycle | PASS |
| Logistics concurrency | Two distinct simultaneous full collections yield exactly one 200 and one 409 | PASS |
| Logistics ledgers | One reservation, one return-adjustment intent, and cash movement ledger | PASS |
| Cross-business | Business B cannot create or read Business A records | PASS |
| Immediate revocation | Revoked server is denied by the next Function call | PASS |
| Browser Chromium | Separate authenticated sessions, Firestore listener, refresh, revoke, responsive widths | PASS |
| Browser WebKit | Same workflow in mobile WebKit, including Firestore listener delivery | PASS |
| Reconnect | Browser disables then enables Firestore networking and requires a server-backed order read | PASS |
| Rules emulator | P2 collection read scopes and direct critical-write denials | PASS |
| Legacy core | No legacy state mutation or dual write | PASS by inspection and emulator scope |

## Browser console note

The expected cross-business and revoked-user tests intentionally receive HTTP
403. The browser runner permits only those expected 403 resource messages and
fails on all other captured console errors. It also checks 320, 360, 390, 430,
768, 1024, 1366, and 1440 px for horizontal overflow in the synthetic fixture.

## Known blockers

`functions/` uses stable `firebase-admin@13.10.0` and
`firebase-functions@6.6.0`. Its independent production-dependency audit still
reports the known Firebase Admin/Firestore/google-gax transitive advisories.
No force, override, RC, or suppression was used. This remains a staging
deployment blocker. The web PWA audit is intentionally separate from this
server-side package.

The production P2 UI is intentionally not switched to cloud repositories in
this candidate. The client boundary and authenticated synthetic browser flow
exist, but turning real UI traffic on requires an explicit staging rollout and
approved migration/compatibility plan.

## Rollback

Stop emulators and discard their temporary data. Revert or abandon this Draft
branch. Since no cloud resource is created and no production state is written,
there is no production data rollback.

## Current recommendation

`NO_GO_P2_CLOUD` until the Functions dependency audit has a stable compatible
remediation and an authorized staging deployment/real UI rollout is completed.
