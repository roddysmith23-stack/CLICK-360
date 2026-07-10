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
node scripts/audit-firestore-legacy.mjs --out artifacts/firebase-audit
```

The generated `artifacts/firebase-audit/` folder is ignored by Git and contains JSON, CSV, and Markdown reports. Each tenant is classified as `CLEAN_V10`, `LEGACY_CLEAR_OWNER`, `LEGACY_AMBIGUOUS`, `CROSS_TENANT_SUSPECT`, or `ORPHANED`.

No production audit has been run from this workspace because there is no Firebase Application Default Credential available here.
