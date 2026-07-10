# CLICK 360 Legacy Migration Report

The public app detects and blocks legacy documents. The administrative migrator is the primary migration path.

## Dry run

```bash
node scripts/migrate-legacy-v9-to-v10.mjs --project=click-360 --dry-run --businessId=BUSINESS_ID
```

## Apply one audited tenant

```bash
node scripts/migrate-legacy-v9-to-v10.mjs --project=click-360 --apply --businessId=BUSINESS_ID
```

## Apply an audit-reviewed allowlist

```bash
node scripts/migrate-legacy-v9-to-v10.mjs --project=click-360 --apply --allowlist=path/to/approved-tenants.json
```

`--apply-all` is intentionally unsupported. The migrator accepts only `LEGACY_CLEAR_OWNER`, stores a backup in `legacyBackups`, rechecks the source hash in a transaction, validates counts before/after, and aborts on an ambiguous tenant, changed source, count mismatch, or backup failure.

Production migration status: completed only for the two audit-approved tenants below. No other tenant was selected.

## Real dry-run result - 2026-07-09

The `click-360` dry-run accepted two `LEGACY_CLEAR_OWNER` tenants with exact before/after count matches and stable logical hashes. The cross-tenant suspect was blocked.

## Applied one at a time - 2026-07-09

Each tenant was re-read, backed up administratively, hash-checked before the transaction, migrated alone, re-read after the write, and verified for schema, identity, tenant key, counts, and logical hash.

| Tenant | Source hash | Administrative backup | Logical data hash | Result |
| --- | --- | --- | --- | --- |
| `g9e8NjJjrDS3ldvNxHLlhqvzm3E3` | `7d322e92598d57d6f8a4eed8b7b895dd31b14aa61565fa5485c1f9c5a2e5c8a6` | `businesses/g9e8NjJjrDS3ldvNxHLlhqvzm3E3/legacyBackups/v9-1783657278755` | `427dcad4c77b5a10bc03d80461d8c5e84b26ea67531921ca0f06615a924eaf20` | `APPLIED_VERIFIED` |
| `iESlWpF92JXaGDoYTQ28ThWs93y1` | `514ecbee6c5a74bb767edcd2ddbc1a8a4b97373d008c7ee813d49d786e2bdfa5` | `businesses/iESlWpF92JXaGDoYTQ28ThWs93y1/legacyBackups/v9-1783657306734` | `e977e1ac005cd5f17e9c38e4055eecac2c51e859dd4138013f3034ead84e82e6` | `APPLIED_VERIFIED` |

The exact before/after count sets were equal for businesses, products, sales, movements, invoices, daily reports, workers, label templates, deleted products, and audit logs. Both migrated documents now have `schemaVersion: 10`, matching `ownerUid`, `ownerId`, `businessId`, and canonical `tenantKey` values. The historical email of the first tenant was deliberately not changed because the UID is confirmed and the email record is historical metadata.

`demo-click360` was not in the allowlist, was not backed up, was not written, and remains `CROSS_TENANT_SUSPECT`.

## Tooling hardening - 2026-07-10

The migrator now additionally requires a confirmed Firebase Auth UID, canonical owner/path equality and a structurally valid legacy payload. It rejects fixture apply, empty selections and missing allowlist entries, verifies payload schema fields, and preserves historical `updatedByEmail`. No production migration was run as part of this tooling update.
