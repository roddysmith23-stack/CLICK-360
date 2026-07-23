# CLICK 360 P1.5A Launch Essentials

Date: 2026-07-22

Branch: `feature/p1-5a-launch-essentials`

Candidate version: `1.0.4-p0`

Asset/cache: `mvp-launch-v16-2-p1-5a-r1`

Production deployment: **NOT PERFORMED**

## Scope

P1.5A extends the stable inventory, sales and cash core with five launch modules:

- camera and physical barcode scanner;
- exact-quantity label printing;
- Mesas Lite;
- manual finance organization;
- searchable in-app help.

It does not change Firebase Auth, OAuth, Firestore Rules, `accountAccess`,
production data, Cloud Run, V17, STABLE, or the workers feature.

## Data Compatibility

The optional fields `tables`, `tableOrders`, `labelPrintHistory`,
`finance` and `settings.labelProfiles` are initialized without replacing
existing state. Every commercial record created by these modules carries a
`businessId`, and selectors filter by the active business.

`firebase-service.js` serializes the new optional fields in the existing
canonical snapshot. `p0-tenant-guard.js` accepts them only with the expected
array/object shape. No migration or production write was executed.

## Scanner

- Uses native `BarcodeDetector` when available.
- Uses the bundled ZXing browser decoder as the offline camera/file fallback.
- Supports QR, EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, Codabar and ITF
  when the active decoder supports them.
- Handles camera denial, missing camera and busy camera with actionable text.
- Inventory opens the matching product or offers to create one with the scanned
  code. Sell adds an in-stock product or offers the create-product flow.
- Physical USB/Bluetooth readers work through the focused code/search input and
  Enter, with duplicate-scan protection.

## Labels

- Manual quantity is authoritative and independent from stock.
- Printing by stock requires the explicit checkbox.
- Stock zero produces zero labels in stock mode.
- Includes thermal roll, small roll, two-column sheet, three-column sheet,
  custom dimensions and a simple circular visual shape.
- Supports millimeter dimensions, margins, gaps, orientation, 203/300 DPI,
  barcode visibility, QR, preview and alignment test.
- Canvas output is converted to an image before print handoff so cloned print
  markup cannot lose rendered labels.
- Preview, export and print do not change inventory or cash.

## Mesas Lite

- Visible only for restaurant, cafeteria or bar businesses.
- Creates and renames tables; deletion is blocked while an order is open.
- Tracks free, occupied and ready-to-charge states and elapsed time.
- Open orders reserve stock across all tables in the active business.
- Checkout requires an open cash session, creates a normal sale and movement,
  decrements stock, closes the order and releases the table.

## Manual Finance And Help

Finance supports payments, manual loans, envelopes and savings goals. It never
requests banking usernames, passwords, keys or tokens and does not mutate sales
or cash totals.

The help center includes search, the required launch categories and questions,
common-error guidance and WhatsApp support. It is private app content, so no
public indexing contract is introduced in this release.

## Verification

| Check | Result |
| --- | --- |
| Syntax checks | PASS |
| P1.5A scanner harness | PASS |
| P1.5A label harness | PASS |
| P1.5A tables harness | PASS |
| P1.5A finance/help harness | PASS |
| P1.5A core regression harness | PASS |
| `npm run qa` | PASS |
| `npm run qa:rules` | PASS |
| Simulator quick, 240 actions | PASS |
| Simulator full, 2,600 actions | PASS |
| Production dependency audit | PASS, 0 findings |
| Browser/mobile visual check | PASS at 320, 360, 390, 430 and 1,024 px |
| CI | Pending |

The Rules emulator logs expected `PERMISSION_DENIED` results for negative
cross-tenant and unauthorized-write cases; its test process exits successfully.

The full developer-tool audit still reports five moderate transitive findings
inside Firebase CLI/MCP tooling. They are not shipped in the static browser
release; the only remaining automated fix requires a breaking Firebase CLI
downgrade, so this PR does not apply `npm audit fix --force`.

The browser check used a synthetic local tenant and the real built UI. Scanner
denial produced the expected actionable message, label preview rendered 62,546
non-white pixels, the required help search returned the close-cash guide, and
inventory, sell, tables, finance and help had no horizontal overflow at any
tested width. The browser console had zero errors; its only warning is Firebase
10.12.5's upstream deprecation notice for multi-tab IndexedDB persistence.

## Known Limits

- Camera availability and exact barcode formats still depend on the browser,
  camera quality and operating-system permissions.
- Printing is browser/driver based; CLICK 360 does not install or control a
  printer driver.
- Mesas is intentionally Lite: no KDS, reservations, advanced split bills or
  automatic kitchen printing.
- Finance is organizational and manual; it is not bank synchronization or
  accounting certification.

## Rollback

Revert the P1.5A commit and rebuild the static release from `main` at
`79dec34197311bf1793dc7c57bc87a0e51378429`. Because no production deploy,
Rules change, migration or data write is part of this PR, rollback is code-only.

## Candidate Verdict

`REPO_UPDATED_READY_FOR_P1_5A_LAUNCH_ESSENTIALS_DEPLOY_APPROVAL`

This verdict becomes final only after browser validation and CI pass. It does
not authorize Firebase Hosting deployment.
