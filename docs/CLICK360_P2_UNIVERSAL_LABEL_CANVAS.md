# CLICK 360 P2 Universal Label Canvas

Status: `READY_FOR_PHYSICAL_SMOKE`

This document describes the isolated web candidate for CLICK 360 `1.0.5`.
The release branch starts directly from `main`; it does not include
administrative tooling, Functions, Rules or migrations.

## Scope and safety

This candidate changes only the static PWA label-editor surface. It does not
change Firebase Auth, OAuth, Firestore Rules, `accountAccess`, claims,
`businesses/*/state/main`, production data, Cloud Run, or hosting.

The existing Smart Print Wizard remains available as **Asistente avanzado**.
The default entry point is the direct Universal Label Canvas.

## Editor

The default screen is a single editor with a toolbar, paper/object panel,
central paper or roll, millimetre rulers, properties panel, and an exact
quantity/print footer. It supports A4, roll, custom paper, orientation, QR,
barcode, name, price, SKU, text and image objects. Objects support selection,
mouse and touch dragging, resize, rotation, duplicate, delete, lock, copy and
paste, layer order, alignment, snap, grid, undo and redo.

Templates and printer-paper profiles are scoped by the existing business and
device keys. A saved profile includes measured media width, label dimensions,
gap, pitch, offsets, calibration scale and DPI. The generic provisional profile
is 40 x 60 mm, two columns, 203 DPI. It contains no customer, printer or driver
identity.

## Physical contract

`universal-label-canvas.js` uses the following stored object contract:

```js
{ xMm, yMm, widthMm, heightMm, rotation }
```

Browser pixels are derived with `px = mm * zoom`; no browser width, visual zoom
or DPI is used as the document source of truth. Legacy version-1 canvas data
and existing label layouts are normalized once into millimetres. Objects are
bounded to the paper surface while rulers remain visible outside it.

`buildPrintPlan()` delegates to the existing `buildSheetPlan()` engine. The
same document and millimetre plan feed preview, print-node construction, system
printing and PDF. Exact quantity is explicit; it never derives from stock.
When pitch is entered, it defines the row advance used by that plan. X/Y are
plan offsets, while calibration scale is applied within the fixed physical
label area by the common renderer.

## PDF finding and correction

The browser regression fixture initially reproduced a blank PDF because the
global print stylesheet intentionally hides every body child except
`#click360PrintPortal`. The fixture output used another id, so the renderer was
correct but the print stylesheet removed it. The fixture now uses the same
portal contract as `printing-service.js`.

The production print path already mounts its node through that portal. The
candidate keeps the resource checks in `printing-service.js`: nonempty plan,
image decode, font readiness and two render frames. Timeout remains only a
failure guard, never the mechanism that makes PDF rendering work.

## Automated checks

`node qa-p2-universal-label-canvas-harness.cjs` verifies:

- V1 and legacy-layout normalization into physical millimetres.
- Bounds, rotation, history, duplicate, alignment and plan stability.
- Exact quantities, start slot and a two-page plan.
- Zoom-independent plan fingerprints.
- Default editor routing, advanced-wizard fallback, single renderer markers,
  portal handoff, script order and generic profile isolation.

Local browser evidence is produced from
`qa/fixtures/p2-universal-label-canvas.html` with Chromium and WebKit. It is
synthetic and intentionally ignored by Git under `output/playwright/p2/`.
Run it with `npm run qa:labels:e2e`; it generates screenshots and a PDF, then
asserts exact quantity, first/second positions, non-white pixels, QR pixels and
no horizontal overflow.

The generated artifacts are:

- `universal-label-e2e-chromium.png` and `universal-label-e2e-mobile-390.png`;
- `universal-label-e2e-webkit.png`;
- `universal-label-e2e.pdf` and its rendered first page.

They are test artifacts, not customer labels or a printer certification.

## Observed browser evidence

| Check | Result |
| --- | --- |
| Chromium mouse drag, resize and rotation | PASS |
| WebKit mobile touch drag | PASS |
| Add/remove image | PASS |
| Save/reload template and save paper profile | PASS |
| A4 fill row / fill page | PASS: 3 / 21 |
| Two-column start in second position | PASS |
| Exact quantity three across two pages | PASS |
| Preview and print renderer | PASS: `universal-mm-v2` |
| Calibrated X/Y editor overlay and physical renderer | PASS |
| PDF first page | PASS: nonblank, QR and text visible; two physical pages asserted |
| Reproducible browser E2E | PASS: Chrome and mobile WebKit fixture |
| Widths 320, 360, 390, 430, 768, 1024, 1366, 1440 | PASS: no horizontal overflow |
| Chromium and WebKit console errors after final fix | PASS: 0 |

The local release gate runs `npm run qa`, `npm run qa:rules`, both existing
simulators, the static build, the root production-surface audit and the canvas
browser E2E. Administrative and Functions jobs are path-gated and must be
skipped because neither surface belongs to this web-only candidate.

## Physical smoke boundary

This is not hardware certification. The physical dimensions, gap, pitch and
printer scaling remain measurement-dependent. Follow
[CLICK360_P2_LABEL_CALIBRATION_SMOKE.md](CLICK360_P2_LABEL_CALIBRATION_SMOKE.md)
using the provisional generic profile before declaring a specific printer
calibrated.

## Rollback

No cloud mutation exists to roll back. Reverting the two P2 canvas commits on
the feature branch restores the prior Smart Print Wizard entry point. The
existing templates stay intact because legacy documents are normalized at read
time and are not overwritten until a user explicitly saves a canvas template.
