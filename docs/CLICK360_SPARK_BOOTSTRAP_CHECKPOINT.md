# Automatic Spark owner bootstrap — 2026-10-12

Continuation of PR #96 from `9bb3112954c7a9fc365e425d8e385e64b6713dee`. Same branch; no new architecture or PR. Production manifest freshly verified as `21409a1d2dc7`; no production deployment, Rules change, commercial write or real cutover.

## Connected and exercised

- Actual authentication installs the owner coordinator in the isolated Spark emulator/staging projects. The browser test no longer constructs the operational runtime.
- Authoritative mode/access, validated IndexedDB recovery, complete journal drain, progress verification, bounded module views, actor/context revocation and lifecycle cleanup.
- Browser-partition Web Lock prevents competing tabs, including when localStorage cannot provide a stable device ID. Business changes drain the preceding journal and durably pin the verified selection before repository replacement.
- Fresh independent-device views and document close/reopen preserve four unique sales, exact stock, tombstones and reports; the shared legacy document remains byte-for-byte unchanged.
- Exact current cash pointer/session are read together through the existing transaction transport, independent of the first hundred history rows. Missing or unknown summaries are rejected, never replaced with zero.
- Consent/configuration arrays are reconstructed correctly; only consumed configuration roots are queried, not unrelated notification/history leaves.
- IndexedDB rejects a legacy replacement or stale modular revision atomically. No store/cache/outbox is deleted.
- Historical working dates are durable per business in IndexedDB metadata, without changing the commercial snapshot, stock, sales or financial revision. A subsequent snapshot preserves these preferences; another user/business cannot adopt them.
- Cash history now loads subsequent server pages through the actual PWA. Paging shares the coordinator flight and cannot race a financial command, another page or business selection. It does not create any commercial operation.
- CRM and Activity use this same protected pagination. Spark Activity does not consult the V1 reader. Partial loaded-sales summaries are labeled, not presented as complete totals.
- The actual reopen action now creates a distinct session using the exact preceding report's declared cash. The old closed session and its financial totals remain unchanged. The new opening, ledger, runtime and prior-report reopening marker commit together. A previous confirmed close remains recognizable after its report is marked reopened.

## Demonstrated causes corrected

1. Bootstrap compared the harness's window configuration rather than the actual SDK project. The SDK project is the authority.
2. Listening to `approvedUsers` for an owner approved through `accountAccess` falsely revoked access. Listen to the actual approval source.
3. Reconstructing array entries using the current rather than next path component lost consent properties and raised an unexpected legal modal. The actual PWA installer now has a regression; no consent gate was bypassed.
4. A background rejected save could restore the preceding business during repository installation. The verified selection is now durable before exposing the new writer.
5. A paginated session list could omit the active session. A constant-size server transaction reads its exact pointer and authoritative summary.
6. Legacy `clean`/pending flags cannot authorize replacement of a pre-modular device snapshot. Such snapshots remain protected until an explicit reconciled handoff exists.
7. A closed session is deliberately not considered started. Cash/Sell rendering evaluated that condition before closed state, hiding the existing reopening action. The renderer now distinguishes closed from never opened; domain/financial validation is unchanged. Actual-renderer and served-journey regressions protect the branch order.

## Evidence and boundaries

`npm ci`, general QA, P0 Shary synthetic QA, client Rules, full simulator, integration, modular persistence, Spark component/scale/recovery suites and production dependency audit passed locally. Logs: `output/spark-bootstrap-final-regressions-20261012.log`.

The subsequent exact-cash/bounded-config candidate passed two served Chromium/WebKit repetitions plus Spark/client Rules/capacity suites: `output/spark-bootstrap-cash-pointer-final-20261012.log`. Complete journal counts 99/100/101/250/1000, legacy-clean contradiction, cache rejection and context isolation are permanent bootstrap regressions. Clean published-HEAD CI must be checked separately; dirty local evidence is explicitly tagged as such.

Published bootstrap commit `a6df35f27688e0f2822d8ad782de4b2f18821bf2` has all three required GitHub workflows SUCCESS. The subsequent date/history candidate passed the served Chromium/WebKit journey in `output/spark-history-ui-repeat-20261012.log`; native preference isolation passed four browser profiles in `output/spark-working-date-native-20261012.log`. An initial new assertion raced hash-route rendering; the test now waits for the actual history control to be visible, without sleeps, skipped checks or increased timeouts.

Published date/history commit `b2e533846933cfcf9cf9842a02a8b024bed660da` also has all three required workflows SUCCESS and a clean-source served repetition in `output/spark-history-exact-head-20261012.log`. Subsequent CRM/Activity pages passed `output/spark-operational-history-pages-20261012.log`. The new successor session passed the connected Chromium/WebKit journey in `output/spark-successor-served-ui-repeat-20261012.log`, after the demonstrated renderer defect was corrected. Rules passed exact and +16-predicate runs in `output/spark-successor-final-rules-20261012.log`; source SHA256 `25c0b6b044281d8c6428d56d7b9e9f972620ef3bc9d85bdd5934c88feb2a8eb8`. New changes still require their own clean-source full QA/CI.

These results are **not** full operational/staging/migration certification. Automatic worker V2 bootstrap, cold offline startup/multiple pending UI operations, remaining typed adapters, other history/report integrations and the automatic owner-wide reconciled importer/cutover handoff are still incomplete. The operational integration matrix lists unsupported paths; they cannot fall through to monolithic writes after activation.

The real iPhone snapshot/outbox is unobserved. No physical acceptance, Shary cloud confirmation, real shadow equality or safe real cutover is claimed. Production activation remains rejected. Next: complete these connected operational paths on this same branch, rerun the affected complete journeys, then certify real Spark staging before requesting owner production/cutover authorization.
# Worker and causal replay continuation — 2026-10-12

Continues the same PR #96, baseline `316ebe9ada28390841ba34ca44a7cd5795baa9ad`. Production remains `21409a1d2dc710315ab8c3c27e5da566f004cc8e`; zero production deployments, commercial writes or real cutovers.

Implemented:

- Native actual-PWA worker Auth/bootstrap, scoped codec-verified mode proof, authoritative membership, permission routing, server revocation and Founder owner-contract inheritance. Worker does not pull V1 snapshots or read private owner-wide metadata.
- Actor-scoped journal indices; unscoped complete recovery census retained. Unknown/malformed issuer fails closed. v1–v4 native upgrade preserves immutable payloads, hashes, revisions and state.
- Journal v5 monotonic transactional enqueue clock and chronological replay indices. Reverse IDs, equal timestamps, clock rollback, restart and bounded first-page ordering pass all three browser engines.
- Multiple known queued offline candidates; no server projection until financial drain; uncertain rows and dependent revision-bearing edits remain gated. A failed device-candidate persist blocks further candidates.
- Actual two-offline-sale worker PWA → document close → online restart → complete authoritative replay. Each sale/movement occurs once; stock and exact cash-session counters match server.
- Rules retain worker writable owner-contract enforcement. Twelve custom line proofs partitioned among mandatory ledger/sale/movement/session/runtime records in the same atomic transaction. Exact and +16 client SDK suites pass; missing runtime and tampering at all twelve manual indices reject without budget exhaustion.
- Same-business actor change now clears only the in-memory unsubmitted checkout draft and scopes the draft key by auth UID. Native snapshots/journal are preserved. Actual-handler regression fails before the fix and passes after it.

Evidence: `output/spark-worker-ui-20261012.log` (full owner+worker served Chromium/WebKit), `output/spark-worker-offline-focused-20261012.log` (focused diagnostic, NOT full certification), `output/spark-actor-journal-20261012.log`, `output/spark-multi-replay-20261012.log`, `output/spark-worker-rules-20261012.log`, `output/spark-worker-rules-headroom-20261012.log`. Rules SHA256 `95007fec1ba1b002ce9935c1b195c6c2b7e09202714ee58117342d5e80008ef8`. The final draft-isolation change additionally passed actual-handler checkout/refresh and UI boundary regressions. Final clean-HEAD CI is still a separate gate.

Remaining release gates are engineering work, not billing: connect automatic owner-wide migration/source reconciliation and runtime handoff; complete required blocked operational matrix adapters or fail eligibility closed; certify cold offline bootstrap, old-build upgrade, real Spark staging journey and recovery. Do not enable production or assert SHARY cutover readiness based on these component/served-emulator results. The current physical iPhone source is not yet observed or cloud-confirmed.

Next: continue automatic migration integration from the preserved local source, full unscoped owner recovery census and exact remote revision/hash; never infer completeness from the remote historical monolith or first journal page. Production activation remains OFF and requires final owner authorization.
