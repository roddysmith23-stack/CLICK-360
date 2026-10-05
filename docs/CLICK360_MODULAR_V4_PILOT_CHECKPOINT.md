# Modular v4 pilot — 2026-10-04

Base: main `6f83372c89fc44a000a1f30876998d3522dbd6d2`, authorized merge #90.

Selective provenance: #91 `2a7d35eb9405aa80288afdc8300c72ff69c10b1a`: transaction repository, journal/coordinator, dedicated modular tests/emulator fixtures/workflow, native offline shadow tool and v2/v3 design documents. NOT copied: app.js, firebase-service.js, v16-storage.js, package.json wholesale, deleted capacity tests or previously certified #90 changes. Existing device-capacity CI remains mandatory. No force push or rewrite of #91.

Owner-approved future modular canonical contract is `modular-capacity-policy.js`: Founder 2 businesses / 2 workers / 2000 active products + 100 MiB structured data. 1200/1600/1900 are advisory, never cash/sync gates. 75/90/100 MiB levels are informational; usage must first be independently certified. Not loaded by legacy UI, no account writes and no pricing changes. Existing frozen core and `tenant-quota-overrides` remain the temporary legacy bridge.

Fresh read-only entitlement check found a stale real-account product override of 600. Production #90 still honors that old override, so do not claim the customer already has 2000 effective products there. V4's reviewed bridge now treats acquired Founder 2/2/2000 as a floor while retaining authorized expansions and unchanged non-Founder behavior. No entitlement document was edited, no account name is coded, frozen catalog unchanged, 100 MiB not injected into legacy Firestore guards. This code change requires its own full CI and approved release before taking effect in production; the bridge remains temporary pending canonical modular policy activation.

## Mandatory completion matrix (not an activation certificate)

| Gate | Current status |
|---|---|
| 1 UI repository/journal integration | Pending |
| 2 Durable UI replay | Bounded indexed journal/coordinator replay implemented; UI pending |
| 3 Physical outbox reconciliation | Unavailable; unknown operations stop cutover |
| 4 Incremental importer | Emulator-only native incremental shadow importer implemented; operational promotion/type adapter pending |
| 5 Remote modular shadow | Synthetic shadow namespace tested in emulator; real tenant shadow not created |
| 6 Independent semantic comparison | Independent emulator count/IDs/native state comparison implemented; real tenant/media/full audit coverage pending |
| 7 Product create/edit/import | Pending |
| 8 Inventory opening/adjustments | Pending |
| 9 History pagination | Server-only bounded repository cursor API implemented; UI pagination pending |
| 10 Derived print/report views | Pending |
| 11 Authoritative close totals | Sales total/count taken from transactional session summary; method/cash counters and import verification pending |
| 12 Modular client Rules | Pending; Admin-emulator tests do not certify Rules |
| 13 Roles/isolation with Rules | Pending |
| 14 Server legacy fence | Pending |
| 15 Old PWA legacy rejection | Pending |
| 16 Old→new preserving IDB | Pending |
| 17 Forward-safe rollback | Plan exists; execution test pending |
| 18 Diagnostics/telemetry | Per-operation DEV telemetry; UI pending |
| 19 Certified usage aggregation | Pending; no hard storage gate |
| 20 Complete staging | Pending |

Production shadow/cutover not authorized. No original state deletion/overwrite, no historical $30 sale/close repeat. Present all gate evidence and obtain final single-tenant owner authorization before cutover.

Incremental shadow records remain in `migrationShadows/{sourceHash}/modules/{module}/records/{deterministicId}`, not active operational modules. The importer accepts only a fixed demo/loopback transport, refuses mixed-business input, source revision/hash changes, oversized records and inline media without a separate asset plan. Native int64/timestamp/bytes/geopoint remain native. Independent reader reconstructs source and rejects extra record IDs. No cutover is inferred from native equality; normalization for the operational repository, explicit source partition, external audits/assets/customers and real device reconciliation remain required.

Journal schema v2 adds a tenant/state index without deleting existing operations. Bounded replay reads only pending requests, never history-wide confirmed records; it stops at the first unknown result and always checks the server ledger before replay. Production UI does not load these files yet.

