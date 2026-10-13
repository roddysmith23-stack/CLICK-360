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

Prior staging Rules release: `projects/click360-staging-7620168025/rulesets/f93ec879-f6e8-4a79-8186-e0ded9b387a1`, SHA256 `38b504d5d0806071c6d29b1787d8261aa2dc8026ecdba891352158b8147a448b`. Its source and metadata are retained privately under `output/private/spark-staging-before-20261013/`. Rollback Hosting command is `firebase hosting:clone click360-staging-7620168025:pre-spark-20261013 click360-staging-7620168025:live --project click360-staging-7620168025 --config firebase.spark-staging.json`; Rules rollback must restore that exact saved ruleset, not alter commercial documents. No rollback to older commercial snapshots is permitted.

Automatic owner-wide migration/cutover and remaining matrix adapters are still prerequisites. Physical iPhone local source/outbox is unobserved. No SHARY cloud recovery or production-ready status is inferred from synthetic staging results.
