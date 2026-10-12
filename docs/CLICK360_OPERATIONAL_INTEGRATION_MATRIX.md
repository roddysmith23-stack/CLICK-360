# Operational integration audit — 2026-10-12

Baseline: PR #96 `5a08b825a96f3840da843a28f8d8fe7a32f756b1`, clean worktree, all required CI checks SUCCESS. Public Hosting manifest freshly read: `21409a1d2dc7`. No production writes, merge, deployment or real migration in this audit. Existing certified fixes are retained.

## Actual lifecycle, not component availability

1. `firebase-service.js onAuthStateChanged` resolves access and binds the authenticated tenant; duplicate same-user approval events do not tear down an active operation.
2. `enterApprovedApp` prepares device storage and currently pulls legacy data. Its existing `MODULAR_MODE/MODULAR_GATEWAY` branch is the **older worker-boundary gateway**, not automatic Spark V1 owner bootstrap.
3. `app.js` restores validated local/IndexedDB state, renders the existing business interface and executes existing commercial handlers.
4. A **synthetic certification session explicitly connected by the served test** routes supported `commitCriticalMutation` commands through `spark-operational-ui-runtime`, journal, coordinator, transaction repository and client SDK. Production activation remains rejected.
5. The durable command is pinned before candidate persistence and network traffic. Confirmation requires authoritative ledger lookup and a bounded record projection. Local projection failure stays indexed separately; no sale/stock replay is justified by projection failure.
6. An unsupported modular command fails closed rather than falling through to legacy. Generic `save`, snapshot application and legacy/V1 pushes also reject an active Spark session. A demonstrated generic-save defect left unsupported edits in memory after rejection; the corrected branch discards only that unpersisted edit by recovering the latest durable **device** candidate (including its pending operations), not an older remote view. The regression executes the actual PWA function and fails before this change.
7. Pending commercial/projection rows currently block another candidate; complete multi-operation offline overlay is **not** implemented. A demonstrated replay deadlock has been corrected: when commercial rows remain, bounded replay settles them before attempting the indexed projection barrier. Only that specific barrier allows the next queued operation to be considered; UNKNOWN, network, issuer, revision and actual durability failures still stop. Component pagination/count/drain tests do not certify the missing multi-operation UI overlay or automatic bootstrap.
8. Logout or actor/tenant context change must revoke the old writer without deleting snapshots or journal. Durable Spark command hashes now include the original actor; an unconfirmed row from another/missing issuer cannot silently be re-signed under the next worker.

## Integration matrix

`Connected` means the actual served PWA handler has a typed modular command. It does **not** mean production activation, automatic bootstrap, complete staging certification or recovered physical iPhone data. `Blocked` means unsupported when a Spark session is active, not silently written to legacy.

| Flow | Actual file / adapter | Source and effect | Evidence / status |
|---|---|---|---|
| Auth, tenant resolution | `firebase-service.js onAuthStateChanged`, access resolver | Auth + server access; binds owner/worker | Existing release QA; Spark automatic mode routing missing |
| Initial owner load | `enterApprovedApp`, `pullRemoteOnce` | Legacy `state/main` plus protected device cache | Legacy certified; Spark owner bootstrap not connected |
| Select business | `app.js`, tenant context / runtime identity guard | Must replace writer and recover matching journal | Cross-business guards; full modular business-switch journey missing |
| Product create | `app.js productForm`, `productMutationCommand` | Product + opening movement + ledger atomically | Served Chromium/WebKit, client Rules |
| Product edit + stock | Same form / `inventory_adjust` | Product metadata + stock delta + movement + ledger atomically | Served Chromium/WebKit; no split commits |
| Product logical delete | `deleteProduct`, `productDeleteCommand` | Revision-checked tombstone + ledger; retains stock/history, no financial expense | New candidate regression; awaiting candidate suites |
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
| Cash reopen | `reopenCashDay` | Actual UI opens a **new session**; DEV command reopens old session | Blocked; do not map incompatible semantics |
| Income/expense create | Existing cash movement form / `cash_movement` | Actual movement + exact session counters + ledger | Served Chromium/WebKit |
| Movement edit/cancel | `cash_movement_updated/cancelled` | Legacy financial mutation | Blocked; compensating adapters missing |
| Histories and audit | Current array views; repository bounded queries | Local projection is not server-paginated full history | Component pagination only; real UI integration missing |
| Cash report/receipt | Existing modal / `cashReportView` | Derived view of server-confirmed compact report | Served exact reports; no duplicated sale totals |
| Labels/printing | Existing print engine + product view | Read-only printing; saved profiles/templates use `save` | Existing release print QA; modular full print/config journey missing |
| Business/profile/config | Existing `profile_updated`, `business_profile_updated`, `save` | Legacy settings | Blocked; scoped configuration adapters missing |
| Supplier invoices / finance | Existing guarded handlers | Legacy operational records | Blocked; must not activate a tenant needing unsupported writes |
| Tables/logistics | Existing flows / older V1 gateway | Not Spark V1 operational repository | Distinct architecture must not be mislabeled Spark-certified |
| Offline / reconnect | Native journal + coordinator + runtime | UNKNOWN lookup before replay; durable projection recovery | Components/native browsers pass; multi-command UI overlay incomplete |
| Second device | Bounded transport and ledger | Must bootstrap from modular server, not old legacy snapshot | Component races pass; automatic served cold-device journey incomplete |
| Migration | Select source, recovery pin, importer, codec, comparator | Owner-wide newest reconciled source; deterministic shadow then server reread | Synthetic/emulator foundations; production bootstrap/coordinator not connected |
| Legacy write fence | `firestore.spark.rules`, owner `metadata/storage` | Owner-wide fence because legacy snapshot contains multiple businesses | Client Rules + owner coverage tests; real cutover disabled |

## Release gates

Do not remove nonproduction activation guards, enable automatic migrations, merge or deploy production based on partial rows. A whole served business journey, automatic mode routing, all required operational commands, complete durable replay/overlay, real Spark staging, PWA upgrade and forward-safe recovery must pass first.

Physical iPhone source/outbox remains unobserved. Remote historical records cannot certify the client's newer local operations. Real cutover needs reconciled device evidence and final owner authorization; nothing here supplies either.
