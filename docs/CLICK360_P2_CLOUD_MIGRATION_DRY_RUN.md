# CLICK 360 P2 Cloud Migration Dry Run

## Status

No migration is authorized or executed by this branch. The supplied
`p2-cloud-migration-dry-run.cjs` is a pure, no-network planner for synthetic
fixtures. It produces hashes, counts, target paths, preconditions, and a
rollback description. It cannot write Firestore, Hosting, Rules, or
`businesses/*/state/main`.

Run the synthetic proof with:

```sh
npm run qa:p2:migration
```

## Candidate mappings

| Source | Candidate P2 destination | Policy |
| --- | --- | --- |
| Local active workers | `businesses/{businessId}/members/{uid}` | Requires a resolved UID, one-to-one mapping, and an active approved actor. |
| Local pending workers | `businesses/{businessId}/invitations/{id}` | Raw token is never copied; an approved apply must issue a new hash-only token. |
| Mesas Lite | `businesses/{businessId}/restaurantTables/{id}` | Maps table metadata only. No orders, payments, or cash are copied automatically. |
| Local label profiles | `businesses/{businessId}/labelProfiles/{id}` | Optional per-device profile migration, isolated by business/device. |
| Synthetic/local routes | `businesses/{businessId}/routes/{id}` | Maps only unambiguous route metadata; commercial route activity requires a later reviewed migration. |

## Required apply protocol

An owner-approved apply must be a separate tool and release. For every
business it must:

1. Read and hash source documents and the protected legacy `state/main`.
2. Write an immutable backup manifest before any mutation.
3. Re-read hashes and counts immediately before the transaction.
4. Abort on missing UID, duplicate ID, cross-business data, unexpected count,
   or source hash mismatch.
5. Create only missing P2 documents with explicit preconditions and a single
   idempotency key per entity.
6. Record an append-only audit event with the plan hash.
7. Compare source/target counts and hashes after the operation.
8. Preserve `state/main` unchanged for the approved rollback period.

## Rollback

Rollback may remove only documents proven to have been created by the approved
P2 migration run, using its manifest and audit IDs. It never deletes or
overwrites legacy source documents, existing P2 documents, customer records,
or `businesses/*/state/main`.
