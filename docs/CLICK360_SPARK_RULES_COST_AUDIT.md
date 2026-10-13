# PR #96 — Rules cost audit, continuation 2026-10-10

## Current worker bootstrap continuation — 2026-10-12

Current candidate Rules SHA256: `95007fec1ba1b002ce9935c1b195c6c2b7e09202714ee58117342d5e80008ef8`. Exact-source and RAM-only `+16` suites passed with zero expression/access/internal evaluator errors. Proofs: `artifacts/spark-rules-proof/exact-source.json` and `headroom.json`; logs: `output/spark-worker-rules-20261012.log` and `spark-worker-rules-headroom-20261012.log`. These are working-source emulator results, not production/staging deployment or clean-HEAD CI.

Worker writes now inherit the canonical owner's writable account, not just an active member grant. Reads remain separately scoped. Owner auth/path fast path still has no membership lookup. The worker authorization source set adds the existing owner account (or approved-owner fallback); it does not add a new plan document or a client-controlled entitlement. Scoped commercial proof publication is checked against that same owner contract.

That extra security check exposed an expression-headroom failure in the previous 12-manual-line ledger validator. Removing the account check was rejected as a solution. Pure set computations are now bound once; the same twelve manual-line proofs are split across **five mandatory records in one atomic commit**: ledger 0–1, sale 2–4, payment movement 5–8, exact session 9–10, runtime 11. Runtime is already read by the sale; its cursor is updated in the same financial transaction. The session proof requires that runtime's `lastOperationId`, so omitting the runtime write rejects every commercial record. No financial write or validation was deferred. Only the existing derived audit remains separate.

| Operation | Change from preceding candidate | Authorization / proof budget evidence |
|---|---|---|
| SALE | One runtime-after cross-record source and one runtime write, no new historical read | Owner/worker 12-stock, 12-manual and mixed/deposit/pending cases pass exact and +16; all 12 tampered manual positions and omitted runtime reject without budget exhaustion |
| INVENTORY_ADJUSTMENT | Financial shape unchanged | Worker account check plus existing member/feature sources; exact/+16 positive and adversarial tests pass |
| CASH_OPEN / CASH_CLOSE | Financial shape unchanged | Exact session and runtime unchanged; exact/+16 owner and scoped worker tests pass |
| PRODUCT_CREATE / PRODUCT_EDIT | Financial shape unchanged | Resource/request identity, revision and stock checks retained; expired owner worker denied without mutation |
| Scoped worker mode proof | Bootstrap-only, not a per-sale publication | Owner account/fallback, root control and scoped identity; foreign entitlement / worker publication denied |

Older `A=2` worksheets below are historical and **do not describe the current worker authorization**: worker now references membership, feature flag and account/fallback. Distinct source lists are an over-approximation, not a per-request count: resource data and same-path caching vary by validator. The actual Web SDK emulator access-limit gate and stricter expression probe are mandatory. The +16 PASS establishes tolerance of those sixteen added predicates, not a guessed percentage margin or a billed-read estimate.

Candidate only. Production remains `21409a1d2dc7`. The expanded owner/worker suite passed with zero budget errors, including the QA-only stricter expression probe, followed by exact-source and full legacy compatibility runs. New HEAD CI remains a separate gate. This document is NOT public UI, staging or production certification or a released cart-line limit.

## Two separate budgets

Customer DELETE uses the same bounded customer/ledger/control/authorization sources as CREATE/EDIT; no financial or history reads are added. Deletion is a tombstone-only field delta, with ordinary version/actor/path checks and explicit `customers.delete` permission at ledger creation. Existing embedded ID/business values cannot change; an absent legacy value may be supplied only as the exact immutable path identity. Those checks use `resource/request.resource`, not external reads. Direct SDK attacks verify both halves of the identity guard. Exact and stricter 16-predicate suites pass with zero evaluator/access-limit errors; candidate Rules SHA256 `ca52a5ca67cb4ef053952d57fdd84f30b0401ad8ec3d77c5938a3adb042d5f15`. These are local working-source tests, not new-HEAD CI or production certification.

### Subsequent receipt extension — 2026-10-12

Receipt core adds no product/history reads: existing sale before/after, unique movement before/after, exact session before/after, new ledger before/after, control and authorization. Linked layaways add their own before/after versions. The conservative distinct-path/version worksheet is `9 + A` for a pending receipt, `11 + A` for a linked layaway receipt; this is not a measured cache/billing count. Stock, sale totals/counts, historical date/session and item lines are immutable in this operation. Worker authorization uses the existing `layaways.payment` permission; `sales.update` can remain false.

The expanded overlapping movement OR proofs regressed the malformed missing-stock case into expression-budget exhaustion. A ledger-kind conditional dispatch preserves each original financial proof while avoiding unrelated receipt proof traversal in that case. The exact same negative scenario and positive worst-case worker carts now pass the stricter 16-predicate probe, with zero expression/access-limit errors. Additional exact-source/repeated browser gates remain required; do not infer charged reads or a percentage margin from aggregate coverage. The strict log watcher and final budget check remain enabled. Source Rules SHA256 for the first passing extension: `19546af2f3fa92ace6be134b77ee055bfcfd65d81f778a2c74993f80bf8a471b`.

Customer CREATE/EDIT adds no access calls to sale, inventory or cash proofs. Its own core references one control document, existing account authorization (and worker membership/flag when applicable), the exact ledger before/after and the exact customer after. Fields, identity and record-version increments use resource/request data. Conservative logical distinct-reference bound is `4 + A` (control, ledger before/after, customer after, authorization A); this is not a guaranteed billed/cache count. Owner does not read membership. Positive/negative client tests and the existing budget-log/headroom gates remain required on the new source; no budget certification is inferred from the pure adapter test.

Document access and expression evaluation are different budgets. Reusing a cached document path does not make repeated predicates free. Coverage counts aggregate multiple evaluations/retries/readbacks and are not per-request expression counts. The strict emulator-log gate remains mandatory even if every positive/negative scenario assertion passes.

## External accesses in the operational core

Paths below are scoped to the authenticated owner/business. `before/after` represent distinct versions. Repeated references to the same path/version are listed once; caching must be confirmed by actual SDK tests, not assumed as release evidence.

| Source | Reason | Reuse/removal decision |
|---|---|---|
| `metadata/storage` | Authoritative mode, phase, schema, equality and business scope | One logical source; reused across read/ledger checks. Fence retained. |
| `accountAccess/{owner}` or approved owner fallback | Existing account readable/writable contract, including expiry | No owner membership lookup. Consolidated path-based functions retain account checks. Fallback also checks absence of accountAccess. |
| Business `members/{actor}` + existing workers feature flag | Worker identity, active status, role and action permission/revocation | One membership/permissions source; no plan/owner/business-role traversal. Existing feature revocation is retained. |
| `operationLedger/{operationId}` before/after | New operation required, immutable committed receipt and kind | Related writes bind to new ledger; authorization certified at ledger CREATE. Cannot remove. |
| `sales/{operationId}` before/after | Unique sale and cross-record totals/stock declaration | Required for financial relationship; no history query. |
| `movements/{operationId}` before/after | Unique payment/adjustment/opening and counter delta | Required; no whole-history scan. |
| Exact `cashSessions/{cashSessionId}` before/after | Exact session relationship and a mandatory NEW atomic summary update | Never query by date; the sale proves revision +1, the session's own update checks use resource/request.resource. |
| Affected products after | First-product proof and successor chain prevent omitted stock writes | Own stock/revision use resource/request.resource. Each successor proves a distinct atomic update. Still requires multi-line worst-case certification. |
| `metadata/runtime` after | Single open-session pointer and exact open/close transition | Necessary cross-record invariant. |
| Exact `dailyReports/{reportId}` before/after | Unique close report tied to exact session/cycle | No sale replay; no stock writes on close. |
| `auditEvents/{audit-operationId}` after | Previously required by ledger in financial transaction | Removed ONLY from financial core. Derived event requires already committed immutable ledger, same actor/kind/hash, deterministic ID; recoverable idempotently after commit. |

## Static distinct-path/version upper-bound worksheet

`A=2` is the owner legacy fallback (account absence + approved owner), or worker membership + feature flag. An owner with accountAccess has `A=1`. These are logical source counts, NOT measured billed reads or guaranteed runtime cache counts.

| Operation | Before audit deferral | Candidate core after deferral | Core external sources |
|---|---:|---:|---|
| SALE, N stock-bearing unique products | `9 + N + A` | `9 + N + A` | control 1, ledger 2, sale 2, movement 2, session before/after 2, products N, authorization A; the extra before-version proves the mandatory session update |
| INVENTORY_ADJUSTMENT | `6 + A` | `5 + A` | control 1, ledger 2, product 1, movement 1, authorization A |
| CASH_OPEN | `7 + A` | `6 + A` | control 1, ledger 2, session 1, runtime 1, opening movement 1, authorization A |
| CASH_CLOSE | `8 + A` | `7 + A` | control 1, ledger 2, session 1, runtime 1, report before/after 2, authorization A |
| PRODUCT_CREATE with opening stock | `6 + A` | `5 + A` | control 1, ledger 2, product 1, opening movement 1, authorization A |
| PRODUCT_CREATE with zero stock | `5 + A` | `4 + A` | as above without movement |
| PRODUCT_EDIT | `5 + A` | `4 + A` | control 1, ledger 2, product 1, authorization A |

Derived audit is a separate bounded transaction: committed ledger read, audit existence read, deterministic audit create if absent. No sale/movement/stock/session changes and no commercial replay. Synthetic test verifies lost audit response/failure does not undo or repeat the financial operation, and the event can be repaired once. Client Rules test verifies worker audit materialization.

## Observed evidence and remaining margin

- Native IndexedDB enumeration/reconciliation tests cover 99/100/101/250/1000 rows in Chromium, WebKit and Firefox. UNKNOWN in the last row is not hidden by the first page. Enumeration is bounded to 100 rows, keyset-paginated, non-mutating and requires a source-stability guard.
- Synthetic transaction instrumentation now distinguishes financial vs derived-audit reads. A one-product sale uses 7 core reads, unchanged after adding 15000 unused historical rows. This is transport instrumentation, not Rules cost certification.
- Initial compact authorization/reordering attempts still produced 22 aggregate expression-limit errors in malformed compound transactions. The gate correctly failed; those attempts are not certification.
- Exact ledger-kind ternary dispatch in cash/product/ledger predicates subsequently passed the original malformed-stock/cash/report/race tests with zero expression/access-limit errors. Owner and worker sales of 4/8/12 stock-bearing products passed. The optimization retains every branch's original validation, mode fence and permissions.
- Expanding coverage to 12 manual lines exposed another budget failure. Rich-object set comparison, then an indexed-line proof in the sale CREATE validator, did not certify that case. These failures remain recorded; the supported limit is not released yet.
- Current candidate stores compact stock/custom **array-index maps**, not duplicated rich item objects. Every stock product proves its exact sale-array line. Manual-line proofs are partitioned across mandatory NEW core records: ledger verifies custom rows 0–2, sale verifies 3–5, movement verifies 6–9 and the exact quantity sum, and the mandatory exact-session update verifies rows 10–11. All belong to the **same atomic financial transaction**. Ledger requires the new sale and movement; the sale proves a session revision increment even if an old malformed record carried the new operation ID. Rejection of any rejects all writes. Cash verifies exact session/date, sale/item/tax totals and received-payment deltas. No commercial record or invariant is deferred. Only derived audit is outside the financial core.
- A compact authorization ternary produced an emulator internal `IllegalStateException: ternary operator predicate is always boolean`; SDK UNKNOWN-RPC retries then kept reads alive. Those executions failed and were stopped, not retried into a PASS or labeled flaky. The offending predicate shape was reverted. The candidate uses a flat worker permission helper with one membership source and retains worker-feature revocation; owner authorization uses auth/path without membership. An emulator-only log health guard now fails immediately on this internal exception or budget exhaustion and lets the CLI tear down owned emulators.
- With that correction, the complete client suite exited normally: owner and worker stock-bearing sales 4/8/12 and manual sales 1/4/8/12, malformed stock/cash/report writes, exact historical session, last-stock race, immutable audit/ledger, permission revocation and isolation all passed with **zero** expression/access-limit or internal-evaluator errors. This is one run on an uncommitted candidate, not final HEAD CI, full UI, staging or physical-device certification.
- A second expanded run rejected zero quantities at custom indices 0/2/3/5/6/8/9/11 even with matching forged quantity counters, plus custom provenance/index/identity/tax/count attacks. It exited 0 with the strict budget gate intact. A subsequent candidate also passed real Web SDK pending-payment and authorized reservation/deposit writes, immutable retries and reservation amount/relationship attacks. Sale permission alone does not grant reservation permission.
- A QA-only stricter-source probe adds 16 request-dependent arithmetic predicates to each operational record validator. Its first run failed at manual-sale evaluation although the normal source passed. This exposed inadequate expression headroom, not a flaky test. The next candidate moves receipt/session/date/method/amount validation to the mandatory movement CREATE rule, which already reads the exact sale; the ledger still requires that NEW movement in the same atomic commit. No receipt proof is omitted or deferred. This removes a redundant sale-side movement read and repeated proof traversal. The stricter probe must pass before any margin is claimed; a probe PASS would demonstrate tolerance of this specific extra work, not an exact percentage of the evaluator's undocumented counting implementation.
- Fresh 2026-10-10 checks still failed the stricter probe at the 12-manual-line session update with a balanced 3/3/3/3 split. A 4/4/3/1 attempt overloaded the sale validator at eight manual lines; that attempt also FAILED. The final 3/3/4/2 split accounts for the different financial validator costs; no line is omitted and no commit is split. Monetary comparison evaluates its numeric subtraction once (non-numeric/missing operands fail Rules evaluation), retaining both original tolerance bounds. The full stricter suite subsequently passed, then passed again with expanded worker worst-case reservations, pending payments, mixed carts and all 12 malformed manual quantity positions.
- Latest stricter proof: exact candidate Rules SHA-256 `80d30beeb5eafd713e8b5dc9ad822c9c75f4ab4c5dea871f5ad6f21f1e262b0b`; RAM-only instrumented SHA-256 `4d0a7377b0c1681f23ee3ff0e59a06d80d1a852f8ae0106cc41a258b2b20e677`; captured `2026-10-11T02:24:38.909Z` (2026-10-10 Guayaquil). Owner/worker 12-stock, 12-manual, worker mixed 12, stock/manual reservation 12 and pending 12 passed, as did permission-scoped worker cash open/close and inventory/product mutations. Numeric strings, out-of-tolerance counter deltas and raw sale operation aliases reject the whole commit. Expression/access/internal-evaluator errors: zero. The proof demonstrates tolerance of 16 additional request-dependent predicates in each common operational record validator, NOT a guessed percentage of the 1000-expression budget.
- CI now requires the stricter probe after exact-source, full legacy Rules, and fresh exact-source repeat. Only sanitized proof JSON in `artifacts/spark-rules-proof/` is uploaded; private tenant backups are excluded. No instrumented Rules file is written, installed or deployed.
- Final local sequence exited 0: stricter full client suite (`02:24:38Z`), exact-source full client suite (`02:26:07Z`), and full legacy compatibility suite (`02:27:30Z`), all on Rules hash `80d30beeb5eafd713e8b5dc9ad822c9c75f4ab4c5dea871f5ad6f21f1e262b0b`. Both client proof JSON files explicitly mark `publicOperationalUI: false` and `physicalDeviceAcceptance: false`. No emulator remained running after CLI teardown. No production/deployment/cutover certificate is inferred.

## Bounded operational reads

The same Spark transaction transport now exposes server-only `readPage`: fixed scoped collection, document-ID ordering, maximum 100 records, strict cursor/order/scope/codec validation and auth checks after each asynchronous boundary. Cache/pending snapshots cannot be used as authoritative pages. Synthetic tests verify these failures cause no writes. Real client queries and a separate authenticated owner device are included in the operational Rules suite; this does not certify the full public UI or a physical second device.

Reference: [Firebase atomic-operation access limits and caching](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits). The documented 20-per-atomic-operation and 10-per-single-operation limits are separate from the 1000-expression guard; cached access is not a guarantee of expression headroom.
- No multi-line supported maximum or safety margin is declared until owner AND worker worst-case tests, including rejected payloads, pass the strict gate repeatedly. Do not activate these candidate Rules or public modular writers before that evidence exists.
# Catalog tombstone integration — 2026-10-12

`product_delete` uses the existing product/ledger reciprocal atomic proofs. It adds **no new external reference**: product identity, retained stock/qty, old deleted state and the restricted `deleted/id/businessId` diff are checked from `resource` and `request.resource`. The ledger requires that exact product's `lastOperationId`; the product requires a new permitted ledger. Worker authorization is `products.delete`, not `products.update`. Historical imported rows may normalize absent embedded identity, never foreign identity. Physical deletion remains denied; new edits/stock consumption of a tombstone are denied.

| Operation | Owner authorization | Worker authorization | Atomic cross-record proof | New external refs |
|---|---|---|---|---|
| PRODUCT_DELETE | Auth/path plus existing writable/storage control | Existing scoped membership and explicit delete grant | Product ↔ new ledger | 0 |

The unchanged existing SALE/INVENTORY/CASH budgets still require re-execution on this candidate: extra local predicates are not automatically free evaluation work. Exact Rules and stricter `+16` tests, with logs checked for expression/access-budget and internal evaluator errors, remain mandatory. A distinct-reference worksheet is not a measured Firestore bill or percentage headroom.

## Exact successor opening — 2026-10-12

The existing PWA reopening action creates a **new** session, not the DEV same-session `cash_reopen`. Its typed command uses `cash_open` with an exact previous report and expected revision. Core writes remain atomic: new session, opening movement, runtime, ledger and prior report's nonfinancial reopening marker. No preceding session, sale, product stock or financial report total is changed.

| Operation | Before / after external proof |
|---|---|
| SALE / INVENTORY_ADJUSTMENT / CASH_CLOSE / PRODUCT_CREATE / PRODUCT_EDIT | Existing references unchanged; full owner/worker regression and +16-predicate probe rerun |
| Ordinary CASH_OPEN | Same exact new-session reference reused by the origin predicate; no membership read for owner |
| Successor CASH_OPEN | Adds exact preceding report-after and preceding closed-session-after; verifies report identity/date/status/declared opening and the new session's parent/reason; owner-only |

The successor has a conservative logical bound of `8 + A`: control, ledger before/after, new session after, opening movement after, runtime after, previous report after and previous closed session after, plus existing account authorization `A`. The prior report's immutable financial diff uses `resource/request.resource`, not another read. Same-path references can be cached; this worksheet is not a billed/access-call count. Worker successor forgery is denied; ordinary authorized worker opening remains supported.

Exact source SHA256 `25c0b6b044281d8c6428d56d7b9e9f972620ef3bc9d85bdd5934c88feb2a8eb8` passed the real client SDK matrix and the RAM-only +16-predicate headroom probe, with zero expression/access-budget errors. Evidence: `output/spark-successor-final-rules-20261012.log`. This certifies these synthetic client operations, not production deployment, physical iPhone recovery or full staging.
