# CLICK 360 1.0.5 Label Canvas Web Release

## Identity

- Branch: `hotfix/1-0-5-restaurant-logistics-ux`
- Version: `1.0.5`
- Asset and Service Worker cache: `commercial-1-0-5-r11`
- Base: `main`
- Status: Hosting-only frontend hotfix candidate

## Included

- Universal Label Canvas as the primary label editor.
- Previous label flow preserved as **Asistente avanzado**.
- Physical millimetre geometry shared by preview, PDF and system print.
- QR, barcode, product name, price, SKU, text, image and logo objects.
- Mouse and touch movement, resize, rotation, layers, alignment, grid, snap,
  lock, copy, paste, duplicate, undo and redo.
- Exact quantity, starting slot, paper profiles and per-device calibration.
- Responsive containment and accessible controls for mobile and desktop.
- Mobile controls for **Modo simple - Lienzo** and **Modo experto -
  Asistente avanzado** remain visible inside the canvas modal.
- Template cards delete saved QR templates through the guarded tenant save
  path and reload the list immediately after success.
- Clean PDF is the default output for canvas, wizard and template quick
  actions; browser printing remains an explicit separate option.
- The QR preview panel remains visible while scrolling label settings.
- Mobile wizard steps scroll to the active controls instead of leaving the
  preview and footer mounted over the step cards.
- The wizard footer is no longer sticky, so it cannot cover cards on desktop
  or mobile.
- Release identity, PWA manifest and Service Worker cache update.
- Restaurant tables can be arranged on a 2D floor map with drag/resize,
  seats, current guests, direct products not registered in inventory, split
  bills and recipe notes.
- Logistics adds local vehicles, route creation, load sheets, product route
  sales, collections, returns, settlement and printable route summaries for
  minimarket/distribution use.
- Table layout saves are tagged as non-commercial layout changes so stale sync
  guards do not block founders after moving tables.

## Excluded

- `tools/admin/**` and Firebase Admin SDK.
- `functions/**`, Cloud Run and administrative endpoints.
- Firestore Rules, Auth, OAuth, claims and `accountAccess`.
- Workers P2 and Owner Preview.
- Cloud backend activation for restaurant/logistics multiuser workflows.
- Migrations, administrative scripts and production data operations.
- Any deployment other than a future, separately approved Hosting-only deploy.

The existing inventory, sales, cash, reports, multi-business isolation and
legacy `state/main` contract are not redesigned by this release.

Restaurant and Logistics in this release remain frontend/local modules over the
current guarded save contract. They do not deploy new Rules, Functions,
claims, account-access changes or migrations.

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
- Universal Canvas browser E2E: blocked in this macOS session before app code
  executes because Playwright Chromium exits with
  `MachPortRendezvousServer ... unknown error code (141)`.
- Responsive Chromium, WebKit and Firefox: static containment checks pass; the
  browser visual gate must be rerun in an environment where Playwright can
  launch browsers.
- PDF: clean-output contract verified by harnesses; browser PDF raster E2E is
  blocked here by the same Playwright launch failure.
- Production dependency audit: PASS, 0 vulnerabilities.
- `dist` scan for `firebase-admin`, `google-gax` and private keys: zero matches.

## Rollback

The rollback source is `main` at
`58b3f8558c639a534a2c5e3b2da65f4e88e7ce60`. A future rollback rebuilds that
SHA and deploys Hosting only. It does not deploy Rules or Functions and does
not mutate Firestore.
