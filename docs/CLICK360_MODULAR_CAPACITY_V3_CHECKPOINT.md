# Modular capacity DEV checkpoint — 2026-10-03

Branch `feature/modular-persistence-v3-capacity`, from main `dc77604`. Selectively imports the #85 repository/harness/design, without reverting merged hotfixes or touching the original #85 draft branch. No production adapter activation, migration, rules publication or cutover performed.

## Implemented and verified

- Per-business feature-flag allowlist in addition to schema, verified-cutover and legacy-fence gates.
- Operation ledger identity validation and immutable idempotency keys.
- Sale item quantities must match unique stock deltas; duplicate product deltas fail before transport.
- A sale transaction reads the exact open cash session/date, updates its counters atomically with sale/movement/stock, preventing a concurrent close from racing a new sale.
- Cash close binds the exact session/date and checks ledger/report identity; it never mutates sales, movements or stock.
- Adapter project mismatch fails closed. Production remains disabled by default.
- Real Firestore emulator test with 500/2,000 products, 5,000 sales, 5,000 movements and 5,000 audit records; duplicate submissions, transaction retries, last-stock race, duplicate close, sale after close denied, two-business isolation, disabled business flag, unchanged legacy sentinel passed. Tests explicitly require loopback emulator 127.0.0.1:48940 and demo project.
- Permanent DEV CI job. This uses emulator Admin transactions to test atomicity; it is NOT client security-rules certification.
- Independent IndexedDB operation journal: one immutable, hashed request per operation; atomic local claim/revision control; uncertain responses and expired writer leases cannot retry without authoritative ledger reconciliation. Native Chromium/WebKit/Firefox restart, duplicate, claim-race, business isolation and response-loss tests are part of the required DEV job.
- DEV coordinator now binds journal hashes to the repository's exact normalized request envelope and existing `payloadSha256` ledger. Server-only transaction lookups verify sale/movement or session/report identity before confirmation. A lost response is reconciled before any resend; offline operations remain durable and unknown, not falsely confirmed. Native IDB plus actual repository/coordinator tests pass Chromium/WebKit/Firefox using a fake atomic transport; separate real Firestore emulator tests validate ledger lookup and unchanged legacy. The application UI still does not load this component.

## Native shadow evidence (offline only)

Verified latest native backup captured at `2026-10-03T21:50:08.523Z`, revision `1791050138270`, backup SHA256 `29a4ee1b542c9f6fa4770d893eed6fd8d46d289af8fead952ae87d77bb4dbadd`. The native state fields hash is unchanged from the earlier fresh read: `a2d2cff0ef75db8eba7c5927cef1966fa0f69f45f4263e5218a90d036f943fab`. Independent comparison found no payload/root/collection changes; the historical $30 sale, its movement and its closed-session report each exist exactly once. This does not establish the current contents of the physical device's outbox.

`scripts/modular-shadow-readonly.mjs` has no Firebase SDK, network transport, credentials or apply mode. It emits deterministic record IDs while preserving native Firestore Value tags, all original fields and order needed for an independent roundtrip. The resulting reconstructed data SHA256 equals the original: `63599a49fd6c4e898907e8ca18682da7042967ec854ee60548d989f8d4d3c0d1`.

463 products, 30 sales, 107 movements, 24 sessions, 22 reports and 272 embedded audit records; per-module hashes remain in the private manifest. Remaining legacy fields are preserved in the config planning bucket, not discarded. This is a native-value planning shadow on disk, NOT shadow records installed in remote Firestore. `cutoverEligible:false` is deliberate.

## Required before any pilot

1. Export/reconcile the real device outbox and fresh remote revision/hash; any unknown local operation stops cutover.
2. Wire and independently test the journal/coordinator for the UI, including local optimistic stock reconciliation and an authenticated client transport under certified rules. DEV hashing and authoritative replay coordination are implemented, but snapshot pending IDs alone remain an uncertified application outbox.
3. Build the incremental idempotent importer, record-size validation, type-preserving remote shadow and independent counts/relationships/stock/totals comparison. Bound config/images and remaining history modules; do not move oversized snapshots into config/main.
4. Complete product edits/opening/inventory operation adapters, pagination/history-derived print views and authoritative close-total verification. The DEV sale/close repository is not yet a complete application persistence replacement.
5. Certify rules/roles/tenant isolation and a server-enforced legacy write fence, including old PWAs. The existing rules do not yet authorize this new ledger/report adapter.
6. Test PWA old→new preserving IndexedDB and offline/reconnect/uncertain responses with the replay journal.
7. Present fresh source/hash, shadow equality, verified backup, record-level preview, rollback, physical acceptance plan and request separate owner authorization. Never enable all tenants.

## Rollback boundaries

Before cutover: disable the pilot flag; legacy remains unmodified. After any modular/local-only new write: freeze writers, export both formats/outboxes, reconcile newer operation IDs with independently verified stock deltas, then approve a forward-safe rollback. Never restore the preserved source snapshot over newer records. No automatic rollback implementation is certified yet.

Next safe instruction: finish UI repository/outbox adapter and incremental emulator-only importer, then rules/fence/old-PWA regressions. Production Hosting remains `66dfa9fb517a`; bridge staging is #90 / `ace0f6303cfd`, with all required CI checks passed, not modular production. The real-device outbox and physical acceptance remain unavailable; do not ask the client to repeat the already-confirmed historical sale or closure.

