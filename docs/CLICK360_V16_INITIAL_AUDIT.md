# CLICK 360 V16 Initial Audit

Date: 2026-07-13

## Baseline

- Repository: `roddysmith23-stack/CLICK-360`
- Base branch: `main`
- Base commit: `9347108aa7d2a58ed3c43349e0746e79e5c478b6`
- Working branch: `feat/v16-commercial-beta`
- Published client before this mission: `mvp-launch-v15`
- Firebase / Google Cloud project: `click-360`

## Architecture

The client is a static PWA hosted from GitHub Pages. `app.js` contains the UI and domain workflows, `firebase-service.js` owns Google Auth, access resolution and Firestore synchronization, and `p0-tenant-guard.js` validates tenant identity and payload shape. Firebase compat libraries, QR, PDF and XLSX dependencies are vendored locally.

Business data is stored as one canonical document at `businesses/{ownerId}/state/main`. The V10 envelope contains `ownerUid`, `ownerId`, `businessId`, `tenantKey`, revision metadata and a payload with businesses, products, sales, movements, invoices, daily reports, tombstones, audit logs and settings.

## Production Inventory

Root collections observed in `click-360`:

- `approvedUsers`
- `approvedUsersByEmail`
- `accountAccess`
- `businesses`

The current audit contains three coherent V10 tenant snapshots and one blocked `CROSS_TENANT_SUSPECT` snapshot (`demo-click360`). `demo-click360` is excluded from every migration and client tenant path.

## Shary Account

The exact account `shary10mmvv@gmail.com` was located in Firebase Auth by UID. It is enabled, uses Google as provider and has a recent successful sign-in. There is no Auth account or access record for the misspelled one-v address.

Current state for the correct UID:

- no `approvedUsers` record;
- one self-service `accountAccess` record with `status: trial` and `plan: normal`;
- no canonical `businesses/{uid}/state/main` document;
- no membership document;
- no existing cloud business payload to migrate or overwrite.

The reported initial-local-copy gate is therefore reproducible from the current bootstrap: a new authorized account must synchronously persist the seed in localStorage before the first cloud write. Quota denial, blocked localStorage or serialization failure returns false and leaves the account blocked even while Auth and Firestore are available.

## Browser Storage

- Full tenant state is duplicated in `localStorage` under a tenant-key namespace.
- Sessions and approval caches are UID namespaced.
- Legacy and quarantine markers are tenant scoped and reconciled only after a coherent V10 remote read.
- Firebase enables multi-tab IndexedDB persistence, but the app does not maintain an explicit large-snapshot IndexedDB store.
- Images are compressed but remain embedded as base64 in the tenant snapshot.
- The Service Worker caches only same-origin assets; Auth and Firestore requests are network-only.

## Access And Rules

Existing founders and manually active accounts resolve through `approvedUsers` or `accountAccess`. Trial start uses a Firestore server timestamp and expires after seven days. Expired trials retain read access.

Current worker access is still tied to `approvedUsersByEmail`. Invitation tokens are stored directly, have no enforced expiry or single-use transition, and worker authorization ultimately permits writes to the complete tenant snapshot. Module/action permission boundaries are not enforced by Firestore Rules.

## Reproduced Functional Gaps

- A valid online account can be blocked solely by local persistence failure.
- There is no `ONLINE_ONLY_SAFE` runtime state or retry control.
- The unauthenticated gate is not a complete commercial landing page.
- Activation requests and versioned legal acceptances do not exist.
- The label editor saves `social`, but the canvas and print renderer never draw it.
- Label elements cannot be independently moved, resized, hidden, layered or duplicated.
- Global tax is a percentage only; products and labels assume prices include VAT.
- Layaways store only a partial payment and due date; immutable policy acceptance is missing.
- Cash closing has totals but lacks a normalized, auditable session snapshot with complete method/customer detail.
- Worker links are not safely recoverable, expiring, single-use or permission scoped.
- Header clock, notification bell and accessible account menu are missing.
- Terms, privacy and acceptable-use screens are missing.
- Every business edit rewrites the complete tenant snapshot, increasing conflict and cost risk.

## Migration Strategy

1. Keep the V10 tenant envelope and add only backward-compatible fields and settings arrays.
2. Make verified remote V10 authoritative before any local cache is loaded.
3. Add an idempotent online-only fallback when local persistence is unavailable.
4. Add explicit entitlement, activation, membership, invitation and legal-acceptance contracts with deny-by-default rules.
5. Normalize only the exact Shary UID after Auth, access and state preconditions are re-read; create an administrative backup before entitlement changes.
6. Never derive ownership from email and never touch `demo-click360`.
7. Verify hashes, identity and domain counts before and after every administrative operation.

## Primary Risks

- Full-document synchronization remains a concurrency and Firebase-cost risk.
- Worker permissions require nested-diff rule coverage until entity collections replace the monolithic snapshot.
- OAuth behavior in embedded iOS browsers cannot be made reliable; the safe path is explicit handoff to Safari or Chrome.
- Physical iPhone and Android PWA behavior needs a real-device smoke after automated browser and responsive tests.
- Payment activation remains administrative; the public client must never grant itself a paid plan.
