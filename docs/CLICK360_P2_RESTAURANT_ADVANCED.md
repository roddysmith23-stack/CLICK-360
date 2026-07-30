# CLICK 360 P2: Restaurante Avanzado

## Scope

Restaurante Avanzado is a feature-gated extension of Mesas Lite. The existing `tables` and `tableOrders` paths remain compatible. The current web-safe release keeps table orders on the existing guarded save contract and adds scoped companion state for `restaurantPayments`, `restaurantPrintHistory`, `restaurantEvents`, and `restaurantRecipes`.

The production web flag is `p2RestaurantAdvancedEnabled`. No production Rule, Auth, account access, claim, migration, Function or customer tenant was changed.

## Capabilities

- Table states: free, occupied, preparing, ready, to-charge, paid, and cancelled.
- Orders and rounds: draft, sent, accepted, preparing, ready, delivered, cancelled, and paid.
- Kitchen and bar queues with elapsed time, priority, notes, variants, and scoped status transitions.
- Product, quantity, and equal-person split plans.
- Direct products that are not registered in inventory.
- Local recipe notes with ingredients and preparation steps per business.
- Movable and resizable 2D table layout with seats and current guest count.
- Partial payments with payment method, idempotency key, balance cap, cash movement, final sale, and single inventory decrement only after the balance reaches zero.
- Authorized, reasoned discounts; the same discounted total is used for split plans, payment limits, cash, final sale, and printed account.
- Authorised line and order cancellations with audit trail and reason.
- Move, merge, split, assignment, and cancellation forms use readable table/order selections rather than opaque IDs. Merges are denied once either order has a payment.
- Kitchen ticket, bar ticket, prebill, and final account print jobs through the existing `printing-service` handoff.
- Restaurant summary and report details: open/closed accounts, paid sales, discounts, sales by table, sales by server, payment-method cash totals, top product, cancellations, and kitchen time.

## Roles

The pure domain maps owner/admin to all restaurant permissions. Servers can manage tables and orders, kitchen can only read/update KDS states, and cashiers can read tables and register sales/cash actions. The harness verifies that kitchen cannot access cash and server cannot cancel an order without an explicit cancellation permission.

## Validation

```sh
npm run qa:restaurant:e2e
npm run qa
npm run qa:rules
npm run qa:simulator:quick
npm run qa:simulator:full
npm run build:static
```

The domain harness covers the full synthetic cycle: table -> order -> kitchen/bar -> partial payment -> final payment -> sale, duplicate payment protection, no overpayment, cancellations, cross-business denial, move/merge controls, KDS filtering, print output, and reporting.

## Deliberate exclusions

This candidate does not add online reservations, customer QR ordering, delivery marketplace integrations, fiscal invoicing, or external accounting. It does not claim physical printer certification.

## Rollback

The feature is isolated in this branch and hidden by a disabled flag. Reverting its commit removes the advanced UI and pure domain without changing Firebase, Rules, Auth, claims, account access, legacy `state/main`, or Mesas Lite.
