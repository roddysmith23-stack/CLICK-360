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

Production migration status: not run. No tenant has been changed by this branch.

## Real dry-run result - 2026-07-09

The `click-360` dry-run accepted two `LEGACY_CLEAR_OWNER` tenants with exact before/after count matches and stable logical hashes. The cross-tenant suspect was blocked. No `--apply` command was run and no backup or production document was created in this audit phase.
