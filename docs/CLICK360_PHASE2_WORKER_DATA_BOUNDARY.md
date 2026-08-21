# CLICK 360 Phase 2 - Worker Data Boundary

## Scope and safety

- Branch: `stabilization/1.0.5-worker-data-boundary`.
- Exact base: `b9c6de796ad6aedf3847e21cd4671964880496d9`.
- Production project `click-360` is explicitly rejected by the migration and staging guards.
- No production data, Auth, Rules, Hosting, claims or `businesses/*/state/main` were modified.
- PR #60 remains Draft. This phase is not merged or deployed.

## Data boundary

The owner remains identified by `ownerUid`. Each real business has an independent `businessId` under:

```text
businesses/{ownerUid}/businessUnits/{businessId}
  members/{uid}
  products/{recordId}
  sales/{recordId}
  layaways/{recordId}
  cashSessions/{recordId}
  movements/{recordId}
  auditEvents/{recordId}
  settings/main
```

Every parent and record carries:

- `ownerUid`;
- `businessId`;
- `tenantKey = owner:{ownerUid}:business:{businessId}`;
- `boundarySchemaVersion = 1`;
- module, record ID and monotonic `recordVersion`.

Workers never receive a reference to `businesses/{ownerUid}/state/main`. The client gateway is enabled only for `click360-staging-7620168025` and emulator project IDs. Production remains on its existing owner-only legacy flow.

## Permission matrix

| Role | Members | Products | Sales | Layaways | Cash | Movements | Audit | Settings |
|---|---|---|---|---|---|---|---|---|
| Owner | all | all | all | all | all | all | read/create | all |
| Admin | manage/read | all | all | all | all | read/create | read/create | all |
| Supervisor | read | read/create/update | read/create/update | read/create/update/payment | read/create/update/close | read/create | read/create | read |
| Seller | none | read | read/create | read/create/payment | read | read | create | read |
| Cashier | none | read | read/create | read/create/payment | read/create/update/close | read/create | create | read |
| Inventory | none | read/create/update/soft-delete | none | none | none | read/create | create | read |

Rules enforce permissions server-side. UI visibility is not authorization.

Financial protections include:

- sale and related stock decrement in one batch;
- a stock decrement must reference a sale created by the same actor and server request;
- an old sale ID cannot be replayed;
- layaway payment appends exactly one positive payment and reconciles paid/balance;
- cash close must transition `open -> closed` and reconcile counted/expected/difference;
- movements and audit events are append-only;
- products use soft delete; physical delete is denied.

## Invitation and revocation flow

```text
Owner creates invitation for one businessId
  -> worker authenticates with own UID
  -> transaction accepts invitation and creates root membership
  -> worker creates its modular membership from the accepted root record
  -> worker reads/writes only authorized modules
  -> owner reads append-only audit
  -> owner revokes root and modular memberships
  -> all subsequent worker reads/writes are denied
```

The Firestore Emulator executes this complete sequence with separate authenticated contexts for owner, Admin, Supervisor, Seller, Cashier, Inventory, revoked worker and cross-tenant attacker.

## Progressive migration

The runner is `scripts/worker-boundary-migrate.mjs`.

1. `DRY_RUN`: partitions one business from a synthetic or server snapshot and validates IDs, identity, counts, totals, stock and references. Writes: zero.
2. `APPLY_STAGING`: rereads staging `state/main`, checks the reviewed SHA-256, creates a source-reference backup manifest, creates only missing modular documents and verifies exact content. Collisions abort. Result: `VERIFIED`.
3. `PROMOTE_STAGING`: repeats source hash and collection equivalence, then changes only the parent status to `CUTOVER_VERIFIED`. This is the first point at which workers can enter.
4. `ROLLBACK_STAGING`: changes the parent to `ROLLBACK_ONLY`. Modular documents remain for evidence and `state/main` remains unchanged as the rollback source.

There is no dual-write. Once promoted, the modular gateway is authoritative for worker modules. The owner legacy snapshot is not deleted, overwritten or made secondary in this phase.

### Reviewed dry-run

```bash
npm run qa:worker-migration
```

Synthetic result:

- source hash: `f33801ac44fa0809b213d3b2a6ebb61aa5c198f312fa64f32f8a964ce7b8be05`;
- products/sales/layaways/cash/movements/audit/settings: `1/1/1/1/1/1/1`;
- stock `8`, sales total `5`, layaway balance `10`, opening cash `20`;
- `stateMainWriteCount = 0`;
- cutover remains disabled.

### Future staging commands - not executed

```bash
node scripts/worker-boundary-migrate.mjs \
  --project=click360-staging-7620168025 \
  --owner=<SYNTHETIC_OWNER_UID> \
  --business=<SYNTHETIC_BUSINESS_ID>

node scripts/worker-boundary-migrate.mjs \
  --project=click360-staging-7620168025 \
  --owner=<SYNTHETIC_OWNER_UID> \
  --business=<SYNTHETIC_BUSINESS_ID> \
  --source-hash=<REVIEWED_HASH> \
  --apply --confirm=APPLY_STAGING_WORKER_BOUNDARY

node scripts/worker-boundary-migrate.mjs \
  --project=click360-staging-7620168025 \
  --owner=<SYNTHETIC_OWNER_UID> \
  --business=<SYNTHETIC_BUSINESS_ID> \
  --source-hash=<REVIEWED_HASH> \
  --promote --confirm=PROMOTE_STAGING_WORKER_BOUNDARY

node scripts/worker-boundary-migrate.mjs \
  --project=click360-staging-7620168025 \
  --owner=<SYNTHETIC_OWNER_UID> \
  --business=<SYNTHETIC_BUSINESS_ID> \
  --source-hash=<REVIEWED_HASH> \
  --rollback --confirm=ROLLBACK_STAGING_WORKER_BOUNDARY
```

## Staging preparation

- Firebase project: `click360-staging-7620168025` (`CLICK 360 STAGING - NO PROD`).
- Firestore: Native, `nam5`.
- Hosting site: `click360-staging-7620168025`.
- Runtime configuration selects staging on its official host, staging preview hosts, localhost and `127.0.0.1`.
- `firebase.staging.json` contains only staging Hosting and candidate Rules.
- `scripts/validate-worker-staging-target.mjs` rejects every project except the approved staging ID and explicitly rejects `click-360`.
- `.github/workflows/worker-boundary-staging-gate.yml` runs QA, emulator, full simulator, build and browser/print evidence. It contains no deploy job and no production promotion.
- Firestore delete protection is currently disabled in staging and must be enabled before owner-facing verification data is retained.

No candidate was deployed because this mission explicitly prohibits deploy. The next owner-authorized staging action is to deploy candidate Rules and Hosting from one reviewed SHA, then create only controlled synthetic Auth identities and data.

## Receipt audit

The historical 10-page/18-cell output is an intentional extreme fixture: two copies of a long receipt are semantically split across 40x30 mm physical cells, with `startSlot=2`. It remains as a no-invasion regression test.

Normal sales no longer use that segmented layout implicitly. A standard print job uses one continuous receipt per requested copy:

| Browser | Width/profile | Copies | Label cells | Measured width | Result |
|---|---:|---:|---:|---:|---|
| Chromium | 58 mm | 1 | 0 | 58.00 mm | PASS |
| Chromium | 80 mm | 1 | 0 | 80.00 mm | PASS |
| Chromium | fixed-paper fallback | 1 | 0 | 40.00 mm | PASS |
| WebKit | 58 mm | 1 | 0 | 58.00 mm | PASS |
| WebKit | 80 mm | 1 | 0 | 80.00 mm | PASS |
| WebKit | fixed-paper fallback | 1 | 0 | 40.00 mm | PASS |

Evidence is under `output/playwright/stability-operations/receipt-*.png` and matching JSON measurement files. Output is intentionally not committed.

## Verification gates

Required commands:

```bash
npm run qa
npm run qa:rules
npm run qa:simulator:full
npm run qa:integration
npm audit --omit=dev --audit-level=moderate
git diff --check
```

The browser matrix covers Chromium, WebKit and Firefox; mobile layouts cover 320/360/390/430 widths; PWA build and Service Worker asset presence are checked; Golden Shary, receipt geometry, continuous receipts, upgrade/cache and offline/tenant isolation regressions remain in the gate.

## Owner verification checklist

This checklist requires a later staging deploy authorization:

1. Enable staging Firestore delete protection.
2. Deploy candidate Rules and Hosting to staging from one SHA.
3. Create only controlled synthetic Google QA identities.
4. Seed one synthetic owner legacy snapshot.
5. Run dry-run, review hash and counts, then apply.
6. Run apply a second time and require `NOOP_VERIFIED`.
7. Promote only after equivalence.
8. Execute owner invitation, worker own-account login, sale, layaway payment, audit and revocation.
9. Roll back and verify worker denial plus intact legacy owner state.
10. Do not use production identities or data.
