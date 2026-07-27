# CLICK 360 P2: Platform Modules and Workers

## Scope

This candidate introduces a local, feature-gated model for business modules, owner administration, workers, roles, and invitations. It is intentionally isolated from production administration: it does not write `accountAccess`, claims, Firebase Auth, Firestore Rules, or any real customer document.

## Module resolution

`CLICK360_P2_PLATFORM.resolveEnabledModules()` consumes an account access snapshot, business settings, membership, feature flags, and device context. It returns enabled modules, effective permissions, read-only status, plan limits, warnings, and machine-readable reasons.

The baseline modules are `core`, inventory, sales, cash, reports, scanner, labels, finance, and owner administration. `workers`, restaurant, and logistics need both a business configuration and a scoped flag. The flags begin disabled. Hiding navigation is only a usability layer; the resolver and its permission map remain the authorization contract exercised by the harness.

## Workers

Roles: owner, admin, cashier, seller, inventory, server, kitchen, route seller, collector, and read-only. Membership records are business-scoped. The model rejects cross-business writes, forged UIDs, owner escalation, owner revocation, expired invitations, wrong invitation email, and invalid invitation tokens.

An invitation stores only a SHA-256 token hash. The raw token is produced once for the local QA operator and is never put into the persisted invitation object or audit payload.

## Owner administration

The protected owner view provides a module matrix, team overview, printing-profile count, local diagnostics, activity, and explicit local requests for plan/suspension/reactivation. The requests are marked `pending_backend`; they do not mutate real access records. Every local action is recorded through the existing audit helper and a sanitized diagnostic entry.

## Validation

Run:

```sh
node qa-p2-platform-modules-workers-harness.cjs
npm run qa
npm run qa:rules
npm run qa:simulator:quick
npm run qa:simulator:full
npm run build:static
```

The harness covers module gating, role matrices, suspend/revoke handling, cross-business denial, forged UID denial, hash-only invitations, invitation redemption controls, owner-escalation denial, and sanitized audit records.

## Rollback

The feature is isolated in this branch. Reverting its commits removes the P2 domain script, local UI, and harness without changing Firebase, production Rules, Auth, claims, account access, or `businesses/*/state/main`.
