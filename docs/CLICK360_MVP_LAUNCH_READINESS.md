# CLICK 360 MVP Launch Readiness

Version: `mvp-launch-v14`

## Decision model

This release is safe to publish for a private beta when CI, the Firestore rules emulator, the deployed rules, and GitHub Pages all match this commit. No client-data migration is part of this release. `demo-click360` remains a protected `CROSS_TENANT_SUSPECT` tenant and is never read, changed, or unlocked by the application.

## V10 reconciliation

After Google authentication establishes the current owner and tenant context, CLICK 360 reads `businesses/{ownerId}/state/main` before loading a business cache. A remote document is authoritative only when it has schema version 10, canonical owner fields, tenant key, and a valid payload.

For that verified V10 tenant, `reconcileLocalStateWithRemoteV10()` removes only exact tenant markers and fully identified quarantine records for that UID and tenant. It is idempotent. Global or ambiguous legacy records are preserved and cannot block a verified V10 tenant. A legacy remote document stays blocked and cannot push, seed, edit, sell, delete, or synchronize.

## Access lifecycle

- Existing approved owners are founders and retain full access without a paywall.
- A new UID can create exactly one self-service trial in `accountAccess/{uid}`.
- The trial starts and is evaluated with Firestore timestamps, never the device clock.
- At seven days, the same tenant is readable but `save()` and cloud push are blocked.
- An administrator activates access by updating the existing `accountAccess/{uid}` document with `status: "active"` and `plan: "normal"`, `"pro"`, or `"founder"`. Preserve `uid` and the historical trial fields.
- The web client can update only its profile name and server `lastSeenAt`; it cannot change status or plan.

## Automated evidence

`npm run qa` verifies syntax, P0 tenant isolation, one hundred-account stress, legacy write blocking, V10 marker reconciliation, A -> B -> A for ten cycles, two-tab behavior, simulated phone reconnection, deletion persistence, one-trial-per-UID, founder/pro access, expired read-only behavior, financial integrity, and cache namespacing.

`npm run qa:rules` runs the Firestore emulator and verifies A/B isolation, workers, pending users, trial creation, server-time trial writing, expired read-only access, manual plan escalation denial, and explicit denial of `demo-click360`.

## Final authenticated smoke checklist

Use only the two existing legitimate Google accounts. Do not create, edit, sell, or delete real customer data.

1. Open `https://roddysmith23-stack.github.io/CLICK-360/?v=mvp-launch-v14` in a normal browser and confirm each legitimate account reaches its own Home view.
2. Sign out A, sign in B, then repeat A -> B -> A ten times. Confirm business name, route, cache indicator, and Firestore path remain account-specific.
3. Open a second tab for the same account, refresh one tab, and verify no other account data appears.
4. On a phone or responsive browser, install the PWA, open it offline after one successful authenticated load, reconnect, and confirm the sync badge recovers without cross-account data.
5. Verify an existing founder sees no purchase CTA. Use a non-founder test UID only if one already exists to verify the trial and expired-read-only screens.
6. Confirm `demo-click360` is not listed, loaded, or changed.

## Remaining P1 hardening

The current tenant snapshot is intentionally protected as one Firestore document. The next architecture step is a collection-per-entity model with a command layer and immutable sales ledger, so worker permissions can be enforced per operation rather than at the complete snapshot boundary.
