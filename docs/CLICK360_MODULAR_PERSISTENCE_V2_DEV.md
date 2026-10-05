# CLICK 360 modular persistence v2 — DEV increment 1

Status: DEV only. It is not connected to production and it does not migrate any tenant.

## Goal

Replace whole-document `state/main` rewrites with small, tenant-scoped records. The first increment implements the two highest-risk critical mutations:

- a sale creates exactly one sale, one movement and the required stock updates in one transaction;
- a cash close creates one compact derived report and closes the exact session in one transaction, without touching sales, movements or inventory.

Both operations use an immutable `operationLedger` record. A retry with the same operation and payload returns the committed result. Reuse of an operation ID with another payload fails closed.

## Layout

All records stay inside one business boundary:

```text
businesses/{ownerUid}/businessUnits/{businessId}
  products/{productId}
  sales/{operationId}
  movements/{operationId}
  cashSessions/{cashSessionId}
  dailyReports/{reportId}
  auditEvents/{eventId}
  config/main
  metadata/main
  operationLedger/{operationId}
  storageTelemetry/{operationId}
```

Every record carries `ownerUid`, `businessId`, `tenantKey` and `storageSchemaVersion`. The repository rejects a record whose identity does not match the selected tenant.

## Activation gates

The repository is fail-closed. Writes require all of the following in the same transaction:

1. `featureFlags/modularStorage.enabled == true`;
2. `featureFlags/modularStorage.writeMode == "modular"`;
3. feature flag schema version `2`;
4. business unit status `CUTOVER_VERIFIED`;
5. business unit storage schema version `2`;
6. `legacyWriteFence == "REJECT_AFTER_CUTOVER"`.

Production project `click-360` is rejected by default. Enabling a production adapter and deploying matching Firestore rules remain separate owner-authorized work.

## Migration sequence

1. Read one fresh server snapshot and record its revision plus canonical hash.
2. Preserve the native Firestore snapshot and manifest outside public artifacts.
3. Create modular records with deterministic IDs in `shadow` mode. Never delete or update `state/main` in this phase.
4. Compare counts, IDs, native values, stock/qty mirrors, totals, relationships and per-module hashes.
5. Repeat the source revision/hash check. A mismatch invalidates the preview and stops cutover.
6. Install and verify the legacy-write fence in rules before changing the feature flag to `modular`.
7. Activate one tenant, monitor idempotency conflicts, record sizes, transaction failures and sync outcomes.
8. Retain the original snapshot until an independent verification and the rollback window are complete.

The migration command, rules change and production adapter are intentionally not part of this first increment. This prevents the DEV kernel from being mistaken for an authorized migration.

## Rollback

Before cutover, rollback is simply `featureFlags/modularStorage.writeMode = "legacy"`; the original `state/main` remains authoritative and unmodified.

After cutover, rollback must first stop all modular writers, reconcile operations newer than the preserved source hash, and only then choose an authoritative format. It must never overwrite `state/main` with an old snapshot. A PWA built before the write fence must not be allowed to write once modular mode is active.

## Capacity telemetry

Each critical transaction writes a small `storageTelemetry/{operationId}` record with operation kind, payload bytes and document count. `occupancy()` classifies legacy snapshots as normal below 80%, warning at 80%, and critical at 95% of the configured internal limit. Aggregation and alert delivery will be implemented without adding a hot shared document to every transaction.

## Verification in this increment

Run:

```sh
npm run qa:modular-persistence
npm run build:static
```

The permanent harness covers:

- duplicate sale submission;
- atomic sale, movement and stock mutation;
- same-operation payload conflict;
- two devices competing for the final stock unit;
- duplicate cash close;
- confirmed server close after a missing response;
- compact report without stored HTML;
- no stock or sale mutation during close;
- tenant isolation;
- disabled feature flag;
- production fail-closed gate;
- 3,000 sales, 3,000 movements and 3,000 audit events without history-wide reads.

These are automated DEV checks. No physical iPhone, Android, Windows or macOS acceptance is claimed by this increment.

