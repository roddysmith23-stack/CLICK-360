# CLICK 360 Phase 3.3 — Production Pilot Readiness

## Scope and safety

- Branch: `stabilization/1.0.5-stability-operations`, PR #60 (OPEN, DRAFT).
- Pilot Release Candidate: frozen at the HEAD this phase built on top of, `39f0df25bd460ae8fc4727241d74884db68bf14a`; this phase's own commit is layered on top of it on the same branch (see PR #60 for the exact current HEAD).
- `click-360` (production) was not touched: no deploy, no migration, no activation. Every live test in this phase ran against `click360-staging-7620168025` only.
- `main` was not touched.
- **`scripts/config/pilot-authorized-tenants.json` is empty.** No production tenant can be activated until a human adds a reviewed, git-committed entry there — this is the actual, technical "we have not started the pilot" state, not just a policy statement.

## What Phase 3.3 built

### 1. Staging-only dependency audit (fixed, not just documented)
- `worker-data-boundary.js`'s `assertNonProductionProject()` used to hard-block the **client gateway** itself from ever running against `click-360`, unconditionally. Renamed to `assertValidGatewayProject()` and now only rejects an empty projectId — the real, unbypassable gate for production is `firestore.rules`' `businessUnitReady()` (which already requires the per-tenant flag), re-checked client-side by `applyWorkerBoundaryIdentity()` before the gateway is ever constructed. Without this fix, no real worker in a pilot-enabled production tenant could ever have logged in.
- `app.js`'s `workersView()`/`bindWorkers()` used a static, project-only `WORKER_TENANT_ACCESS_ENABLED` computed once at boot, which would have kept the "Registrar Trabajador" form hidden for every production owner even after their tenant was explicitly enabled. Now re-checked dynamically per-owner at render time via the new `window.click360CurrentOwnerWorkersEnabled`.
- `worker-boundary-migrate.mjs` and `worker-boundary-repair-identity.mjs` used to hard-reject `click-360` entirely. Both now support production, gated by the new pilot-authorization allowlist (below) plus environment-specific `--confirm` strings.
- **Real bug found and fixed in the process:** `worker-boundary-migrate.mjs` validated `payload.identity.businessId` against the *modular business-unit id* (`--business`, e.g. `"business-alpha"`), but the real P0 identity convention used everywhere else in the codebase (every login/invitation path in `firebase-service.js`) is that `payload.identity.businessId` is always self-referential (`=== ownerUid`). This masked itself in Phase 3.1 only by coincidence (a seeding bug happened to make both sides agree); a fresh tenant with a *correctly* seeded root identity hit `SOURCE_IDENTITY_MISMATCH` and could not be migrated at all. Fixed to validate against `ownerUid`, matching the real, live convention. Verified end-to-end against a fresh staging tenant (`qa-owner-p33`) that only worked correctly after this fix.

### 2. Production-capable scripts with independent per-tenant authorization
`scripts/lib/pilot-authorization.mjs` + `scripts/config/pilot-authorized-tenants.json`: every script that can touch `click-360` (`worker-boundary-migrate.mjs`, `worker-boundary-repair-identity.mjs`, `worker-boundary-admin.mjs`, and transitively the activate/deactivate commands below) calls `assertTenantAuthorizedForProduction(projectId, ownerUid, businessId)` **before any Firestore access at all, including read-only dry-runs and `status`**. This is independent of, and in addition to, each script's own environment-specific `--confirm` string (e.g. `APPLY_PRODUCTION_WORKER_BOUNDARY` vs `APPLY_STAGING_WORKER_BOUNDARY`). There is no wildcard entry format — only an exact `ownerUid`+`businessId` pair passes — so neither a mistaken `--confirm`, a copy-pasted command, nor a future batch/loop can ever reach an unauthorized tenant or become a mass operation. Adding an entry is a deliberate, reviewed, git-committed change made only after Mr. Smith has explicitly approved that one customer.

### 3. Preflight (GO/NO-GO)
`scripts/worker-boundary-preflight.mjs --owner <uid> --business <id> [--project <id>]` — read-only, 12 checks: identity, schema, state/main, modules, Auth, seats, existing workers, **deployed** Firestore rules (fetched live via the Firebase Rules REST API, not just the local file — `scripts/lib/firestore-rules-remote.mjs`), stock, cash, invitations, rollback possibility. Live-verified against real staging data: correctly returns `GO` for a healthy tenant and `NO-GO` with the exact blocking checks for a nonexistent one.

### 4. Single-command activation (cannot skip steps)
`scripts/worker-boundary-activate-tenant.mjs --owner <uid> --business <id> [--project <id>] --confirm ACTIVATE_STAGING_TENANT|ACTIVATE_PRODUCTION_TENANT`

Runs, hard-sequenced, aborting immediately on the first failure: **preflight → evidence (written before any mutation) → identity repair (only if needed) → migrate dry-run → migrate apply → promote → enable the per-tenant flag → reduced structural smoke**. Live-verified end-to-end against a fresh staging tenant, including the repair branch (`result: "ACTIVATED"`, all 7 steps `PASS`).

### 5. Single-command rollback (inverse order, state/main always preserved)
`scripts/worker-boundary-deactivate-tenant.mjs --owner <uid> --business <id> --reason "<why>" --confirm DEACTIVATE_STAGING_TENANT|DEACTIVATE_PRODUCTION_TENANT [--rollback-modular]`

**Flag OFF first** (immediate, unbypassable at the rules layer — this alone fully hides the module) → evidence → optional modular rollback (`businessUnits.status = ROLLBACK_ONLY`, only for suspected data corruption, `state/main` untouched). Live-verified end-to-end against the same staging tenant (`result: "DEACTIVATED"`).

### 6. Admin dashboard/checklist
`scripts/worker-boundary-admin.mjs --action dashboard [--project <id>]` — one row per tenant (Workers ON/OFF, seats included/add-on/used, `businessUnitStatus`). Staging discovers tenants automatically (safe, no real data); production **only ever reports on tenants already in the pilot allowlist** — it can never become a broad scan of real customer data. `--action status --owner <uid> --business <id>` gives the single-tenant view (also shows last activation/rollback via `activationLog`).

### 7. Manual seat-sale flow (no automated checkout, by design)
Owner clicks "Solicitar cupos adicionales" (Phase 3.2 UI) → writes an immutable `businesses/{ownerUid}/seatRequests/{id}` → **AIIA confirms payment externally** → `worker-boundary-admin.mjs --action fulfill-seat-request --owner <uid> --request <id> --seats <N> --confirm FULFILL_SEAT_REQUEST_*_TENANT` applies the add-on seats **and** marks the request `fulfilled` with `fulfilledBy`/`fulfilledAt` in the same call — one audited action, no separate bookkeeping step to forget.

### 8. Telemetry, alerts, and success metrics
Two new event types added on top of Phase 3.2's six: `worker_migration_failed` (any activation step failure) and `worker_rollback_executed` (every rollback, success or failure of a rollback step). `scripts/worker-boundary-monitor.mjs --owner <uid> --business <id> [--since-hours 72]` reads `telemetryEvents` for the window and produces:
- **Alerts** (severity P0/P1/INFO) for any of the 8 event types present.
- **48-72h success-criteria numbers** for that tenant: successful/failed logins, accepted/failed invitations, worker operations, P0/P1 error counts, stock errors, cross-tenant attempts, rollbacks executed, and a single `meetsSuccessBar` boolean (`true` iff zero cross-tenant attempts, zero stock errors, zero rollbacks, zero migration failures in the window).

There is no push/real-time alerting pipeline yet — this is a pull-based report to run periodically during the observation window (recommended: at +2h, +24h, +48h, +72h per activated tenant).

## Commercial rule (unchanged, re-confirmed live this phase)
Owner consumes 0 seats. 2 workers included per business. 3rd+ requires a purchased, parametrizable add-on (no price hardcoded anywhere). Revoking a worker returns its seat to the pool. No tenant ever shares seats with another — all enforced server-side in `firestore.rules`, verified again by the full emulator regression suite this phase (0 fails).

## QA
`npm run qa` (full local suite) and `npm run qa:rules` (real Firestore emulator) both green throughout this phase, after every change, including three new emulator regression blocks (rollout flag, seat requests + activation log, modular telemetry) and one new pure-function block (`workersEnabledForTenant`, `assertValidGatewayProject`). All new production-capable scripts additionally live-tested against real staging data (preflight GO and NO-GO cases, full activate → deactivate round-trip, dashboard, monitor/alerts) — see this phase's session for exact command transcripts.

## Data Mr. Smith needs to provide to select the first 1-3 pilot customers

For **each** candidate customer:
1. **Exact `ownerUid`** (their real Firebase Auth UID in `click-360`) — not the email; the UID is what goes in the allowlist and every script.
2. **Exact `businessId`** — the id already used in that owner's `payload.data.businesses[].id` for the one business being piloted (if they have more than one business, which one starts first).
3. **A way to reach the owner directly** during the observation window (phone/WhatsApp/email) — not for us to log into their account, but so they can report anything odd immediately and so we can ask them to try specific actions (invite a worker, make a sale) at a known time.
4. **Confirmation the owner has already been told** they're joining an early pilot of the Workers feature, and is comfortable adding 1-2 real workers during it (not their busiest days).
5. Optional but useful: whether the business type enables restaurant/logistics modules (affects which parts of the smoke test are relevant).

## Client selection matrix (recommendation)

**Start with active-but-controllable, not the most complex.** Concretely, prefer customers who:

| Favor | Avoid for the first 1-3 |
|---|---|
| Moderate daily sales volume (enough real activity to observe, not so much that an issue compounds fast) | The single highest-revenue or highest-transaction-volume account |
| Already asked for or would clearly benefit from worker accounts (motivated, forgiving of early rough edges) | An account with a support history of complaints/escalations |
| Simple business type: retail/pos, no restaurant/logistics modules | Restaurant (KDS) or Logistics tenants — more moving parts, save for pilot round 2 once Workers itself is proven |
| Owner is reachable and responsive (can confirm things quickly during the 48-72h window) | An owner who is hard to reach or in a very different timezone from support availability |
| Willing to invite exactly 1-2 real workers first (not immediately maxing out at the free 2 + testing the paid add-on same day) | An owner who would immediately need 3+ workers (adds the seat-purchase flow into the first test instead of isolating it) |

Stagger activation: do **not** activate all 1-3 simultaneously the first time — one at a time, each with its own 48-72h observation window, so an issue with customer #1 is caught and fixed before #2 is exposed to it (documented in Phase 3.2's rollout doc, re-confirmed here).

## Exact activation sequence for the first real tenant (when approved)

1. Mr. Smith provides the data above for customer #1.
2. A human reviews and adds `{ ownerUid, businessId, authorizedBy, authorizedAt, notes }` to `scripts/config/pilot-authorized-tenants.json["click-360"]`, commits it.
3. Deploy `firestore.rules` to `click-360` for the first time with the Workers rollout mechanics (additive only — does not change any existing non-Workers rule behavior; every other tenant stays exactly as it is today since the flag defaults closed).
4. `node scripts/worker-boundary-preflight.mjs --owner <uid> --business <id> --project click-360` — confirm `GO`.
5. `node scripts/worker-boundary-activate-tenant.mjs --owner <uid> --business <id> --project click-360 --confirm ACTIVATE_PRODUCTION_TENANT`.
6. Recommended (not automated): one real browser login as the owner (their own real Google login, not something this tooling does for them) to visually confirm the "Trabajadores" tab and seat status render correctly.
7. Owner invites 1-2 real workers.
8. `node scripts/worker-boundary-monitor.mjs --owner <uid> --business <id> --project click-360 --since-hours 2` (and again at 24h, 48h, 72h) — confirm `meetsSuccessBar: true` and no unexpected alerts.
9. If anything goes wrong at any point: `node scripts/worker-boundary-deactivate-tenant.mjs --owner <uid> --business <id> --project click-360 --reason "<why>" --confirm DEACTIVATE_PRODUCTION_TENANT` — immediate, `state/main` untouched, customer's legacy flow keeps working without interruption.

## Remaining blockers before the first real tenant (all human/process, not technical)

1. **`scripts/config/pilot-authorized-tenants.json` is empty** — needs Mr. Smith's customer selection + a reviewed commit.
2. **`firestore.rules` has never been deployed to `click-360`** — a deliberate, one-time step that must happen after step 1, before step 4 above can even run (preflight's `rules` check will correctly report `NO-GO` against production until this happens).
3. No customer has been told they're in a pilot yet (see data request above).

Nothing else is missing technically: preflight, activation, rollback, dashboard, telemetry/alerts, and the commercial seat rule are all built, live-tested against staging, and behind independent, exact-tenant authorization for production.
