# Spark staging execution — 2026-10-13

Production stays `21409a1d2dc7`; no production deployment, migration, SHARY writes or physical acceptance. PR #96 remains the continuation branch.

## Backend compiler failure resolved

The original `5ac546a` Rules pass emulators but Firebase's staging compiler returns HTTP 503. Read-only backend comparison: minimal Rules 200, previously deployed Rules 200, original Spark Rules 503. This is candidate-specific, not a general infrastructure outage or a billing blocker.

Operational helpers now live inside the existing modular storage path instead of being inherited by every legacy match. `sparkActiveMember` remains shared because the membership document also uses it. All 132 function bodies and all 172 effective permission statements/paths are identical to the baseline, enforced by `qa-spark-rules-scope-parity.mjs`. No commercial invariant, role or fence was removed. Firebase backend compilation and real staging deployment pass.

Rules SHA256: `8a26e15d8f09aa6f31bdcd71075517d7e0fc8b4924de73fe619938e94f41700f`.

## Executed real staging, not emulator substitute

URL: https://click360-staging-7620168025.web.app/

First served build: `5ac546a9c4a8`. Chromium and WebKit pass actual Auth, automatic native bootstrap, cash opening $0, atomic sale/movement/stock/ledger, fresh application launch, independent second device and unchanged synthetic legacy source. Each fixture starts with only eight products; initialization uses Admin only for synthetic fixtures, while operations use the PWA Web SDK and deployed Rules. No rollout policy or customer migration was enabled.

This initial smoke is **not** complete staging/migration certification. The broader replay/worker journey has separate evidence and must not inherit this PASS.

Two additional findings from the expanded journey:

- The generic large fixture declares 40mm media although its two columns require 92mm. Actual printing correctly rejects it. The staging print fixture now uses physically valid 100mm media; the application's geometry guard remains unchanged.
- After two offline sales and document closure, real staging drained the financial journal (pending=0, unknown=0, projection=0), but the serialized module view reads exceeded the 30-second bootstrap assertion. Independent views now use at most three concurrent server queries; page limits, read count, authoritative checks, complete journal drain and final publication barrier remain unchanged. A deterministic barrier regression fails on the old serial implementation and passes on the bounded loader. Actor changes prevent publication of all in-flight results. No timeout was increased.

## Recovery and deployment boundaries

Staging configuration: `firebase.spark-staging.json`, pinned to staging Hosting + Firestore Rules only. `validate-worker-staging-target.mjs` rejects production, unknown configs and Functions/Storage additions. Read-only backend compilation gate: `scripts/qa-spark-rules-remote-compile.mjs --project=click360-staging-7620168025`.

Pre-change Hosting is cloned to `pre-spark-20261013`:
https://click360-staging-7620168025--pre-spark-20261013-3wv8ures.web.app/

Prior staging Rules release: `projects/click360-staging-7620168025/rulesets/f93ec879-f6e8-4a79-8186-e0ded9b387a1`, SHA256 `38b504d5d0806071c6d29b1787d8261aa2dc8026ecdba891352158b8147a448b`. Its source and metadata are retained privately under `output/private/spark-staging-before-20261013/`. The pre-cutover Hosting recovery command is `firebase hosting:clone click360-staging-7620168025:pre-spark-20261013 click360-staging-7620168025:live --project click360-staging-7620168025 --config firebase.spark-staging.json`. Do NOT execute that old release/Rules pair while modular writers or modular commercial operations exist: restoring old Rules could remove the fence. After modular activation, retain certified fence enforcement, freeze writers, export modules/journal and reconcile operation IDs before a compatible forward recovery. The preserved original Rules are evidence, not an unconditional post-cutover rollback. Never restore older commercial snapshots.

## Expanded real staging result

Served candidate `b7eb3a0a00056cb2bc38282a7c266bf9e0c14ae9` passed both Chromium and WebKit with the deployed Rules hash above. The unchanged 30-second bootstrap assertion now passes after two actual offline sales and closure of the document. The original browser storage partition is reused: no IndexedDB deletion, fresh empty context substitute, retries or re-created sales.

Verified per engine:

- Owner automatic Auth/bootstrap, $0 opening and transfer sale.
- Exactly one printed label for quantity one, although stock is seven.
- Two distinct durable offline commands; server stock remains seven while offline.
- Document close/reopen, full replay, fresh ledger/movement readback, stock five, cash saleCount three, pending/UNKNOWN/projection counts all zero.
- Independent device reads stock five from Firestore.
- Scoped proof published by the owner's Web SDK under real Rules, not Admin.
- Worker authenticates, inherits Founder product floor 2000 despite override 600, cannot read the private owner-wide proof, commits one sale with original actor, stock four and cash saleCount four.
- Server membership revocation removes the worker writer without changing its durable IndexedDB snapshot.
- Legacy state/main is byte-semantically unchanged throughout.

Sanitized test log: `output/spark-real-staging-b7eb3a0-20261013.log`; private fixture credentials/results are under `output/private/spark-real-staging-*/`. Each engine initializes 53 fixture documents plus bounded scoped authorization records. Large scale remains emulator-only. This certificate covers **operational smoke + physical-browser-storage recovery**, not physical iPhone acceptance, complete automatic legacy migration, all business adapters or production readiness.

Automatic owner-wide migration/cutover and remaining matrix adapters are still prerequisites. Physical iPhone local source/outbox is unobserved. No SHARY cloud recovery or production-ready status is inferred from synthetic staging results.

## Strict remote source precondition

A separate regression changes the synthetic legacy server's stock during shadow re-reading without changing its revision. The old importer incorrectly accepted this when the durable local snapshot was pending, because only the selected local source hash, revision and device revision were rechecked. The test fails before the fix (`Missing expected rejection`). The manifest now pins the independent remote SHA256 too, and both source revalidation and control transitions compare it strictly. The same test passes afterward with `SOURCE_CHANGED_STOP`; the preserved local source/pin is untouched. Authenticated Web SDK emulation, resumed import, idempotency and semantic equality remain PASS, with source/reconstructed SHA256 `32daa2f1cd7fa6dc7eb75612344b53b5acc129bee8611d9b6f4d4d21818eea9d` for that synthetic fixture. No production write or real cutover occurs.

## Repeated real revocation delivery failure

The next served-artifact repetition did NOT inherit the preceding PASS: real Chromium's membership observer delivered only `active/fromCache:false` after revocation, and the writer remained installed past the unchanged 30-second assertion. This failure is retained, not labeled flaky. The previous Rules denied the worker GET access to their own now-revoked membership; a new real-Web-SDK regression reproduces that denial before the fix.

The revised Rules permit only authenticated GET of that caller's own correctly scoped revoked membership in modular mode. Foreign membership, all business data and all writes remain denied to a revoked actor. Commerce permissions still require active membership. The native membership observer now requests metadata changes and continues ignoring cache-only authority. Function bodies remain unchanged; the parity fixture explicitly records this single reviewed read-policy change instead of falsely claiming pure scope relocation. Full client Rules, legacy compatibility, +16-expression headroom and backend compilation pass on Rules SHA256 `a3e8e04f9d524454e6d0bb6fd20111458f58e2e7864bd7a093fbe8b5ae829ec2`. A fresh real staged repetition must verify delivery and retained IndexedDB before certifying revocation. Two-business fixture/switch and foreign-business denial were added to the same bounded real journey.

## Continued execution: actual retail journey

All required CI checks on `01bc5d5496484c9fedc3b0e0e990e614eebfaa75` are SUCCESS. The served artifact remains that SHA; production still serves `21409a1d2dc7`.

Real browser diagnostics narrowed the revocation delivery failure: two deliberately forbidden `get({source:'server'})` calls in the same PWA session precede a stalled membership watch. Either denial alone, the isolated SDK watch with/without IndexedDB, and a PWA sale without that pair deliver revocation. SDK 12.14.0 and transport autodetection did not resolve the pair; neither experiment was incorporated into the app. These failed probes are retained under `output/spark-staging-watch-*.log` and can be reproduced by `qa/spark-staging-watch-diagnostic.mjs`, which accepts only the existing private synthetic staging fixture and restores its membership status in `finally`. Its diagnostic output is NOT a release certificate.

The real journey continues to test both forbidden reads **inside the same authenticated worker PWA**, using read-only Web SDK transactions instead of transient Watch targets. Both must return `permission-denied`; no role, Rule or isolation check was removed. A server-confirmed active membership subscription barrier precedes revocation. The forbidden-Watch diagnostic remains a separate unresolved limitation; these transaction-based checks do not claim to fix the SDK's shared-Watch behavior.

The first expanded close timed out in the harness, but an independent server read found exactly one closed session, one report and one committed close ledger. The test had lost its operation-status observer when it closed and recreated the document. `open()` now registers that observer for EVERY document. No application close logic, timeout or confirmed operation was changed/retried.

`output/spark-real-staging-retail-listener-fixed-20261013.log` is PASS for both Chromium and WebKit against real Spark Auth/Firestore/deployed Rules, with no mocked financial transport. In addition to the earlier offline/worker/second-device/print checks, it verifies:

- Two-business selection preserves primary stock/sales and secondary stock seven; worker foreign-business and private-owner reads are denied.
- Original cash close has exactly four sales and $120; successor session is distinct and closes with zero sales/total, without touching stock.
- Working date 2026-09-03 opens a separate exact session. Paid, layaway and pending-payment sales each decrement stock once.
- The initial layaway receipt is $2, not its $30 sale total; the pending sale receipt is zero. Subsequent $3/$4 payments preserve stock and saleCount, update exact balances and link to the exact session.
- Historical close has three sales/$90 and preserves the original report's $120.
- Real customer create/edit and product create/compound stock edit persist as individual documents. The adjustment has exactly quantityDelta +1 and final product stock eleven.
- Final original-product stock is one; pending, UNKNOWN and projection counts are zero; legacy state/main remains unchanged.

Initial fixture writes: 56 per engine, not the 2000/5000-record stress dataset. Large-scale certification stays emulator-only. Status is `REAL_STAGING_RETAIL_JOURNEY_ONLY`, **not** `STAGING_SPARK_MODULAR_CERTIFIED`: automatic legacy/local migration, upgrade from production, remaining blocked adapters and physical SHARY recovery are not inferred from seeded modular fixtures. No migration/cutover/production promotion is enabled.

The extended repetition `output/spark-real-staging-retail-restart-20261013.log` also passes BOTH engines. After the complete journey it closes the document, recovers the same IndexedDB partition and opens an independent second device. Both read stock one for the sold SKU, stock eleven for the created/adjusted SKU, the edited customer, seven distinct sales and three reports from modular Firestore. The original device retains working date 2026-09-03. Pending/UNKNOWN counts remain zero. Synthetic initial source hashes are Chromium `682c5dfd59df12166841118a06b365093d70eecd0fb86451e11ccc4182fbc7e6` and WebKit `971f9d9d6bb3c07aa8e177df5ddae26c3c044fbdd7ae0be9c376154d56347d15`; these identify the fixture, not a migration equality certificate or SHARY data.
