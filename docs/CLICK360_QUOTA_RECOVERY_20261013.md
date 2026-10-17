# Spark quota rejection: durable recovery

Continuation of PR #96, baseline `ae76cd64b4d3c15395a33ca366a34db76586a63c`.
No production, commercial record, Rules, entitlement or capacity-limit changes.

## Demonstrated defect and correction

Real staging previously returned `8 RESOURCE_EXHAUSTED: Quota exceeded`.
That error does not establish the cause of preceding WebKit timeouts.
A new native IndexedDB/browser regression failed before the correction with
`QUOTA_EXHAUSTION_REDUNDANT_SERVER_REQUEST`: the coordinator immediately made
another ledger read against the exhausted service.

For the Web SDK codes `resource-exhausted` and
`firestore/resource-exhausted`, the coordinator now preserves UNKNOWN and stops
this attempt after its durable journal transition. No timer, quota increase,
commercial rollback, journal deletion or assumption of remote absence is added.
On a subsequent replay, the existing authoritative ledger lookup remains
mandatory before any resend. A same-ID committed operation confirms without a
second financial write. The actual UI runtime also retains the adapter's
sanitized cause code instead of discarding it in its result.

## Permanent regression coverage

`qa-modular-coordinator-e2e.mjs`, part of mandatory `qa:modular-persistence`:

- Quota exhausted during initial ledger lookup: one read, no commercial commit.
- Close/reopen native IndexedDB: UNKNOWN and immutable payload hash retained.
- Recovery: server lookup precedes the single commit; repeated processing does
  not duplicate the sale or movement or decrement stock again.
- Quota error after a successful commit: UNKNOWN survives restart; authoritative
  ledger confirms the existing sale without resending it.
- Existing lost-response, duplicate-submit, cash close and legacy-preservation
  scenarios remain enabled.

`qa-modular-ui-adapter-e2e.mjs` additionally requires the true sanitized
`resource-exhausted` cause and rejects false cloud confirmation. Runs in native
Chromium, WebKit and Firefox with synthetic transactional transport, not live
Firestore. Client Rules and served PWA emulators are separate gates.

## Release boundaries

The baseline web workflow first failed because `labels-e2e` was abandoned with
no executed steps. Its second attempt passed all required jobs; the other two
baseline workflows also passed. New source changes require their own CI.

Real staging's last quota failure remains recorded in
`output/spark-real-opening-cause-ae76-20261013.log`. No unbounded real-cloud
retries or billing change is authorized by this patch. Remaining operational
adapters, executable legacy-journal migration handoff, cutover, full staging
upgrade/recovery and physical iPhone reconciliation remain explicit release
gates in `CLICK360_OPERATIONAL_INTEGRATION_MATRIX.md`.

Production still serves `21409a1d2dc7`; no SHARY writes or new client operations
were requested. This patch is not a SHARY recovery or production certificate.
