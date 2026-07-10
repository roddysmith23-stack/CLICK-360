# CLICK 360 Firebase Data Audit

The administrative audit is read-only by default. It inventories approved users, email invites, tenant state documents, identity fields, writers, content summaries, and cross-tenant signals.

## Fixture validation

```bash
node scripts/audit-firestore-legacy.mjs --fixture fixtures/firebase-audit-fixture.json --out artifacts/firebase-audit
```

## Production read-only audit

Use an authorized Application Default Credential. No credential, token, or service-account JSON belongs in this repository.

```bash
gcloud auth application-default login
node scripts/audit-firestore-legacy.mjs --project=click-360 --out artifacts/firebase-audit
```

The generated `artifacts/firebase-audit/` folder is ignored by Git and contains JSON, CSV, and Markdown reports. Each tenant is classified as `CLEAN_V10`, `LEGACY_CLEAR_OWNER`, `LEGACY_AMBIGUOUS`, `CROSS_TENANT_SUSPECT`, or `ORPHANED`.

The scripts refuse every project except `click-360`; they never fall back to the active gcloud project. For a read-only production audit, grant the ADC principal `roddysmith23@hotmail.com` `roles/datastore.viewer` and `roles/firebaseauth.viewer` on `click-360`. For a separately approved migration, grant `roles/datastore.user` only for the migration window.

## Real audit result - 2026-07-09

The read-only audit completed against `click-360` using ADC. Raw JSON, CSV, and Markdown remain in the ignored `artifacts/firebase-audit-real/` directory and were not committed.

| Category | Count |
| --- | ---: |
| Approved users | 3 |
| Tenants | 3 |
| CLEAN_V10 | 0 |
| LEGACY_CLEAR_OWNER | 2 |
| LEGACY_AMBIGUOUS | 0 |
| CROSS_TENANT_SUSPECT | 1 |
| ORPHANED | 0 |

The two clear legacy tenants passed administrative dry-run count and hash checks. The `demo-click360` tenant is a cross-tenant suspect because it has no matching approved owner and was written by a different UID; it remains blocked and was not migrated. One clear tenant has a stale email in `approvedUsers`, but its Firebase Auth UID and current email match the historical writer; the discrepancy is retained as an audit observation, not silently overwritten.
