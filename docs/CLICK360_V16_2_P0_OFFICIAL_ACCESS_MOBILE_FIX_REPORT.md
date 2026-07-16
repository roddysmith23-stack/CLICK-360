# CLICK 360 V16.2 P0 - Official Access and Mobile Fix Report

Date: 2026-07-16

Branch: `hotfix/p0-official-access-and-mobile-fixes`

Release label: `1.0.1-p0`

Build cache: `mvp-launch-v16-2-p0-r1`

Canonical URL: `https://click-360.web.app/`

## Scope

This hotfix intentionally contains only:

- first-tenant bootstrap recovery for valid online accounts whose `businesses/{uid}/state/main` does not exist;
- PRO Lifetime compatibility in source Firestore Rules, matching the limited live hotfix and rejecting malformed `pro_lifetime` records from the generic active paid branch;
- mobile layout correction for "Nuevo recordatorio";
- separated Galeria and Tomar foto image inputs for products and supplier invoices;
- cache/version bump for the official Firebase Hosting release.

No V17 modular architecture, Cloud Run, staging, Control Center expansion, commercial-module refactor, data migration, or client data modification is included.

## Diagnosis

The first bootstrap path could still depend on the normal local mutation path. That path is guarded by the authenticated mutation state, so a valid account with no remote tenant and limited local storage could be blocked before the canonical transaction created `state/main`.

The source `firestore.rules` did not include the limited PRO Lifetime clause already deployed live, creating source/live drift.

On small mobile widths, the reminder date-time control could force horizontal overflow. Product and invoice image capture needed stricter separate controls so Galeria never inherited camera capture behavior.

## Implemented Fixes

- Added `click360PrepareInitialTenantState()` to prepare and validate the initial tenant snapshot without calling `save()`.
- Updated bootstrap decision logic to require a prepared snapshot, then permit local, IndexedDB, or online-only safe creation.
- Added source Rules support for active PRO Lifetime:
  `status == active`, `lifetime == true`, `plan == pro`, `planCode == pro_lifetime`, `billingStatus == lifetime`.
- Blocked malformed `planCode == pro_lifetime` from passing through the generic active paid branch.
- Replaced the single reminder `datetime-local` control with separate `date` and `time` inputs inside a responsive grid.
- Replaced label-wrapped image inputs with independent buttons and inputs:
  Galeria uses `accept="image/*"` with no `capture`; Tomar foto uses `accept="image/*"` and `capture="environment"`.
- Added release label `1.0.1-p0` and build SHA injection during static build.
- Bumped service worker, runtime guard, manifest and asset query version to `mvp-launch-v16-2-p0-r1`.

## Verification Before Deploy

| Area | Result | Evidence |
| --- | --- | --- |
| Static QA | PASS | `npm run qa` |
| Firestore Rules emulator | PASS | `npm run qa:rules` |
| PRO Lifetime first tenant | PASS | Emulator: `pro-lifetime-first` can create only `businesses/pro-lifetime-first/state/main` |
| Malformed PRO Lifetime | PASS | Emulator rejects `bad-pro-lifetime` |
| Demo tenant | PASS | Emulator rejects client writes to `demo-click360` |
| Reminder mobile layout | PASS | Chromium Android + WebKit iPhone at 320, 360, 390, 430 px: no horizontal overflow |
| Galeria contract | PASS | `capture == null`, `accept == image/*`, independent input/button |
| Tomar foto contract | PASS | `capture == environment`, `accept == image/*`, independent input/button |
| Public shell local smoke | PASS | Chromium and WebKit: HTTP 200, title OK, versioned scripts, no console errors |

Visual evidence is stored locally under `output/playwright/` and is intentionally not committed.

## Rollback Plan

Before publishing:

- record current Firebase Hosting live release and current Firestore Rules release;
- deploy Hosting and Rules from the same approved SHA;
- if post-deploy smoke fails, restore the previous Hosting live release and previous Rules release immediately.

## Status

Pre-deploy status: `READY_FOR_OFFICIAL_RELEASE_CANDIDATE`

Final production status must be updated only after PR, CI, Rules deploy, Hosting deploy, and official smoke are complete.
