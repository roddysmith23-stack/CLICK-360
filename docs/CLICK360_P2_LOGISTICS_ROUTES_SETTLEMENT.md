# CLICK 360 P2 - Logistics, Routes and Settlement

## Scope

This candidate adds a frontend/local `logistics` module for minimarket,
retail and distribution workflows. It is isolated by `businessId` and uses the
current guarded save contract. It does not deploy Functions, contact Firebase
Admin, change production Rules, Auth, claims, `accountAccess`, or manually
modify legacy `businesses/*/state/main` data.

## Enablement contract

The module is visible only when all conditions are true in the current PWA:

1. `p2LogisticsEnabled` is enabled in the web-safe flags.
2. The active business type is compatible with route/distribution workflows.
3. The user has write access through the existing CLICK 360 account gate.

Hidden navigation is not the access control. Every domain mutation validates
the actor permission and the business scope. A future cloud rollout must add
Rules-backed route assignment enforcement before enabling worker access.

## Domain model

All records carry `businessId`, timestamps, the actor, and an audit trail or
associated audit event. The initial local-compatible model contains:

- `vehicles`
- `routes` and `routeAssignments`
- `loadSheets` and `loadSheetItems`
- `routeSales`
- `collections`
- `returns`, `shortages`, and `overages`
- `routeSettlements`
- `routeExpenses`
- `routeCustomers`

`p2-logistics-domain.js` is deliberately deterministic and side-effect free.
The UI takes a snapshot before critical inventory and financial mutations and
uses the existing critical commit path to preserve the current sync contract.

## Operational flow

1. Owner or admin creates an active vehicle and a draft route.
2. A route can identify a seller and collector by team identifier.
3. Inventory creates a draft load sheet, adds available products, and confirms
   it. No stock changes before dispatch.
4. Dispatch is idempotent and reserves stock exactly once.
5. The assigned seller records cash, transfer, or credit route sales. A
   discount requires `routeSales.discount`; it is not granted to `routeSeller`
   by default.
6. The assigned collector records an idempotent collection only against a
   credit sale assigned to that route.
7. Returns validate loaded minus sold minus previously returned quantities.
   Sellable returns restore inventory once after an approved close. Damaged
   returns remain in the settlement evidence.
8. Owner or admin prepares, approves, and closes the settlement. Reopening
   requires a reason and cannot restore sellable returns a second time.

## Roles and isolation

- `owner` and `admin`: full logistics permissions.
- `inventory`: vehicles, loading, returns, reports, and printing; no sales,
  collections, or settlement approval.
- `routeSeller`: only assigned routes, route sales, and returns; no discounts
  by default and no collections.
- `collector`: only assigned routes and their credit collections.
- `readonly`: read-only reports and no mutation.

Every operation rejects a cross-business object. `routeSeller` and `collector`
also reject an unassigned route even when the same business is supplied.

## Printing and reports

Load sheets and settlements render through the existing `handoffPrint` path,
not a second printing engine. Reports cover routes, sales, seller totals,
collections, credits, returns, and settlements. The report is scoped to
routes visible to the current actor.

## QA evidence

Commands run against fixtures and the Firestore emulator only:

```sh
npm run qa
npm run qa:rules
npm run qa:simulator:quick
npm run qa:simulator:full
npm run qa:logistics:e2e
npm run build:static
npm audit --omit=dev --audit-level=moderate
```

The logistics harness proves: one-time inventory reservation and return,
credit collection idempotency, no over-collection, no oversell, business
isolation, seller/collector route assignment, discount permission, settlement
approval, close, reopen, and reports. The visual contract fixture exercises
the responsive route and settlement layout without customer data.

## Deferred work

This candidate intentionally excludes GPS, route optimization, fiscal
invoicing, bank reconciliation, payroll, a complete offline route queue, and
external accounting integrations.

## Rollback

No Firebase resource is changed by this branch. Rollback is a normal Git
revert of the candidate commit or closing the Draft PR. The module remains
disabled by default, so it cannot affect an existing business before an
explicit future rollout.
