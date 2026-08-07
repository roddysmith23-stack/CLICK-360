# r34 Recovery Plan — label print pipeline (planning document only)

## Context

- Production (Firebase Hosting) was rolled back to `c030256d8530beef48a4d19a2d2675642df8534b`
  (2026-08-05 13:47, "fix(sync): keep_local now force-pushes to cloud + better conflict dialog")
  after commit `b964f0e` (2026-08-06 00:18) regressed the label print pipeline.
- `main` in git already contains ALL of the r30–r33 work on top of `b964f0e` — nothing was reverted
  in git, only the deployed Hosting bundle was rolled back.
- This branch, `hotfix/1.0.5-r34-print-geometry-recovery`, was created from current `main`/HEAD, so
  it already contains every fix listed below.
- **This document does not implement anything.** It is a checklist for whoever re-deploys: confirm
  each improvement below is still present at whatever commit gets pushed to Hosting next, and that
  it is covered by an automated regression gate before it goes out again.
- Part A of this branch's work added `qa/fixtures/golden-shary-2col-40x60.html` +
  `qa/golden-shary-2col-e2e.mjs` (run via `npm run qa:r34`), a permanent golden fixture for a real
  2-column 40x60mm roll client configuration. Because it drives `executeCanonicalLabelPrint()` /
  `buildUniversalLabelPrintNode()` / `handoffPrint()` — the same shared pipeline every item below
  passes through — **passing this fixture against current HEAD is effectively validating all of
  the items below at once**, in the sense that a regression to any of them that breaks 2-column
  roll geometry, quantity handling, startSlot handling, or QR/name/price/sku rendering would fail
  it. It is not a substitute for the item-specific tests already listed in `package.json`
  (`qa:r30`… `qa:r33` equivalents below) — those remain the authoritative gates for their own
  narrower behaviors (e.g. TDZ, priceFormat persistence) that the golden fixture does not
  specifically target.

## Chronological improvement log, b964f0e → r33 (all already merged into this branch's HEAD)

| # | Commit(s) | Date | Improvement | Covered by golden fixture (Part A)? |
|---|---|---|---|---|
| 1 | `b964f0e` | 2026-08-06 | Origin commit: QR priceFormat fix, print button per product, PDF fix, friendly conflict dialog — **also introduced the print-geometry regression** that triggered this rollback. | Indirectly — the fixture exercises the priceFormat-bearing document schema and the canonical print node this commit touched, but does not re-test this commit's specific PDF/conflict-dialog changes. |
| 2 | `0627e41` | 2026-08-06 | `feat: unified canonical label print path - fix quick-print from inventory` — routes the inventory quick-print button through the same `executeCanonicalLabelPrint()` chain as every other print entry point. | Yes, structurally — the golden fixture drives `executeCanonicalLabelPrint()` directly, the same function this unification made canonical. It does not click the actual quick-print UI button. |
| 3 | `265734e` | 2026-08-06 | `fix(labels): restore correct print paths + priceFormat preservation` — priceFormat survives the print handoff instead of resetting. | Partially — the fixture's document carries `priceFormat` through `normalizeDocument`/render, but does not assert a specific priceFormat value change (that is `qa-p1-5c-*` / r31 territory). |
| 4 | `c28841c` | 2026-08-06 | `fix(labels): remove hardcoded @page A4 from CSS + try-catch label preview` — first attempt at the A4-fallback bug class later fully fixed in r33. | Yes — the fixture asserts the `@page` size resolves to the real 82x60mm roll media, never an A4/Letter fallback. |
| 5 | `e42699f`, `cfa1226`, `b7ced74` | 2026-08-07 | r30: quick-print quantity/startSlot confirmation guard + regression tests — the confirm dialog no longer silently drops the chosen quantity/startSlot. | Yes, for the underlying engine — the golden fixture's scenarios 2 (qty=4) and 3 (startSlot=2) exercise exactly the quantity/startSlot plumbing this fix protects, on a 2-column roll. Does not drive the confirm-dialog UI itself. |
| 6 | `9b85843` | 2026-08-07 | `release: CLICK 360 1.0.5 r30 stability` — version-coherence release bundling the above. | N/A (release marker, not a behavior). |
| 7 | `834dd17`, `d9b33f7` | 2026-08-07 | r31: consolidate the advanced label wizard and catalog/per-product print loop onto the single canonical print engine (`buildUniversalLabelPrintNode`). | Yes, structurally — the golden fixture is itself a direct caller of the now-canonical `buildUniversalLabelPrintNode`/`executeCanonicalLabelPrint` pair this work consolidated onto. |
| 8 | `356a430` (+ `03998d1` test) | 2026-08-07 | r32: fix a temporal-dead-zone crash that left the label preview blank. | No — TDZ is a load-order/parse-time bug, not something a runtime document/print-flow fixture like Part A's can exercise. Stays covered only by `qa/r32-legacy-template-preview-e2e.mjs` / `qa-r32-tdz-regression.cjs`. |
| 9 | `c71a640` (+ `ae985a4` test) | 2026-08-07 | r33: stop a stale `mediaWidthMm`/`mediaHeightMm` (leftover A4 sheet value) from becoming the printed `@page` size on a single-column roll profile. | Yes, directly — same `universalMediaSize()` function; the golden fixture proves the analogous computation is correct for the 2-column case that r33's own test (`legacy_profile_2col` scenario) deliberately left BLOCKED rather than validated end-to-end. Part A closes that specific gap. |
| 10 | `7868c2f` | 2026-08-07 | Merge of the r33 hotfix PR into `main` — this is the HEAD this recovery branch was cut from. | N/A (merge marker). |

## Gaps the golden fixture does NOT close (left for future work, not attempted here)

- No UI-level (click-through) coverage of the quick-print button, the confirm dialog, or the
  advanced label wizard — Part A drives the print engine functions directly, same as the existing
  r33 fixtures do, not the DOM controls in front of them.
- No coverage of the TDZ class of bug (item 8) — that requires a script-load-order regression test,
  not a document/print-flow test.
- No coverage of PDF export specifically for the 2-column 40x60mm roll (existing
  `qa/printing-service-pdf-e2e.mjs` covers PDF generically; it was not extended here for this
  physical profile).
- The `mediaWidthMm:82` figure is confirmed by a committed regression test
  (`qa-stability-label-r29.cjs`), not by a measurement taken from the physical 3nStar LTT214 /
  4BARCODE 4B-2054L unit itself — see the provenance comment in
  `qa/fixtures/golden-shary-2col-40x60.html` for the full chain of evidence and what remains
  ASSUMED, NOT CONFIRMED (the printer/driver model names themselves, and the exact on-label object
  layout coordinates).

## Recommended next step (not performed in this branch)

Before any future deploy that touches the label print pipeline, run `npm run qa:r34` alongside the
existing `qa:r30`/`qa:r31`/`qa:r32`/`qa:r33` gates, and add a UI-level (Playwright click-through)
test for the quick-print button and confirm dialog specifically, since that remains the one
production entry point none of the current fixtures — including this one — drive end-to-end from a
real button click.
