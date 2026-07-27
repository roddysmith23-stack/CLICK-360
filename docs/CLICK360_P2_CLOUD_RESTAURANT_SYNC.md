# CLICK 360 P2 Cloud Restaurant Sync

The browser repository only reads scoped Firestore collections and invokes a
non-production Functions endpoint for mutations. It never writes restaurant
orders, payments, inventory adjustments, print history, or audit events
directly.

The server action set is createRestaurantOrder, appendRestaurantRound,
transitionRestaurantOrder, recordRestaurantPayment, cancelRestaurantOrder, and
recordRestaurantPrint. Each mutation requires an active P2 membership,
restaurant feature flag, role permission, transaction, idempotency key, and
sanitised event.

Payment finalisation creates one payment document per idempotency key and one
restaurant inventory adjustment ledger per order. This candidate deliberately
does not mutate legacy state/main inventory. A future approved core-inventory
adapter must consume that ledger exactly once before any production rollout.

Rollback is a branch/PR rollback only. No Firebase project, Rules deployment,
customer order, or production inventory is changed by this candidate.
