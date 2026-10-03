# Capacity P0 checkpoint — 2026-10-03

Base: main `dc77604d9a9f9dd602a61b24a20c5070eee853c7`. Preserves #83/#84/#88/#89. No production writes or deployment authorized by this change. Founder contract unchanged: 2 businesses, 2 workers, 2,000 active products.

## Demonstrated cause and bridge

The actual `save()` function rejected a synthetic online 860KB mutation because its device guard selected the 850,000-byte cloud budget. The initial snapshot/backup validators had the same coupling.

Device budget is now 8MiB, independently of the unchanged 850,000-byte cloud payload guard. Above the cloud budget, a mutation requires verified IndexedDB and critical actions wait for its transaction to commit. No legacy push or forced remote hydration is allowed to replace the capacity-pending local snapshot. Cloud status is explicitly pending, never synced. The original base revision and pending operation IDs survive restart. CAS protects capacity-pending snapshots against another tab or a cloud-mirror overwrite. Device failures restore the preceding local candidate; they cannot fall back to an oversized cloud write.

This is a bridge, not a cloud capacity solution. Do not deploy it as a substitute for modular persistence. Pending operations are snapshot-backed operation IDs, not yet a modular replay journal. Two devices can accumulate distinct local changes: they require supervised reconciliation, never automatic stock merging. Old builds do not implement this new IDB CAS fence; preserve physical-device data and upgrade safely before enabling the bridge.

## Fresh read-only evidence

Capture: 2026-10-03T18:12:50.970Z. Server revision: 1791050138270. Native backup SHA256: `9c421955d191d9dd50791e434897ff7516131c63580ad1e9ac0eb1bc029496f1`. Native fields SHA256: `a2d2cff0ef75db8eba7c5927cef1966fa0f69f45f4263e5218a90d036f943fab`.

463 products / 30 sales / 107 movements / 24 cash sessions / 22 daily reports / 272 embedded audit records. The 03/09 $30 sale and linked movement occur once; the exact session is closed and has one report. No sale/product/movement changes versus the previous verified capture. Do not repeat sale or close. Other audit collections remain in the private native backup; no personal data is published here. The iPhone's latest local outbox is not available, so remote persistence does not certify absence of local pending work.

Hosting manifest served during this session: `66dfa9fb517a`; no deployment performed. This is the #89 source build, not an assumption that the phone still runs #84.

## Verification and acceptance boundaries

The actual-source harness reproduces the original failure and covers 840KB/860KB/900KB/1.2MB/3MB/7MB and rejection above 8MiB. Browser checks execute actual `save()` with native IndexedDB, cold page restart, stale-tab CAS and cloud-mirror fence in iPhone-emulated WebKit, Android-emulated Chromium, desktop Chromium and Firefox. These are automated emulations, not physical iPhone/Android/Windows/Safari/Edge acceptance.

Existing cash-close regression now tests rejection above the independent 8MiB device budget, and a real application 1.2MB close, no cloud push, unchanged sale/stock and application IndexedDB rehydration. Cloud size remains guarded separately. CI includes permanent capacity checks; do not merge unless all existing checks and this job pass.

## Controlled release and rollback

1. Complete QA and certify committed artifact SHA, manifest and served file hashes in isolated staging.
2. Obtain a fresh read-only native backup and safely capture/compare the device outbox. Stop on unresolved differences.
3. Present separate Hosting-only approval. Keep current Hosting version recoverable; no rules/functions/indexes deployment with the bridge.
4. Upgrade the PWA without deleting IndexedDB; verify build and local pending-state recovery before one supervised operation.
5. Rollback cannot discard newly local-only operations. Stop writers and export/reconcile the capacity-pending IndexedDB snapshot first. Reverting Hosting alone is NOT a safe rollback after such writes.

Modular work is isolated on `feature/modular-persistence-v3-capacity`, based on current main, preserving #85 as draft. Native shadow comparison is offline only and not an applied migration. Cutover requires remote shadow equality, fresh source revision/hash, a rules-enforced legacy write fence, a per-business flag, approved migration and post-write independent verification. No SHARY exception belongs in shared code.
