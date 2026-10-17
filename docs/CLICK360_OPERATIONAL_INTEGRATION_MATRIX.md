# Operational integration audit — 2026-10-12

Baseline: PR #96 `9bb3112954c7a9fc365e425d8e385e64b6713dee`, all required CI checks SUCCESS. Connected bootstrap commit `a6df35f27688e0f2822d8ad782de4b2f18821bf2` also has all three required workflows SUCCESS. Public Hosting manifest freshly read: `21409a1d2dc7`. Subsequent work needs its own clean HEAD checks. No production writes, merge, deployment or real migration. Existing certified fixes are retained.

## Actual lifecycle, not component availability

1. `firebase-service.js onAuthStateChanged` resolves access and binds the authenticated tenant; duplicate same-user approval events do not tear down an active operation.
2. `enterApprovedApp` checks the actual SDK project and resolves owner or authorized worker storage mode from the authoritative server in the isolated Spark emulator/staging projects. Workers read only their assigned-business codec-verified proof and membership; they neither pull V1 operational snapshots nor read the private owner-wide proof. `spark-operational-bootstrap` restores device data and drains the actor-scoped journal before installing bounded server views. Legacy mode retains its existing path. Production activation remains disabled.
3. `app.js` restores validated local/IndexedDB state, renders the existing business interface and executes existing commercial handlers.
4. The served synthetic PWA now connects its Spark session through actual authentication/bootstrap, **not a test-created runtime**. Supported `commitCriticalMutation` commands go through `spark-operational-ui-runtime`, journal, coordinator, transaction repository and client SDK. Production activation remains rejected.
5. The durable command is pinned before candidate persistence and network traffic. Confirmation requires authoritative ledger lookup and a bounded record projection. Local projection failure stays indexed separately; no sale/stock replay is justified by projection failure.
6. An unsupported modular command fails closed rather than falling through to legacy. Generic `save`, snapshot application and legacy/V1 pushes also reject an active Spark session. A demonstrated generic-save defect left unsupported edits in memory after rejection; the corrected branch discards only that unpersisted edit by recovering the latest durable **device** candidate (including its pending operations), not an older remote view. The regression executes the actual PWA function and fails before this change.
7. Known queued offline commands can accumulate durable device candidates. Server projections wait until the financial queue is completely settled, so a preceding confirmation cannot overwrite newer local deltas. UNKNOWN blocks new commands; online writes cannot overtake queued predecessors. Revision-bearing edits/receipts/close still require their preceding projection instead of inventing record versions. Failed device-candidate persistence blocks further commands until recovery. Native journal v5 selects replay pages by transactional monotonic enqueue chronology, not lexical IDs or the first ID-sorted page. Equal timestamps, clock rollback and restart are tested. Automatic owner/worker bootstrap drains complete journal counts and verifies progress without retry timers. Cold offline bootstrap and migration of a capacity-pending legacy source remain uncertified.
8. Logout or actor/tenant context change revokes the old writer without deleting snapshots or journal. Durable Spark command hashes include the original actor; native journal v5 retains all original records and uses actor-scoped indices. Foreign issuer access/claims are denied; missing or malformed issuers block recovery and remain visible to the unscoped census. Scoped authoritative membership revocation closes the worker writer. Worker approval responses are context/epoch guarded so a previous actor cannot approve the new session.
9. The bootstrap owns a browser Web Lock for its complete lifetime, including commands/replay, and removes lifecycle listeners on closure. A competing tab fails closed. Business changes drain the outgoing journal and durably preserve the verified selection before constructing the new repository; rejected background saves cannot restore the preceding business mid-transition.
10. Consent/configuration arrays are reconstructed using the next path component to choose array versus object containers. Existing legal consent is restored, not waived. Authorization listens only to the identity's actual approval source; self-service owners are not incorrectly revoked for an absent `approvedUsers` document.

## Integration matrix

`Connected` means the actual served PWA handler has a typed modular command. It does **not** mean production activation, automatic bootstrap, complete staging certification or recovered physical iPhone data. `Blocked` means unsupported when a Spark session is active, not silently written to legacy.

| Flow | Actual file / adapter | Source and effect | Evidence / status |
|---|---|---|---|
| Auth, tenant resolution | `firebase-service.js onAuthStateChanged`, access resolver | Auth + authoritative server mode/access | Automatic owner and worker bootstrap served Chromium/WebKit; worker scoped membership/revocation and customer/product/inventory/cash/sale paths tested |
| Worker commercial contract | Scoped codec proof + canonical owner account + quota evaluator | Worker permissions stay scoped; secured owner plan/overrides preserve Founder 2/2/2000 | Actual worker PWA with owner override 1/1/600; expired owner account denies worker writes in client Rules |
| Initial owner load | `enterApprovedApp`, `spark-operational-bootstrap` | Verified modular documents and protected device cache; no legacy pull for modular owner | Served real SDK/Auth/Rules emulators; legacy pending source blocks replacement |
| Select business | `app.js`, bootstrap / runtime identity guard | Drain old journal, durable selection, replace repository and load selected modules | Actual two-business picker in Chromium/WebKit; shared legacy remains unchanged |
| Product create | `app.js productForm`, `productMutationCommand` | Product + opening movement + ledger atomically | Served Chromium/WebKit, client Rules |
| Product edit + stock | Same form / `inventory_adjust` | Product metadata + stock delta + movement + ledger atomically | Served Chromium/WebKit; no split commits |
| Product logical delete | `deleteProduct`, `productDeleteCommand` | Revision-checked tombstone + ledger; retains stock/history, no financial expense | Baseline CI and served Chromium/WebKit; retained through automatic restart |
| Bulk product/import inventory | Existing import/editor paths / `save` | Legacy full-state mutation | Blocked; bounded typed import not integrated |
| Current/manual/historical sale | `bindSell`, explicit live/manual adapters | Exact session + sale + stock + movement + ledger | Served Chromium/WebKit and real-client Rules; bounded 12-line worst case |
| Initial apartado | Same checkout / `layawayCommand` | Reservation plus actual initial deposit, not full price receipt | Served Chromium/WebKit |
| Pending payment sale | Same checkout / `pendingPaymentCommand` | Unpaid sale with zero actual receipt, not fictitious cash | Served Chromium/WebKit |
| Abono / subsequent receipt | Existing payment modal / `receivablePaymentCommand` | Receipt + balance + session + movement + ledger; no new sale/stock delta | Served Chromium/WebKit + permission-specific Rules |
| Apartado status mutation | `layaway_status_updated` → `layawayStatusCommand` / `layaway_status` | Fully-paid linked sale + exact versioned reservation + immutable ledger; no sale/stock/cash changes | Connected handler; repository and real Web SDK Rules owner/worker permission tests pass. New served ready/pickup journey requires its own result |
| Sale cancellation | `sale_cancelled` | Legacy financial mutation | Blocked; requires exact compensating command |
| Customer create/edit/delete | Existing CRM / `customerMutationCommand` | Individual revision-checked customer; logical delete retains history | Served Chromium/WebKit + import-identity/worker Rules |
| Cash open | Existing $0 opening handler / `cash_open` | Exact session + opening + runtime + ledger | Served Chromium/WebKit; historical date tested |
| Cash close | `submitCashClose`, exact preflight / `cash_close` | Exact session + unique compact report + ledger; no stock/sale changes | Served lost-response recovery + readback |
| Cash reopen | `reopenCashDay`, `cashSuccessorCommand`, exact predecessor `cash_open` | New session + opening + runtime + ledger + prior-report status atomically; prior closed session/financial totals unchanged | Served Chromium/WebKit + owner/worker-denial client Rules; does not use incompatible DEV same-session reopen |
| Income/expense create | Existing cash movement form / `cash_movement` | Actual movement + exact session counters + ledger | Served Chromium/WebKit |
| Movement edit/cancel | `editMovement` / `deleteMovement` → `manualMovementCorrectionCommand` | Owner-only exact-open-session correction; original financial values retained, append reversal/replacement + ledger + cash counters atomically | Actual PWA Chromium/WebKit journey and client Rules passed for ledger-proven manual movements. Distinct IDs sharing one operation must not merge; equal-data durable modal refresh rebinds the live record, stale revisions stop. Sale-linked, opening, inventory, closed-history and unproven imported movements remain denied, not a legacy fallback |
| Cash history | `cashView`, bootstrap `loadMore` | Authoritative server pages; durable append under coordinator flight | Actual 103-report history in served Chromium/WebKit; no sale/stock changes |
| Customers / activity | Existing CRM and Activity + bootstrap `loadMore` | Server pages beyond row 100; Spark activity never calls the V1 reader | Served Chromium/WebKit; no financial writes during pagination |
| Other histories / aggregates | Current array views; repository bounded queries | Local projection is not server-paginated full history | Sales/report paging control connected; partial summaries labeled, complete aggregate/date integration remains missing |
| Historical working date | `setWorkingDate`, native `putWorkingDate` | Device-only per-business preference; does not change financial revision/snapshot | Native four profiles plus served Chromium/WebKit restart and two-business isolation |
| Cash report/receipt | Existing modal / `cashReportView` | Derived view of server-confirmed compact report | Served exact reports; no duplicated sale totals |
| Labels/printing | Existing print engine + product view; universal and advanced editors `scopedSettingsCommand` | Printing is derived; owner template save/rename/duplicate/tombstone uses individual revisioned records + ledger, retaining advanced fields | Real staging quantity 1 PASS on `10b33b5`. New handler VM and exact-field client Rules pass; full new served advanced-editor and physical printer certification remain separate. Compound profile/design save and multi-record default selection stop before mutation |
| Business/profile/config | Existing `business_profile_updated` → `scopedSettingsCommand` | Owner business config/main, exact revision + ledger; no owner-wide legacy write | Connected real profile form; client Rules checks owner/worker denial, stale revision, forbidden fields and idempotency. Wider account/profile settings remain outside this adapter |
| Supplier invoices / finance | Existing guarded handlers | Legacy operational records | Blocked; must not activate a tenant needing unsupported writes |
| Tables/logistics | Existing flows / older V1 gateway | Not Spark V1 operational repository | Distinct architecture must not be mislabeled Spark-certified |
| Offline / reconnect | Native journal + coordinator + runtime | UNKNOWN lookup before replay; preserve the complete optimistic candidate until financial drain; then durable bounded projections | Actual worker PWA: two offline sales, document close, online restart, complete replay, exact stock/cash/movements in Chromium/WebKit. Revision-bearing dependent edits and cold offline bootstrap are still gated |
| Second device | Bootstrap, bounded transport and ledger | Independent device reads modular server, not old legacy snapshot | Served Chromium/WebKit independent storage contexts see matching sales, stock and tombstones |
| Migration | `enterApprovedApp` → `spark-operational-bootstrap` → `spark-migration-bootstrap` → importer/recovery/comparator/handoff | Owner-wide durable source + complete journal census; deterministic shadow, server reread, then independently pinned source-bound exact-runtime handoff plan | Real staging shadow equality/restart PASS on `10b33b5`, two businesses and local-newer data in Chromium/WebKit. New read-only handoff has pure/native IDB/bootstrap tests; no Firestore runtime initialization or executable journal handoff/cutover is enabled |
| Recovery preservation (P0A) | Actual owner Auth entry → migration bootstrap recovery-only → native recovery + journal → private Firestore fragments | Immutable original device record + complete owner journal, fresh remote reference; independent server reread/reconstruction | New `automaticRecoveryCopy` pilot gate; production entry permits preservation only, never operational bootstrap/cutover. `RECOVERY_COPY_CLIENT_VERIFIED` is not operational sync. Final exact-HEAD CI/staging/old-PWA gates and physical iPhone proof remain required; see `CLICK360_P0A_RECOVERY_COPY_20261014.md` |
| Legacy write fence | `firestore.spark.rules`, owner `metadata/storage` | Owner-wide fence because legacy snapshot contains multiple businesses | Client Rules + owner coverage tests; real cutover disabled |

## Release gates

The shadow-to-operational transition also requires a server-enforced
administrative approval. `storageRollout/sparkV1.automaticCutover` defaults to
false; the private `businesses/{ownerUid}/storageApprovals/cutover` record must
match that owner's immutable source hash, build SHA and complete ordered business
coverage. Runtime preparation has a separate private `runtimePreparation`
approval with exact records and complete cash summaries. Owners can read only
their own approvals; workers, other owners and anonymous clients cannot read
them. Only platform administrators can write these documents. The globally
readable rollout document must never contain approval payloads. Semantic equality alone does
not grant authority to activate commercial writers. This gate does not create
runtime documents or complete the operational handoff.

Do not remove nonproduction activation guards, enable automatic migrations, merge or deploy production based on partial rows. A whole served business journey, automatic mode routing, all required operational commands, complete durable replay/overlay, real Spark staging, PWA upgrade and forward-safe recovery must pass first.

Remote historical records cannot certify the client's newer local operations.
Recovery copies can now be inspected independently with the read-only support
tool documented in `CLICK360_RECOVERY_COPY_INSPECTION.md`; its private results
must not be confused with physical-origin/latest-state correlation or
operational cloud confirmation. The real bootstrap now pins the full separate
capacity-save proof (not just a zero-row modular journal), and requires verified
cash summaries in every covered business before starting shadow writes.
Real cutover still needs reconciled device evidence, operational certification
and final owner authorization; a local codec roundtrip supplies none of these.

## 2026-10-16 continuation

Production remains the separately published P0A release `9090f2105d17`; #96
does not inherit permission to activate operational migration. Staging baseline
`669b6465b4d0ebaf6fb24afd3e144c94672c141d` was actually served with Spark Rules,
but its real retail and shadow timeout failures remain failures, not certificates.

Financial migration proof now distinguishes verified cash summaries from closed
history that cannot safely be operated. An explicitly opted-in staging plan can
preserve a closed financial connected component with source/record hashes and
server-enforced immutable metadata. Open sessions, active receivables, ambiguous
relationships and missing records still stop the plan. No amounts, payment
methods, reports or original records are repaired by inference. The importer
checks both original semantic equality and added financial metadata after server
reread. This policy does not enable cutover or make an unverified session reopenable.

Source stability now pins the complete durable device metadata, including the
remote base and snapshot-save references, not just commercial JSON/revision.
Receipt/projection reads and the unchanged 25-record shadow chunks can read known
independent IDs concurrently inside their existing transactions. Record budgets
are reserved before awaiting; concurrent duplicates share the same read. Atomic
writes, Rules checks, ledger checks, source checks and timeouts are unchanged.
