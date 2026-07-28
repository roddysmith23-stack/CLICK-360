# CLICK 360 1.0.5 Label Canvas Web Release

## Identity

- Branch: `release/1.0.5-label-canvas-production`
- Version: `1.0.5`
- Asset and Service Worker cache: `commercial-1-0-5-r1`
- Base: `main`
- Status: Draft, not merged and not deployed

## Included

- Universal Label Canvas as the primary label editor.
- Previous label flow preserved as **Asistente avanzado**.
- Physical millimetre geometry shared by preview, PDF and system print.
- QR, barcode, product name, price, SKU, text, image and logo objects.
- Mouse and touch movement, resize, rotation, layers, alignment, grid, snap,
  lock, copy, paste, duplicate, undo and redo.
- Exact quantity, starting slot, paper profiles and per-device calibration.
- Responsive containment and accessible controls for mobile and desktop.
- Release identity, PWA manifest and Service Worker cache update.

## Excluded

- `tools/admin/**` and Firebase Admin SDK.
- `functions/**`, Cloud Run and administrative endpoints.
- Firestore Rules, Auth, OAuth, claims and `accountAccess`.
- Workers P2, Restaurant Advanced, Logistics and Owner Preview.
- Migrations, administrative scripts and production data operations.
- Any deployment other than a future, separately approved Hosting-only deploy.

The existing inventory, sales, cash, reports, multi-business isolation and
legacy `state/main` contract are not redesigned by this release.

## Data Safety

The static build uses an explicit allowlist. It contains no Node dependencies,
administrative scripts, fixtures, credentials or migration tooling. The
release adds no `deleteDoc`, `writeBatch`, migration apply or direct
administrative write to `businesses/*/state/main`.

Templates and shared paper profiles continue through the existing guarded
tenant `save()` contract after an explicit user action. Device offsets and
scale remain local to the UID, tenant, business and device namespace.

## Required Gates

```sh
npm ci
npm run qa
npm run qa:rules
npm run qa:simulator:quick
npm run qa:simulator:full
npm run qa:labels:e2e
npm run build:static
npm audit --omit=dev --audit-level=moderate
```

The browser gate must pass Chromium, WebKit and Firefox from 320 through
1920 px, produce a nonblank PDF and QR region, and verify the built release
identity. Admin and Functions jobs must be skipped by path scope.

## Local Verification

- Core and regression QA: PASS.
- Firestore Rules emulator: PASS.
- Simulator quick: PASS, 240 actions and 20 reports.
- Simulator full: PASS, 2,600 actions and 100 reports.
- Universal Canvas Chromium mouse and WebKit touch E2E: PASS.
- Responsive Chromium, WebKit and Firefox: PASS, 320 through 1920 px.
- PDF: PASS, two pages with nonblank raster and QR region.
- Production dependency audit: PASS, 0 vulnerabilities.
- `dist` scan for `firebase-admin`, `google-gax` and private keys: zero matches.

## Rollback

The rollback source is `main` at
`58b3f8558c639a534a2c5e3b2da65f4e88e7ce60`. A future rollback rebuilds that
SHA and deploys Hosting only. It does not deploy Rules or Functions and does
not mutate Firestore.
