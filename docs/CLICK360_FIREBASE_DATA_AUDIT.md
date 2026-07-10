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

No production audit has been run from this workspace because the current ADC principal receives `PERMISSION_DENIED` on `click-360`.
