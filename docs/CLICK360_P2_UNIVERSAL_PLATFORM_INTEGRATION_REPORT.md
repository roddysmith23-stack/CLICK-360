# CLICK 360 P2 Universal Platform Integration Report

## Purpose

This branch is a non-production integration candidate. It combines the PWA/Admin dependency boundary, Universal Label Canvas, platform modules and workers, advanced restaurant operations, and logistics routes/settlement without merging or deploying any production change.

## Candidate composition

- Base: `architecture/p2-web-admin-dependency-boundary`.
- Candidate merges: platform/workers, restaurant advanced, logistics, and Universal Label Canvas.
- All new feature flags remain disabled in the legacy state seed: `workerAccessEnabled`, `restaurantAdvancedEnabled`, and `logisticsEnabled`.
- No component calls Firebase production, Auth, OAuth, Rules deployment, Cloud Run, `accountAccess`, claims, or a real `businesses/*/state/main` document.

## Isolation contract

Every new record remains scoped by `businessId`. The domain harnesses reject cross-business restaurant merges, vehicle/route mismatches, unassigned route sellers and collectors, forged worker identities, revoked memberships, and owner escalation. The integration harness confirms that the domains coexist without sharing mutable business state.

The integration pass also corrected a resolver mismatch: a non-owner/non-admin could not receive team permissions, but the raw worker module flag still read as enabled. The resolver now disables `workers` for those roles and reports `workers_role_denied`, matching the navigation and permission contract.

The legacy Firestore emulator suite continues to validate the existing tenant boundary. It deliberately does not claim that P2 local candidates have been released as a Firestore Rules schema; a future approved release must add server/rules persistence before enabling these flags outside synthetic QA.

## QA executed in this branch

```sh
npm ci
npm run qa
npm run qa:rules
npm run qa:simulator:quick
npm run qa:simulator:full
npm run qa:workers:e2e
npm run qa:restaurant:e2e
npm run qa:logistics:e2e
npm run qa:module-visuals:e2e
npm run qa:labels:e2e
node qa-p2-universal-platform-integration-harness.cjs
npm run build:static
npm audit --omit=dev --audit-level=moderate
```

The label browser suite exercises Chromium and WebKit at 320, 360, 390, 430, 768, 1024, 1366, and 1440 pixels. It verifies mouse/touch interaction, resize, rotate, undo/redo, profile persistence in the synthetic fixture, exact quantity, start position, non-empty QR output, non-empty two-page PDF, and no horizontal overflow. The separate module visual suite exercises the synthetic team, restaurant, and logistics screens at the same widths in Chromium and WebKit, including their principal interactive controls and browser error capture.

## Deliberate limits

- A physical printer smoke, including the provisional 40 x 60 mm / two-column / 203 DPI calibration, is still required. No hardware certification is claimed.
- Authentication, real Firestore Rules, production persistence, and financial accounting integration were intentionally not exercised because this work is prohibited from touching real Firebase or customer data.
- The separate administrative tools package remains transparently audited in the dependency-boundary candidate. The web production surface audit passes with `--omit=dev`; no administrative vulnerability has been hidden or reclassified.

## Rollback

This is an isolated Draft candidate. Close the integration PR or revert its merge commits on this branch. No Firebase resource, customer record, production Hosting release, or production Rule set requires rollback.

## Review decision

`READY_FOR_OWNER_REVIEW` is permitted only as a code and synthetic-QA decision. It is not a release approval, production deployment authorization, or physical printer certification.
