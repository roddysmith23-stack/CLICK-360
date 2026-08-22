# CLICK 360 Phase 3.2 — Workers Release Candidate & Gradual Rollout

## Scope and safety

- Branch: `stabilization/1.0.5-stability-operations` (PR #61 merged into it via merge commit `a7e416e`; PR #61 itself is `MERGED`, not a draft anymore).
- Release Candidate: `61c16af332077d5d147e1d73753f6f594351e0df` (verified in Phase 3.1: `PHASE_3_1_STAGING_VERIFIED`).
- Production project `click-360` was not touched in Phase 3.2. Every deploy, migration, and admin command in this phase targeted `click360-staging-7620168025` only.
- Nothing was merged to `main`. This phase is staging-only.
- `main` at `origin` remained at `7868c2f` throughout.

## What Phase 3.2 added on top of the Phase 3.1 RC

1. **Per-tenant Workers rollout flag** (`businesses/{ownerUid}/featureFlags/workers`, `{ enabled: boolean }`).
   Enforced at the single chokepoint every `businessUnits` rule already funneled through (`businessUnitReady()` in `firestore.rules`), so no per-rule duplication and no way to route around it from a modified client. Absence of the doc denies (default-closed); staging/demo projects stay always-enabled via the existing `enabledForProject()` project-level gate, unaffected.
   Client-side: `worker-data-boundary.js#workersEnabledForTenant(projectId, flagData)` mirrors the same logic for UI gating (`applyWorkerBoundaryIdentity`, and every owner-initiated Workers action in `firebase-service.js` via the shared `currentOwnerWorkersEnabled()` helper).
2. **Admin tool for AIIA**: `scripts/worker-boundary-admin.mjs` — `status | enable-workers | disable-workers | set-addon-seats`, each mutating action gated by a project-and-action-specific `--confirm` string. This is the *only* way to flip a tenant's Workers flag or change its purchased seat quota while there is no self-serve billing.
3. **"Trabajadores adicionales" owner screen**: a new card in the existing `workersView()` (Trabajadores tab) showing included/used/available seats, and a "Solicitar cupos adicionales" button. It does not purchase anything — it writes an immutable, owner-scoped request doc (`businesses/{ownerUid}/seatRequests/{id}`) that AIIA reviews and fulfills manually via the admin tool. This intentionally does not block rollout on billing automation.
4. **Telemetry**: `telemetryEvents` now accepts a modular tenant shape (`ownerId` field, separate from `businessId` which is the business-unit id) and six new diagnostic event types — `worker_invite_failed`, `worker_login_failed`, `worker_permission_denied`, `worker_stock_error`, `worker_cross_tenant_denied`, `worker_seat_exhausted` — plus `seat_request`. Diagnostic events intentionally bypass the tenant-membership proof other events require, because they fire *exactly when* that membership/permission check fails; requiring it would make the failure itself unreportable.
5. Two additional worker-boundary emulator regression suites (rollout flag, seat requests, modular telemetry) and one pure-function suite (`workersEnabledForTenant`), all run against the real Firestore emulator / rules engine, not mocks.

Everything above was live-verified against real staging Firestore + a real browser session (custom-token, no passwords) before being called done — see "Verification" below.

## Commercial rule (unchanged from Phase 3.1, re-confirmed)

- The owner never consumes a seat (owner access is via `businessUnitOwner()`, entirely separate from the `members` collection the seat counter tracks).
- 2 free active workers per business; the 3rd+ requires a purchased add-on seat.
- Enforced server-side (`firestore.rules`, `seatConsumedForSelf`/`seatReleased`), not only in the UI — a modified client cannot bypass it. See Phase 3.1 evidence for the exhaustive regression list (deny #3, +1 add-on allows #3, revoke frees a seat, no cross-tenant seat sharing, no standalone counter tampering).
- No price is hardcoded anywhere. `addOnSeats` is a bare integer quota; billing is a separate, later decision.

## Verification performed in Phase 3.2

- `npm run qa` (full local suite) and `npm run qa:rules` (real Firestore emulator) both green after every change, repeated at each step.
- Live on staging: backfilled `featureFlags/workers = { enabled: true }` for every previously-migrated staging QA tenant *before* deploying the new flag-gated rules (so nothing already verified in Phase 3.1 regressed), then redeployed `firestore.rules` + hosting.
- A background verification agent confirmed live, post-deploy, that the existing owner (`qa-owner-p31`) login still works end-to-end (custom-token sign-in, zero console errors, zero `permission-denied`) after the rules change.
- `scripts/worker-boundary-admin.mjs` exercised live against staging for all four actions (`status`, `enable-workers`, `disable-workers`, `set-addon-seats`), including the safety guard rejecting a call with no `--confirm`.

## Tenant-by-tenant migration process (for real customers, when the pilot is approved)

This reuses the exact scripts proven in Phase 3.1 against staging. Nothing here has been run against `click-360`; this is the documented process for when a human operator explicitly approves the pilot.

For one real tenant (`OWNER_UID` = the customer's real Firebase Auth UID, `BUSINESS_ID` = the specific business unit being migrated, normally the same id already used in `payload.data.businesses[].id` for that owner):

```sh
# 1. Repair the P0 legacy identity if payload.identity is missing (safe: only ever
#    touches payload.identity, never payload.data; fails closed on any root mismatch).
node scripts/worker-boundary-repair-identity.mjs \
  --owner $OWNER_UID --business $OWNER_UID --dry-run
# review output: must be DRY_RUN_REPAIR or DRY_RUN_NOOP with a canonical root
node scripts/worker-boundary-repair-identity.mjs \
  --owner $OWNER_UID --business $OWNER_UID --confirm REPAIR_STAGING_IDENTITY

# 2. Migration dry-run (zero writes, computes and prints the source hash).
node scripts/worker-boundary-migrate.mjs --owner $OWNER_UID --business $BUSINESS_ID
# review the plan and counts/totals against the owner's real data before proceeding

# 3. Apply (create_only writes into businessUnits/*, never touches state/main;
#    also provisions entitlement/seats and featureFlags/workers, enabled:true for
#    staging by default -- see the note below for production).
node scripts/worker-boundary-migrate.mjs --owner $OWNER_UID --business $BUSINESS_ID \
  --apply --confirm APPLY_STAGING_WORKER_BOUNDARY --source-hash $SOURCE_HASH

# 4. Promote to CUTOVER_VERIFIED once the applied data has been spot-checked.
node scripts/worker-boundary-migrate.mjs --owner $OWNER_UID --business $BUSINESS_ID \
  --promote --confirm PROMOTE_STAGING_WORKER_BOUNDARY --source-hash $SOURCE_HASH

# 5. Confirm idempotency: re-run steps 2 and 4 (NOT --apply again post-cutover, that
#    intentionally fails closed) -- dry-run must repeat identically, promote must
#    return NOOP_CUTOVER_VERIFIED.
```

`state/main` (the legacy source of truth) is never deleted, overwritten, or made secondary by any of this. The modular `businessUnits` tree is additive. Rollback (below) is always available because of this.

**Production note (not executed, deliberately blocked today):** `worker-boundary-migrate.mjs` and `worker-boundary-repair-identity.mjs` currently hard-reject any project other than `click360-staging-7620168025` (`Production is forbidden for worker boundary migration.`). Extending them to accept `click-360` is a small, deliberate, reviewed code change to make *only* when the pilot is explicitly approved — not a config flag flippable by a CLI arg. When that change lands, it must default `featureFlags/workers.enabled` to `false` for production migrations (opt-in activation only, via `worker-boundary-admin.mjs`), unlike the staging default of `true`.

## Pilot rollout plan (first 1–3 real customers)

**Pre-conditions before touching any real customer:**
1. The production guard above has been deliberately lifted in a reviewed commit.
2. `firestore.rules` (this exact ruleset, including the Phase 3.2 flag/seat/telemetry additions) has been deployed to `click-360` — additive only, does not change any existing production rule behavior for non-Workers paths.
3. The 1–3 pilot customers have been chosen and their `OWNER_UID`/`BUSINESS_ID` confirmed with the business owner (human decision, not automatable).

**Per-customer activation sequence:**
1. Run the migration process above against `click-360` for that one owner (dry-run → apply → promote). `featureFlags/workers` is created but `enabled:false` — the module is migrated but dark.
2. `node scripts/worker-boundary-admin.mjs --action status --owner $OWNER_UID --business $BUSINESS_ID --project click-360` — confirm `CUTOVER_VERIFIED`, correct seat entitlement, flag present and `false`.
3. `node scripts/worker-boundary-admin.mjs --action enable-workers --owner $OWNER_UID --project click-360 --confirm ENABLE_WORKERS_PRODUCTION_TENANT` — the module goes live for this one tenant only. Every other production tenant is unaffected (default-closed).
4. Owner invites 1-2 real workers through the existing "Trabajadores" UI. Observe.
5. **Observation window** (recommend 48-72h per tenant before moving to the next): watch `telemetryEvents` for that tenant's `ownerId` for spikes in `worker_login_failed`, `worker_permission_denied`, `worker_stock_error`, `worker_cross_tenant_denied`; watch the Firebase console for rules-denial rate on the `businesses/{ownerUid}/businessUnits/**` path; ask the owner directly whether invites/logins/sales worked as expected.
6. Only after a clean observation window, repeat for the next pilot customer. Do not activate all 1-3 simultaneously on the first attempt — stagger them so a problem with customer #1 doesn't reach #2 and #3 before it's caught.

## Rollback plan (exact, per layer)

Rollback is layered — pick the narrowest one that resolves the issue; only escalate if needed.

1. **Single tenant, module misbehaving, data intact (most likely case):**
   `node scripts/worker-boundary-admin.mjs --action disable-workers --owner $OWNER_UID --project click-360 --confirm DISABLE_WORKERS_PRODUCTION_TENANT`
   Effect: immediate, at the rules layer (`businessUnitReady()` denies instantly). The owner's app falls back to the legacy `state/main` flow (never touched, never stale) with zero data loss. Reversible by re-running `enable-workers`.
2. **Single tenant, suspected data corruption in the modular tree:**
   `node scripts/worker-boundary-migrate.mjs --owner $OWNER_UID --business $BUSINESS_ID --project click-360 --rollback --confirm ROLLBACK_STAGING_WORKER_BOUNDARY --source-hash $SOURCE_HASH` (flag name is `ROLLBACK_STAGING_WORKER_BOUNDARY` even when `--project click-360` is passed, matching the script's existing confirm-string convention; adjust the constant when the production path is added).
   Effect: `businessUnits/{businessId}.status` becomes `ROLLBACK_ONLY`; every `businessUnitReady()`-gated rule denies for that business unit; `state/main` is untouched throughout, so the legacy flow keeps working immediately. The modular documents are *not* deleted (`modularDocumentsDeleted:false`) — preserved for postmortem.
3. **Multiple tenants, or an issue that looks like a Rules-layer regression, not tenant-specific:**
   Re-deploy the prior `firestore.rules` revision (`firebase deploy --project click-360 --only firestore:rules` from the previous git commit's rules file). Since Phase 3.2's flag defaults everything closed, this is a strict superset rollback — any tenant not yet explicitly enabled was never affected regardless.
4. **Full phase abort (would only apply post-merge-to-main, not relevant while this stays on the stabilization branch):**
   `git revert` the merge commit rather than a hard reset, so the evidence trail (this doc, the PR, the commits) stays intact for the next attempt.

At every level, `state/main` is the permanent safety net: it is never deleted, overwritten, or dual-written by any script in this feature, in any of the four rollback paths above.

## Known follow-ups (not blockers, explicitly out of scope for this phase)

- `WORKER_TENANT_ACCESS_ENABLED` in `app.js` (gates the whole "Registrar Trabajador" form) is still a synchronous, project-level-only check computed once at boot. It should become tenant-aware (reading the same `featureFlags/workers` doc) before a pilot customer needs to invite workers in production — otherwise the invite form itself won't render even once their tenant flag is enabled. Small, isolated fix; deliberately deferred so this phase's diff stays reviewable.
- `click360SetWorkerSeatAddOn` (direct owner self-service seat change) still exists and is still reachable by rules (`businessUnitOwner` branch of the entitlement update rule) from Phase 3.1. The new UI does not call it — it only calls the request-based `click360RequestAdditionalSeats`. Decide before general availability whether owner self-service should be fully removed or kept for a future paid self-serve flow.
