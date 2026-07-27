# CLICK 360 Administrative Tools

This package contains Node-only audit, migration, normalization, and account-access tools. It is not part of the static PWA release and must never receive production credentials in CI.

## Install and Test

```sh
npm ci --prefix tools/admin
npm run qa:fixtures --prefix tools/admin
npm audit --omit=dev --prefix tools/admin
```

The fixture commands are the only administrative commands allowed in CI. They use `fixtures/firebase-audit-fixture.json`, run read-only or dry-run behavior, and never initialize ADC.

## Compatibility Wrappers

The root `scripts/*.mjs` administrative names remain as explicit wrappers for documented commands. They delegate to this package and require this package to be installed first:

```sh
npm run admin:install
node scripts/audit-firestore-legacy.mjs --fixture tools/admin/fixtures/firebase-audit-fixture.json
```

## Security Status

`firebase-admin` remains intentionally visible in this package's own audit. The current stable dependency chain is blocked by upstream advisories. Do not use `--force`, out-of-range overrides, RCs, experimental versions, or audit suppression. The package is not approved for new or expanded live administrative use until a stable compatible upstream remediation exists.
