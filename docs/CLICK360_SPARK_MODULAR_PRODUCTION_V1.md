# Spark modular production V1 — active implementation, 2026-10-06

## Source and production boundary

- Branch: `release/spark-modular-production-v1-20261006`, based exactly on main `21409a1d2dc710315ab8c3c27e5da566f004cc8e` (#93).
- Published fixes #83/#84/#88/#89/#90/#93 remain untouched. Device budget 8 MiB and legacy cloud guard 850000 remain unchanged. Founder acquired floor remains 2/2/2000.
- PR #95 source: `2378dcac6acb2dd307f314df3b09447057078031`. Commit `a7320c2` ports its independently tested DEV repository/journal/coordinator/UI-boundary/policy and tests as new files, without runtime activation.
- PR #94 stays open/preserved: `OPTIONAL_FUTURE_SERVER_VERIFIED_BACKUP`. It is not a production dependency. No Functions, Storage, billing or external service is introduced here.
- Nothing in this candidate automatically starts a migration, loads these modules into production, or enables production transport. Staging/emulator import is explicitly allowlisted; production currently fails closed.

## Implemented and tested

1. Universal owner/business-scoped planner preserves original IDs, stock/qty, relationship fields, working dates, settings, empty arrays and fields not recognized as operational modules. Ambiguous business attribution stops instead of guessing.
2. SHA-256 canonical source and per-module hashes; independent semantic reconstruction detects missing/corrupt/extra records. Report references are not extra sale transactions.
3. Source selector requires fresh server provenance, explicit zero unknown operations, native device durability and revision continuity. Newer pending local state is selected only if its base revision matches remote. Clean/different copies, unknown operations and remote drift stop without overwriting either copy.
4. Separate immutable IndexedDB recovery pin preserves the snapshot and pending-operation metadata. It never opens/clears/upgrades the production tenantSnapshots database or journal. Hashes are checked on independent readback and after page close/reopen.
5. Authenticated client-SDK importer writes bounded groups of 25 final-path shadow records with deterministic IDs. Existing same-content records are no-ops; mismatches stop. Interrupted import resumes without duplicating records. It queries all modules, including source-empty ones, before comparing server results.
6. Between batches, durable revision/unknown-count/mutation-lock guards avoid rehashing the complete history. Full source/server/recovery hashes are checked at phase boundaries. No polling or retry timers are added.
7. Candidate `firestore.spark.rules` adds owner-wide storage control, phased migration, immutable shadow, role/identity boundaries and an `existsAfter/getAfter` legacy fence. Owner-wide is necessary because legacy state/main contains all businesses.
8. Frozen `firestore.rules` remains byte-identical to main. Candidate rules are tested separately, including the entire legacy client Rules regression suite. The candidate is not configured for default production deployment.

## Tests observed locally

- npm ci: completed with Node 22. Runtime audit (`--omit=dev --audit-level=moderate`): zero vulnerabilities. Full development dependency audit is not zero; no blind dependency force-upgrade was performed.
- npm run qa: PASS, including frozen sentinel, current Founder override parity, device-capacity sizes and quick simulator; build:static PASS.
- npm run qa:rules: PASS on unchanged legacy rules, including owner/worker/admin isolation, concurrency, exact-session close and restore safety using synthetic emulator data only.
- npm run qa:p0:shary: PASS, including automated WebKit iPhone/PWA close regression; no physical client test is claimed.
- npm run qa:simulator:full: PASS, 2600 actions / 100 reports.
- npm run qa:modular-persistence: PASS, DEV transaction/journal/coordinator/adapter in Chromium/WebKit/Firefox. Synthetic transactional transport is not certification of production operational Rules.
- npm run qa:spark: PASS. 2000 products, 5000 sales, 5000 movements, 5000 audits, two businesses: 17022 records; source/reconstruction SHA-256 `6fc00f9fbfa3e4d3f28dc570aef5ee2522a1a9a91f0393c5e41056b7cb97ba62`.
- Distributed structured fixtures 850000 / 860000 / 1 MiB / 1.2 MiB / 3 MiB / 7 MiB reconstruct exactly; largest document in the 7 MiB fixture is 14999 bytes, not a multi-MiB Firestore document.
- Native IndexedDB recovery: PASS in automated Chromium/WebKit/Firefox, 900 KB snapshot, page close/reopen, immutable pin, preserved unknown requests, owner isolation.
- Client Rules/importer: fresh SDK reread + equal SHA, interruption/resume, duplicate request, changed source, different device, missing lock, extra source-empty-module record and rejected legacy write. Repeated full-emulator runs are required in CI.
- Final candidate Rules/importer ran twice with independent emulator startup/shutdown: PASS both times. Entire legacy Rules suite also passed against the Spark candidate after correcting the missing-control read boundary; no expression/access-budget errors.

## Fresh read-only real evidence

At `2026-10-06T08:40:49.048Z`, authorized server acquisition preserved native `google.firestore.v1.Value` fields in private, ignored artifacts. Revision `1791072715866`, source update `2026-10-04T00:11:57.409Z`; counts 463 products / 30 sales / 107 movements / 24 sessions / 22 reports, plus 251 root audits / 144 unit audits / 7 admin audits. The historical 03/09 sale of $30 has exactly one sale, one associated movement and one session report.

Native state-fields SHA-256 remains `7bec358a040cb421379d118ac9b627bf982f49fd05e2e0be4c43ecb7e78153bf`. New backup file SHA-256 `7eaa91807a8e5ee533833d12d4d4df8908bee4cf33ebcc2114b23854379edc26`, independently verified against its manifest. Production manifest still serves `21409a1d2dc7`. No commercial write or deploy occurred. This read does NOT establish that subsequent iPhone-only operations are cloud-confirmed.

Read-only planning against that real backup exposed and corrected a synthetic-fixture mismatch: published identity is in `payload.identity`, not commercial `payload.data.identity`. Both envelope and optional embedded identity now validate strictly without injecting fields into the original snapshot. The real legacy body (848634 bytes, 2206 planned records, one business) reconstructs with equal SHA-256 `65ceac1312a1429bada1a25273ca83388269313d07b73ee7845ec49988a17ced`. This is a local read-only planning result, NOT a real remote shadow or verification of current iPhone state. The authenticated emulator importer fixture now uses that exact envelope shape.

## Real defects found and fixed during certification

- Recovery E2E intercepted only the first page; a newly opened page attempted DNS. Context-level routing fixes the test lifecycle, without raising timeouts.
- Running two emulator suites together collided on hub/websocket ports and left a synthetic orphan emulator. That exact process was identified and stopped; Spark uses dedicated ports 48944–48947, with suites sequenced.
- An initial additive shadow-read rule accidentally widened old worker-boundary owner access when its rollout flag was absent. The full existing Rules suite caught it; Spark module reads now require the Spark storage control and matching business scope. Existing legacy assertions were preserved.
- The R38 frozen-file assertion was not disabled or updated. The Spark candidate ruleset is isolated from the unchanged legacy release rules.

## Trust and release limits — not yet production ready

Firestore Rules authorize identities/phases/transactions; they cannot SHA-256 reconstruct thousands of arbitrary documents. This operational migration uses an authenticated owner's current client to reread and compare its own data. It is **not** an independently server-verified disaster backup, and must not advertise that guarantee. #94 remains the optional future independent verifier.

The imported DEV operational kernel uses flat records; shadow records preserve source under `data`. A common pure record codec now verifies hashes/identity/revisions, preserves imported custom fields/origin, retains native server metadata and maps business config/main correctly. Its unit test passes. Real SDK transaction integration is still required; never activate the existing kernel against nested shadow records unchanged.

Still required before staging/cutover: real UI/bootstrap/repository wiring; atomic operational Rules and worker scopes; exact-session authoritative payment/cash counters; all product/stock/layaway/customer/config adapters; durable UI replay; paginated UI/printing views; migration lock integration; PWA update/release asset cohesion; legacy external audit/module reconciliation; actual staging Auth/Firestore E2E; fresh production backups; forward-safe freeze/export/reconcile recovery. Real iPhone local state has not been acquired by this candidate; remote state is not proof of its newer local-only operations.

Before cutover, pinned legacy/local source must stay intact. After cutover, recovery must freeze writers and export/reconcile modular/journal operation IDs, never restore old state/main over newer data. The importer currently deliberately stops at verified shadow, with `cutoverPerformed: false`.

Neither `SHARY_FULLY_OPERATIONAL_CLOUD_CONFIRMED` nor `CLICK360_SPARK_MODULAR_PRODUCTION_READY` is asserted. Do not contact SHARY for technical diagnostics or repeated operations. Continue implementation on this branch, not #94/#95 and not main.

## Continuation commands

At head `ef896d5`, all mandatory GitHub checks passed, including labels, inventory conflict and Spark safety. New transport/census changes require their own HEAD certification. Locally, the new Spark pure/scale tests and IndexedDB recovery in all three engines passed. A subsequent Rules run failed before scenarios while uploading Rules to the emulator (`UND_ERR_HEADERS_TIMEOUT` from loadFirestoreRules); contemporaneous host load was 165.84 with substantial swap activity. This is not labeled flaky or a passing run; emulator logs contained no completed rule-upload response. A fresh sequential run is being checked without increasing timeout, disabling checks or stopping unrelated processes.

Use Node 22 / Java 21. `npm run qa:spark`, `npm run qa:spark:rules`, `npm run qa:spark:legacy-rules`, `npm run qa:modular-persistence`. Full release remains gated by all existing workflows plus `Spark modular client safety regression`; no deploy job is added.

Next engineering step: integrate the tested common codec into the actual transactional repository and UI adapters, then certify Rules-enforced sale/stock/session/ledger atomicity with the actual Web SDK before permitting cutover. Preserve the current private read-only backup artifacts; never commit their contents.

The bounded SDK-compatible transaction transport now connects the codec to record reads/writes, caches repeated reads, enforces read-before-write, validates every staged write before submitting any, preserves native timestamps and checks authenticated owner/context and verified modular phase. It rejects production project activation. Synthetic transport tests pass, including second edits of new records without undefined origin fields, identity/version failures with no commit, scope expiry, auth changes and constant record reads. This is transport certification only: real operational client Rules, domain transactions and UI integration remain release gates.

The universal sanitized read-only risk tool (`scripts/storage-risk-readonly.mjs --read-only --project=click-360`) performed one paginated administrative census at `2026-10-06T10:39:57.522Z`: seven legacy root state documents, five remote-capacity GREEN, one YELLOW, one unrecognized legacy source requiring review (RED). It does not emit names, UID, emails, commercial records or paths. The near-ceiling source remains 848634 bytes / revision 1791072715866. Device pending/unknown counts are explicitly unknown, not zero; remote GREEN never means the physical device is fully backed up. Modular-only businesses without state/main are outside this legacy census; full modular health enumeration remains necessary after operational integration. No account/licence or commercial document was changed.

PR #96 tracks this branch. At head `a9f85a4b7e2f330f7b0bd178b6667cc9cc337343`, all GitHub CI workflows passed, including the complete labels/integration suite and 30 same-product races. Local full integration reached the responsive WebKit sweep but timed out taking a screenshot after fonts loaded; no timeout was increased or browser skipped. Independent rerun of that unchanged sweep passed in Chromium and WebKit across all 9 widths and 14 routes. This establishes an isolated passing run, not a proven cause for the earlier local screenshot timeout. New codec/recovery-boundary and real-envelope changes require new HEAD CI certification; no production readiness is inferred.
