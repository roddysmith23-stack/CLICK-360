# CLICK 360 P2 Universal Label Canvas

Status: `READY_FOR_UNIVERSAL_LABEL_CANVAS_REVIEW`

## Scope

This candidate adds a universal label canvas without changing Firebase, Auth, Rules, customer records, or production. The existing Smart Print Wizard remains available as **Asistente avanzado**.

## Physical Contract

The canvas, sheet preview, browser print, and PDF use the same `buildSheetPlan` result. Visual zoom only changes editor pixels; the plan keeps paper, gaps, margins, position, and quantity in millimeters. Exact quantity never depends on stock unless the existing explicit stock option is selected.

## Canvas

`universal-label-canvas.js` supplies a deterministic document model for paper, QR, barcode, name, price, SKU, and text objects. It supports normalized dimensions, rotation, lock state, duplicate, alignment, bounded undo/redo, quantity, and starting slot. Templates, paper profiles, printer profiles, and calibration remain scoped by the existing UID/business/device storage keys.

The provisional two-column 40 x 60 mm / 203 DPI preset is generic. It contains no customer name, printer identity, or driver identity. The measurement assistant and X/Y calibration remain per business and device; width, gap, and pitch need physical measurement before certification.

## PDF Reliability

The PDF provider verifies renderable content, waits for image decoding, font readiness, and render frames, and returns a specific error if a resource is empty or cannot load. A timeout is only a bounded failure guard, not the readiness signal.

## QA And Rollback

`node qa-p2-universal-label-canvas-harness.cjs` covers geometry, start position, exact quantity, history, duplicate, alignment, loading order, and generic-profile isolation. Browser and physical-printer certification remain required before release. Revert this branch's commits for rollback; no cloud data changes occur.
