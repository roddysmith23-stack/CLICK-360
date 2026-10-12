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

## Demonstrated causes corrected

1. Bootstrap compared the harness's window configuration rather than the actual SDK project. The SDK project is the authority.
2. Listening to `approvedUsers` for an owner approved through `accountAccess` falsely revoked access. Listen to the actual approval source.
3. Reconstructing array entries using the current rather than next path component lost consent properties and raised an unexpected legal modal. The actual PWA installer now has a regression; no consent gate was bypassed.
4. A background rejected save could restore the preceding business during repository installation. The verified selection is now durable before exposing the new writer.
5. A paginated session list could omit the active session. A constant-size server transaction reads its exact pointer and authoritative summary.
6. Legacy `clean`/pending flags cannot authorize replacement of a pre-modular device snapshot. Such snapshots remain protected until an explicit reconciled handoff exists.

## Evidence and boundaries

`npm ci`, general QA, P0 Shary synthetic QA, client Rules, full simulator, integration, modular persistence, Spark component/scale/recovery suites and production dependency audit passed locally. Logs: `output/spark-bootstrap-final-regressions-20261012.log`.

The subsequent exact-cash/bounded-config candidate passed two served Chromium/WebKit repetitions plus Spark/client Rules/capacity suites: `output/spark-bootstrap-cash-pointer-final-20261012.log`. Complete journal counts 99/100/101/250/1000, legacy-clean contradiction, cache rejection and context isolation are permanent bootstrap regressions. Clean published-HEAD CI must be checked separately; dirty local evidence is explicitly tagged as such.

These results are **not** full operational/staging/migration certification. Automatic worker V2 bootstrap, cold offline startup/multiple pending UI operations, durable working-date preferences, all remaining typed adapters, history/report pagination and the automatic owner-wide reconciled importer/cutover handoff are still incomplete. The operational integration matrix lists unsupported paths; they cannot fall through to monolithic writes after activation.

The real iPhone snapshot/outbox is unobserved. No physical acceptance, Shary cloud confirmation, real shadow equality or safe real cutover is claimed. Production activation remains rejected. Next: complete these connected operational paths on this same branch, rerun the affected complete journeys, then certify real Spark staging before requesting owner production/cutover authorization.
