# CLICK 360 P1.5B Production UX Polish

## Release candidate

- Version: `1.0.4-p1`
- Asset/cache: `mvp-launch-v16-2-p1-5b-r1`
- Branch: `feature/p1-5b-production-ux-polish`
- Base: `ed181756b892b2306dd002866c614e2a49921f36`
- Scope: client UX, local QA, documentation and release metadata only
- Production deploy: not authorized and not performed

## Implemented

### Responsive foundation

- Added consistent containment for grids, cards, modals, fields and toolbars.
- Added safe mobile wrapping and compact layouts down to 320 px.
- Kept touch targets readable instead of shrinking controls to fit.
- Verified no horizontal overflow at 320, 360, 390, 430, 768, 1024, 1366 and 1440 px.

### Label Studio

- Added explicit Simple and Expert modes sharing one data model.
- Added a five-step guide: target, quantity, paper, preview and print.
- Preserved the exact manual quantity contract.
- Kept printing by stock behind an explicit checkbox.
- Added thermal, A4, small sticker, square, round and custom presets.
- Added a full-sheet occupancy preview and pure sheet planning.
- Added warnings for out-of-margin elements, overlap and small QR.
- Made media selection depend on paper type rather than column count.
- Tightened template update/delete operations to `id + businessId`.

### Visual tables

- Extended each existing table with optional normalized layout metadata.
- Added round, square, rectangle, bar, delivery and takeaway shapes.
- Added allowlisted color tokens and accessible position controls.
- Added pointer movement with a single save on release.
- Added active-business capture to abort a drag after a business switch.
- Preserved the P1.5A order, stock, sale and cash flow.
- Added conditional access from Home and Settings for restaurant businesses.

### Help center

- Replaced whole-string matching with local token-scored search.
- Added guided steps, keywords and suggested queries.
- Covered products, sales, cash close, labels, scanner, tables, finance,
  PWA installation, offline use, stale local state and support.
- No external AI or answer API was added.

## Compatibility and security

- No Firebase Auth or OAuth changes.
- No Firestore Rules changes.
- No `accountAccess`, claims or real data changes.
- No manual `businesses/*/state/main` changes.
- No new remote collection or migration.
- Layout data remains inside each existing business-scoped table.
- Legacy tables and label templates without new optional fields remain valid.
- `save()` and the existing write gate remain authoritative for layout/template changes.
- Table checkout continues through `commitCriticalMutation()`.

## QA evidence

| Check | Result |
| --- | --- |
| `npm run qa` | PASS |
| P1.5B harness | PASS, 11/11 functional and 48/48 contracts |
| `npm run qa:rules` | PASS in Firestore emulator |
| `npm run qa:simulator:quick` | PASS, 240 actions |
| `npm run qa:simulator:full` | PASS, 2,600 actions |
| `npm run build:static` | PASS, 17 allowlisted entries |
| `git diff --check` | PASS |
| Public shell local browser | PASS, HTTP UI and 0 console errors |
| P1.5B visual fixture | PASS, 0 console errors |
| 320 × 700 | PASS, no horizontal overflow |
| 360 × 740 | PASS, no horizontal overflow |
| 390 × 844 | PASS, no horizontal overflow |
| 430 × 932 | PASS, no horizontal overflow |
| 768 × 1024 | PASS, no horizontal overflow |
| 1024 × 768 | PASS, no horizontal overflow |
| 1366 × 768 | PASS, no horizontal overflow |
| 1440 × 900 | PASS, no horizontal overflow |

The internal visual fixture is located at `qa/p1-5b-visual-fixture.html`.
It uses synthetic markup, is excluded from the static release allowlist and
does not connect to Firebase.

## Rollback

1. Do not deploy this branch until a separate approval.
2. Before any later Hosting deployment, record the current Hosting release.
3. If the release fails smoke, restore that exact Hosting release.
4. No Rules or commercial-data rollback is required because this change does
   not modify Rules or perform migrations.
5. Reverting the candidate commit restores P1.5A source and cache references.

## Remaining physical validation

- A real printer is still required to certify margins for each hardware/paper combination.
- Real drag ergonomics should be included in the authenticated pre-deploy smoke.
- Those validations do not authorize production deployment.

## Verdict

`REPO_UPDATED_READY_FOR_P1_5B_PRODUCTION_UX_POLISH_DEPLOY_APPROVAL`
