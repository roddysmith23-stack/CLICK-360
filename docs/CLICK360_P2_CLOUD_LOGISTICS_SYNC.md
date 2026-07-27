# CLICK 360 P2 Cloud Logistics Sync

The cloud logistics repository reads scoped route collections and routes all
mutations through staging Functions. It does not expose Firebase Admin SDK to
the browser and does not write legacy state/main.

The transaction service covers vehicles, route assignment, load sheets,
reservation ledger, dispatch, route sale, collection, return, expense,
settlement, approval, close, and audited reopen. Route sellers and collectors
must match the assignment stored in the route. Repeated requests use
idempotency markers, while settlement close uses a unique inventory adjustment
ledger so a reopen and second close cannot restore stock twice.

The reservations and adjustments are P2 ledgers. They intentionally do not
mutate the legacy inventory snapshot during this staging-only candidate. An
approved core inventory adapter must consume each ledger exactly once before a
production rollout.

Rollback is limited to closing or reverting this Draft candidate. No real
vehicle, route, sale, collection, inventory, or Firestore project is changed.
