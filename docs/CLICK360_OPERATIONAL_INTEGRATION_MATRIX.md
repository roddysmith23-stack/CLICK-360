# Operational integration audit — 2026-10-12

Baseline: PR #96 `9bb3112954c7a9fc365e425d8e385e64b6713dee`, all required CI checks SUCCESS. Connected bootstrap commit `a6df35f27688e0f2822d8ad782de4b2f18821bf2` also has all three required workflows SUCCESS. Public Hosting manifest freshly read: `21409a1d2dc7`. Subsequent work needs its own clean HEAD checks. No production writes, merge, deployment or real migration. Existing certified fixes are retained.

## Actual lifecycle, not component availability

1. `firebase-service.js onAuthStateChanged` resolves access and binds the authenticated tenant; duplicate same-user approval events do not tear down an active operation.
2. `enterApprovedApp` now checks the actual SDK project and resolves owner storage mode from the authoritative server in the isolated Spark emulator/staging projects. `spark-operational-bootstrap` restores device data and drains the journal before installing bounded server views. Legacy mode retains its existing path. Production and the older worker-boundary gateway remain separate and are not automatically activated by this change.
3. `app.js` restores validated local/IndexedDB state, renders the existing business interface and executes existing commercial handlers.
4. The served synthetic PWA now connects its Spark session through actual authentication/bootstrap, **not a test-created runtime**. Supported `commitCriticalMutation` commands go through `spark-operational-ui-runtime`, journal, coordinator, transaction repository and client SDK. Production activation remains rejected.
5. The durable command is pinned before candidate persistence and network traffic. Confirmation requires authoritative ledger lookup and a bounded record projection. Local projection failure stays indexed separately; no sale/stock replay is justified by projection failure.
6. An unsupported modular command fails closed rather than falling through to legacy. Generic `save`, snapshot application and legacy/V1 pushes also reject an active Spark session. A demonstrated generic-save defect left unsupported edits in memory after rejection; the corrected branch discards only that unpersisted edit by recovering the latest durable **device** candidate (including its pending operations), not an older remote view. The regression executes the actual PWA function and fails before this change.
7. Pending commercial/projection rows currently block another candidate; complete multi-operation offline overlay is **not** implemented. Bounded replay settles financial rows before the indexed projection barrier; UNKNOWN, network, issuer, revision and durability failures stop. Automatic owner bootstrap drains complete journal counts and verifies progress without retry timers. It still does not certify cold offline bootstrap or migration of a capacity-pending legacy source.
8. Logout or actor/tenant context change must revoke the old writer without deleting snapshots or journal. Durable Spark command hashes now include the original actor; an unconfirmed row from another/missing issuer cannot silently be re-signed under the next worker.
9. The bootstrap owns a browser Web Lock for its complete lifetime, including commands/replay, and removes lifecycle listeners on closure. A competing tab fails closed. Business changes drain the outgoing journal and durably preserve the verified selection before constructing the new repository; rejected background saves cannot restore the preceding business mid-transition.
10. Consent/configuration arrays are reconstructed using the next path component to choose array versus object containers. Existing legal consent is restored, not waived. Authorization listens only to the identity's actual approval source; self-service owners are not incorrectly revoked for an absent `approvedUsers` document.

## Integration matrix

`Connected` means the actual served PWA handler has a typed modular command. It does **not** mean production activation, automatic bootstrap, complete staging certification or recovered physical iPhone data. `Blocked` means unsupported when a Spark session is active, not silently written to legacy.

| Flow | Actual file / adapter | Source and effect | Evidence / status |
|---|---|---|---|
| Auth, tenant resolution | `firebase-service.js onAuthStateChanged`, access resolver | Auth + authoritative server mode/access | Automatic owner bootstrap served Chromium/WebKit; worker V2 bootstrap remains incomplete |
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
| Apartado status mutation | `layaway_status_updated` | Legacy mutation | Blocked; no typed status transition |
| Sale cancellation | `sale_cancelled` | Legacy financial mutation | Blocked; requires exact compensating command |
| Customer create/edit/delete | Existing CRM / `customerMutationCommand` | Individual revision-checked customer; logical delete retains history | Served Chromium/WebKit + import-identity/worker Rules |
| Cash open | Existing $0 opening handler / `cash_open` | Exact session + opening + runtime + ledger | Served Chromium/WebKit; historical date tested |
| Cash close | `submitCashClose`, exact preflight / `cash_close` | Exact session + unique compact report + ledger; no stock/sale changes | Served lost-response recovery + readback |
| Cash reopen | `reopenCashDay`, `cashSuccessorCommand`, exact predecessor `cash_open` | New session + opening + runtime + ledger + prior-report status atomically; prior closed session/financial totals unchanged | Served Chromium/WebKit + owner/worker-denial client Rules; does not use incompatible DEV same-session reopen |
| Income/expense create | Existing cash movement form / `cash_movement` | Actual movement + exact session counters + ledger | Served Chromium/WebKit |
| Movement edit/cancel | `cash_movement_updated/cancelled` | Legacy financial mutation | Blocked; compensating adapters missing |
| Cash history | `cashView`, bootstrap `loadMore` | Authoritative server pages; durable append under coordinator flight | Actual 103-report history in served Chromium/WebKit; no sale/stock changes |
| Customers / activity | Existing CRM and Activity + bootstrap `loadMore` | Server pages beyond row 100; Spark activity never calls the V1 reader | Served Chromium/WebKit; no financial writes during pagination |
| Other histories / aggregates | Current array views; repository bounded queries | Local projection is not server-paginated full history | Sales/report paging control connected; partial summaries labeled, complete aggregate/date integration remains missing |
| Historical working date | `setWorkingDate`, native `putWorkingDate` | Device-only per-business preference; does not change financial revision/snapshot | Native four profiles plus served Chromium/WebKit restart and two-business isolation |
| Cash report/receipt | Existing modal / `cashReportView` | Derived view of server-confirmed compact report | Served exact reports; no duplicated sale totals |
| Labels/printing | Existing print engine + product view | Read-only printing; saved profiles/templates use `save` | Existing release print QA; modular full print/config journey missing |
| Business/profile/config | Existing `profile_updated`, `business_profile_updated`, `save` | Legacy settings | Blocked; scoped configuration adapters missing |
| Supplier invoices / finance | Existing guarded handlers | Legacy operational records | Blocked; must not activate a tenant needing unsupported writes |
| Tables/logistics | Existing flows / older V1 gateway | Not Spark V1 operational repository | Distinct architecture must not be mislabeled Spark-certified |
| Offline / reconnect | Native journal + coordinator + runtime | UNKNOWN lookup before replay; durable projection recovery | Components/native browsers pass; multi-command UI overlay incomplete |
| Second device | Bootstrap, bounded transport and ledger | Independent device reads modular server, not old legacy snapshot | Served Chromium/WebKit independent storage contexts see matching sales, stock and tombstones |
| Migration | Select source, recovery pin, importer, codec, comparator | Owner-wide newest reconciled source; deterministic shadow then server reread | Synthetic/emulator foundations; production bootstrap/coordinator not connected |
| Legacy write fence | `firestore.spark.rules`, owner `metadata/storage` | Owner-wide fence because legacy snapshot contains multiple businesses | Client Rules + owner coverage tests; real cutover disabled |

## Release gates

Do not remove nonproduction activation guards, enable automatic migrations, merge or deploy production based on partial rows. A whole served business journey, automatic mode routing, all required operational commands, complete durable replay/overlay, real Spark staging, PWA upgrade and forward-safe recovery must pass first.

Physical iPhone source/outbox remains unobserved. Remote historical records cannot certify the client's newer local operations. Real cutover needs reconciled device evidence and final owner authorization; nothing here supplies either.
