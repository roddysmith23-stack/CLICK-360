# CLICK 360 1.0.5 Commercial Release Candidate

## Release Identity

- Version: `1.0.5`
- Asset and Service Worker cache: `commercial-1-0-5-r1`
- Branch: `release/p2-web-safe-no-data-migration`
- Deployment status: not deployed
- Production remains on the previously approved release.

## Commercial Scope

This candidate preserves the proven CLICK 360 core: authentication, tenant
isolation, dashboard, inventory, sales, cash, reports, multi-business, PWA,
scanner, Mesas Lite, finance tools, help, and the existing advanced label
assistant.

The Universal Label Canvas becomes the primary label experience. It supports
physical millimetres, QR, barcode, product fields, text, image, pointer and
touch editing, resize, rotation, layers, lock, alignment, grid, snap,
undo/redo, templates, exact quantity, starting slot, paper/device profiles,
calibration, system print, and PDF. The former flow remains available as
`Asistente avanzado`.

## Deliberately Gated

Workers P2, Restaurant Advanced, Logistics, and the Owner Preview remain off.
Their current implementations are local/synthetic and do not yet provide the
approved multiuser backend, record-level Rules, or authenticated cross-device
transactions. Existing workers and Mesas Lite behavior are not removed.

These modules must not be advertised as active commercial capabilities in
1.0.5. Turning them on would create a product reliability and authorization
risk, not a harmless preview.

## Data Safety

- No Firebase deployment is part of this candidate.
- No Rules, Auth, OAuth, claims, Functions, or account access are changed.
- No migration is executed.
- No direct administrative write to `businesses/*/state/main` is introduced.
- Explicit label template/profile changes use the existing guarded tenant save
  contract. They do not bypass UID, tenant, conflict, or remote verification.
- Device calibration is stored under the existing UID, tenant, business, and
  device namespace. Shared business profiles no longer absorb device offsets.

## Security Boundary

The static build allowlist excludes `tools/admin`, Node dependencies,
credentials, fixtures, migrations, and Firebase Admin SDK. The root production
audit must report zero vulnerabilities. Administrative tooling has its own
install, lockfile, fixture QA, and unsuppressed audit.

Administrative scripts are fixture-first. A live connection requires an
explicit `--project click-360` and a literal environment acknowledgement. A
write requires a second, separate acknowledgement in addition to the existing
identity, hash, backup, and confirmation checks.

## Required Evidence

The release gate requires:

1. root install and full QA;
2. Firestore Rules emulator regression;
3. quick and full business simulators;
4. Universal Label Canvas Chromium/WebKit E2E;
5. responsive Chromium/WebKit/Firefox E2E from 320 to 1920 px;
6. real html2pdf output with non-zero content;
7. built `dist` Chromium/WebKit smoke with release, manifest, console, and
   request verification;
8. production dependency audit;
9. static secret and admin-dependency scans;
10. physical printer calibration and QR scan before commercial certification.

## Local Verification - 2026-07-28

| Gate | Result | Evidence |
| --- | --- | --- |
| Core and regression QA | PASS | Isolation, Auth/access contracts, inventory, sales, cash, reports, scanner, Mesas Lite, PWA, sync recovery and label regressions passed. |
| Firestore Rules | PASS | Emulator-only positive and negative tenant, invite, trial and first-tenant tests passed. Expected denied operations remained denied. |
| Business simulator | PASS | Quick: 240 actions and 20 reports. Full: 2,600 actions and 100 reports. |
| Universal Label Canvas | PASS | Chromium mouse editing and WebKit touch editing; exact quantity, starting slot, profile/calibration and isolation assertions passed. |
| PDF | PASS | Real `html2pdf` output: 63,797 bytes, two pages, rasterized first page nonblank and QR area nonblank. |
| Responsive | PASS | Chromium, WebKit and Firefox at 320, 360, 375, 390, 414, 768, 820, 1024, 1280, 1366, 1440 and 1920 px. No horizontal overflow; primary actions remained visible. |
| Built artifact | PASS | Chromium and WebKit loaded `dist`, verified version, asset identity, injected SHA, manifest, Service Worker cache, same-origin resources and zero unexpected console errors. |
| PWA production dependency audit | PASS | `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities. |
| Static boundary | PASS | No `firebase-admin`, `google-gax`, private key marker or live-admin acknowledgement in `dist`. |
| Admin fixture QA | PASS | Synthetic audit/migration dry-runs and live-safety guard tests passed without ADC or Firebase production. |

Browser automation uses exact stable `playwright@1.62.0`. The experimental
`@playwright/cli` dependency and its alpha `playwright-core` chain were removed.

## Dependency Disclosure

The web production surface is clean. Two non-production surfaces remain visible
and unsuppressed:

- root development tooling: 21 findings (15 high, 6 moderate), inherited through
  `firebase-tools` and related CLI dependencies;
- isolated `tools/admin`: 11 findings (5 high, 6 moderate), including the
  `firebase-admin` / `google-gax` chain.

No `--force`, override, downgrade, release candidate, audit suppression or
`continue-on-error` is used. Administrative live use remains blocked by its
security job and explicit runtime acknowledgements.

## Rollback

The source rollback target is
`58b3f8558c639a534a2c5e3b2da65f4e88e7ce60`. A future, separately approved
Hosting-only deployment can be rolled back by rebuilding that SHA and deploying
only Hosting. The rollback never deploys Rules or Functions and never mutates
Firestore.

## Decision

Until automated CI for the candidate commit and physical printer smoke both
pass:

`NO_GO_COMMERCIAL_RELEASE`

The maximum valid intermediate decision is:

`READY_FOR_COMMERCIAL_RC_REVIEW`
