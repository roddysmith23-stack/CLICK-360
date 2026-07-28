# CLICK 360 P2 Cloud Model and Contracts

## Scope

This is an emulator/staging-only candidate. It adds no production deployment,
does not read customer data, and does not modify `businesses/*/state/main`.
The legacy snapshot remains intact while P2 records are evaluated separately.

## Identity and isolation

`businessId` is the tenant boundary for every P2 record. A request obtains its
actor UID only from a verified Firebase ID token. It never accepts an actor UID
from a payload. The function first checks an active P2 membership at:

`businesses/{businessId}/members/{uid}`

An active member must have `schemaFamily: "p2"`, matching `uid` and
`businessId`, and `status: "active"`. `demo-click360` is rejected. All direct
critical writes are denied by P2 staging Rules; Functions make transactional
writes after authorization.

## Collections

| Path | Responsibility | Write path |
| --- | --- | --- |
| `organizations/{organizationId}` | Reserved organization identity/metadata. Provisioning is deliberately not enabled in this PR. | Future approved provisioning only |
| `businesses/{businessId}` | P2 business metadata and tenant root. | Approved admin Function |
| `businesses/{businessId}/members/{uid}` | Role, permissions, active/revoked state. | Admin Functions |
| `businesses/{businessId}/invitations/{id}` | Hash-only invitation state. | Admin Functions |
| `businesses/{businessId}/devices/{id}` | Per-device P2 metadata, scoped to the authenticated member. | Direct constrained Rule or future Function |
| `businesses/{businessId}/featureConfig/main` | Modules and rollout flags. | `updateBusinessModules` |
| `businesses/{businessId}/restaurantOrders/{id}` | Restaurant order aggregate. | Restaurant Functions |
| `businesses/{businessId}/restaurantPayments/{id}` | Immutable payment ledger. | Restaurant Functions |
| `businesses/{businessId}/restaurantCashMovements/{id}` | Immutable cash ledger per payment. | Restaurant Functions |
| `businesses/{businessId}/restaurantSales/{orderId}` | Exactly-once final sale ledger. | Restaurant Functions |
| `businesses/{businessId}/restaurantInventoryAdjustments/{orderId}` | Exactly-once inventory adjustment intent; no legacy inventory is changed here. | Restaurant Functions |
| `businesses/{businessId}/vehicles`, `routes`, `loadSheets` | Logistics setup and load lifecycle. | Logistics Functions |
| `businesses/{businessId}/routeSales`, `collections`, `returns` | Route commercial records. | Logistics Functions |
| `businesses/{businessId}/routeCashMovements/{id}` | Immutable cash sale/collection/expense ledger. | Logistics Functions |
| `businesses/{businessId}/routeInventoryReservations/{sheetId}` | Exactly-once dispatch reservation intent. | Logistics Functions |
| `businesses/{businessId}/routeInventoryAdjustments/{settlementId}` | Exactly-once sellable-return restoration intent. | Logistics Functions |
| `businesses/{businessId}/routeSettlements/{id}` | Route close/reopen state machine. | Logistics Functions |
| `businesses/{businessId}/p2Idempotency/{hash}` | Request key marker and safe replay response. | Functions only |
| `businesses/{businessId}/p2AuditLogs/{id}` and domain events | Sanitized append-only operational audit. | Functions only |

Every P2 document written by a Function includes `businessId`, `createdBy`,
`updatedBy`, server timestamps, `status`, and `version`. Mutating operations
also carry a hashed idempotency marker; raw invitation tokens are never stored.

## API contract

All endpoints are HTTP POST Functions in `us-central1`. Request body shape:

```json
{
  "payload": { "businessId": "synthetic-business-id" },
  "idempotencyKey": "at-least-12-safe-characters"
}
```

The Authorization header carries a Firebase ID token. Responses contain only
`ok`, a sanitized `code` when rejected, a generated `requestId`, and the
minimum result fields. A body-supplied UID is ignored because none is accepted.

Administrative actions: `inspectUserAccess`, `activateUser`, `suspendUser`,
`reactivateUser`, `updatePlan`, `updateBusinessModules`, `inviteWorker`,
`revokeWorker`, `acceptInvitation`, `regenerateInvitation`, and
`expireInvitation`.

Restaurant actions: `createRestaurantOrder`, `appendRestaurantRound`,
`transitionRestaurantOrder`, `recordRestaurantPayment`,
`cancelRestaurantOrder`, and `recordRestaurantPrint`.

Logistics actions: `createVehicle`, `createRoute`, `assignRoute`,
`createLoadSheet`, `confirmLoadSheet`, `dispatchLoadSheet`, `createRouteSale`,
`recordCollection`, `recordReturn`, `recordRouteExpense`,
`createRouteSettlement`, `approveRouteSettlement`, `closeRouteSettlement`,
and `reopenRouteSettlement`.

The Function entry point accepts only `demo-click360-p2-staging` or the
explicit comma-separated `CLICK360_STAGING_PROJECT_ID` allowlist. It rejects
production, an omitted project, and every unlisted project before decoding the
token or selecting a service.

## Client repositories

`workers-repository.js`, `platform-admin-repository.js`,
`restaurant-repository.js`, and `logistics-repository.js` are the sole P2
cloud client boundary. They expose read/subscribe/transaction/retry methods,
obtain the current Firebase token, and use repository calls for critical
commands. They do not contain Firebase Admin SDK code.

The existing P2 screens remain compatibility/local UI while the `p2Cloud`
configuration is disabled by default. They are not silently dual-written to
the cloud candidate. The emulator browser fixture exercises the repositories
and Functions across independent authenticated sessions. Wiring the production
P2 UI to this boundary is a separate, gated rollout step; this explicit gap is
why this candidate cannot be treated as production-ready.

## Feature flags

`featureConfig/main` requires both a module flag and a feature flag:
`workerAccessEnabled`, `restaurantAdvancedEnabled`, or `logisticsEnabled`.
Each supports `enabled`, `killSwitch`, `allowedBusinessIds`, `allowedUids`, and
`rolloutPercentage`. Server-side enforcement evaluates the flag for every
restaurant/logistics command. A hidden client button never grants access.

## Financial semantics

Restaurant payments validate remaining balance inside a Firestore transaction.
The final payment creates one sale and one inventory-adjustment intent. Route
dispatch creates one reservation intent, collections cannot exceed the credit
balance, and a closed settlement creates one return-restoration intent listing
only sellable returns. These P2 ledger intents do not yet mutate the legacy
inventory snapshot; an approved core adapter is required later.

## Staging operational limits

The service uses `maxInstances: 2`, in-memory per-UID/action rate limiting of
60 commands/minute, a 50 KB payload limit, and sanitized errors. These are
staging controls, not a complete production capacity policy.
