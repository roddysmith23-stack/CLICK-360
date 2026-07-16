# CLICK 360 V16.2 P0 - Official Access and Login Loop Report

Date: 2026-07-16

Branch: `hotfix/p0-login-loop-official`

Release label: `1.0.2-p0`

Build cache: `mvp-launch-v16-2-p0-r2`

Canonical URL: `https://click-360.web.app/`

## Current Verdict

`1.0.1-p0` is **NOT_READY_LOGIN_LOOP**.

Observed production behavior: after selecting a Google account on iPhone, CLICK 360 returns from Google, briefly shows "Validando seguridad..." and falls back to the public landing instead of crossing to the dashboard.

`1.0.2-p0` is the corrective candidate and must not be marked READY until a real authenticated login crosses to the dashboard.

## Scope

This corrective hotfix intentionally contains only:

- same-origin Firebase Auth redirect helper for the official Hosting URL;
- explicit redirect-result diagnostics and visible login-gate error codes;
- removal of automatic pre-login `signOut()`;
- cache/version bump for the official Firebase Hosting release.

No V17 modular architecture, Cloud Run, staging, Control Center expansion, commercial-module refactor, data migration, or client data modification is included.

## Diagnosis

The official app was served from `https://click-360.web.app/`, but Firebase Auth used `authDomain: click-360.firebaseapp.com`. On iOS and Brave this redirect helper can lose the returned Auth session because the helper and app are on different browser storage partitions.

The client also did not call `getRedirectResult()` before treating a null Auth state as unauthenticated, so the customer saw the public landing again without a visible diagnostic code.

## Implemented Fixes

- Uses `authDomain: click-360.web.app` when the app is opened on the official URL, preserving redirect state in iOS/Brave.
- Calls `auth.getRedirectResult()` during boot when a redirect login is pending.
- Shows visible support codes instead of silently returning to the landing:
  `AUTH_REDIRECT_NO_RESULT`, `AUTH_USER_NULL_AFTER_REDIRECT`, `AUTH_PERSISTENCE_FAILED`, `AUTH_ACCOUNT_NOT_FOUND`, `AUTH_ACCESS_REJECTED`, `AUTH_APPROVED_USERS_REJECTED`, `AUTH_ACCOUNT_ACCESS_REJECTED`, `FIRESTORE_PERMISSION_DENIED`, `BOOTSTRAP_PREPARE_FAILED`, `BOOTSTRAP_CREATE_FAILED`, `UNKNOWN_LOGIN_GATE_FAILURE`.
- Keeps existing sessions while starting Google login; explicit logout/change-account remains available.
- Added release label `1.0.2-p0` and build SHA injection during static build.
- Bumped service worker, runtime guard, manifest and asset query version to `mvp-launch-v16-2-p0-r2`.

## Verification Before Deploy

| Area | Result | Evidence |
| --- | --- | --- |
| Static QA | PASS | `npm run qa` |
| Firestore Rules emulator | PASS | `npm run qa:rules` |
| Auth domain same-origin | PASS | Regression harness verifies `click-360.web.app` uses same-origin `authDomain` |
| Redirect result handling | PASS | Regression harness verifies `getRedirectResult()` and redirect-pending marker |
| Visible error codes | PASS | Regression harness verifies login-gate codes |
| Public shell local smoke | PENDING | Must be rerun after build |
| Real authenticated login | PENDING | Must cross dashboard before READY |

Visual evidence is stored locally under `output/playwright/` and is intentionally not committed.

## Rollback Plan

Before publishing:

- record current Firebase Hosting live release and current Firestore Rules release;
- deploy Hosting and Rules from the same approved SHA;
- if post-deploy smoke fails, restore the previous Hosting live release and previous Rules release immediately.

## Status

Pre-deploy status: `NOT_READY_LOGIN_LOOP`

Final production status must be updated only after real authenticated login crosses to the dashboard.
