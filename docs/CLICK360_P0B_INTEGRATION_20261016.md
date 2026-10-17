# P0B continuation — 2026-10-16

PR #96 continues from `669b6465b4d0ebaf6fb24afd3e144c94672c141d`.
Production remains P0A `9090f2105d17`; no production Rules, policy,
storage mode or commercial records are changed by this work.

## Integrated changes

- Existing business profile and universal label editor use owner-scoped,
  revisioned config/template/profile commands with an atomic operation ledger.
  Account expiry still denies these writes. Workers cannot forge the command.
- Migration pins all durable source metadata as well as the snapshot hash.
  Changing the remote base or pending save references stops shadow preparation.
- Cash proof covers the same business partition as the importer. Missing-session
  financial records cannot silently disappear from its proof because of a date.
- An explicit **staging-only** historical-read-only opt-in preserves closed,
  unverified financial connected components without fabricating counters or
  changing original records. Active balances, missing relationships and open
  financial conflicts stop the plan. Unassigned zero-valued legacy expense/
  withdrawal notes can only be preserved immutably, never attached by date.
- Import rereads verify original semantic equality **and** operational summary/
  immutable-history metadata. The codec and client Rules deny history writes.
  Independently opening a new cash session remains permitted.
- Exact receipt/projection reads and the same bounded 25-record import chunk
  use parallel independent reads inside their original transactions. The
  transport reserves record budgets before awaiting and deduplicates concurrent
  reads. No checks, records, atomic writes or browser deadlines were removed.

## Demonstrated failures and regression coverage

1. Same snapshot/revision but changed pending references previously reached
   import. The new metadata-drift regression fails before the correction.
2. Orphan financial records on another date were previously omitted from cash
   proof. Exact-association coverage now rejects them without inventing sessions.
3. New shadow metadata validation increased verbose-denial evaluation cost.
   Coverage traced that branch during modular financial denials. Explicit
   mutually-exclusive phase routing avoids evaluating shadow authorization for
   operational writes; history checks remain on every history-capable update
   path. Settings authorization uses literal paths and an account-checked owner
   fast path. The existing +16-predicate headroom test remains mandatory.
4. A direct Rules diagnostic could print PASS after negative tests exhausted
   the evaluator. The test now checks the complete emulator log before emitting
   a certificate, independently of its lifecycle wrapper.
5. The universal template save callback referenced an out-of-scope profile
   variable. It now resolves its own device preference; the legacy contract and
   double-click/finally guards remain tested.

## Evidence boundaries

Real staging served baseline `669b646` with backed-up Hosting/Rules. Its first
retail restart and shadow runs failed their unchanged deadlines; those failures
are retained. A read-only timing diagnostic using the existing synthetic owner
then passed two starts, with authoritative module query durations recorded.
That is diagnostic evidence, not a replacement for the complete retail journey.
The new bounded-read implementation needs its own served-candidate repetition.

Pure source/codec, repository, bootstrap, full outbox, historical preservation,
client Rules and the legacy `npm run qa` have separate local results. Rules
backend compilation passes on SHA256
`087ac604399bea893a59e2c90e89ac2bc558178efd45eb7d8ab4f124d16d1a88`.
Exact final-commit CI, complete served staging, and PWA upgrade must be checked
again after committing; earlier green CI is not inherited by these changes.

Owner recovery evidence remains private and read-only. Analysis of a previously
verified copy is not a fresh physical-device read, remote modular equality or
operational cloud confirmation. No real financial corrections are inferred.

## Still not authorized or certified

No production operational activation/cutover, global rollout, repair, restore,
Blaze, Functions or paid service. Automatic cutover and executable command
handoff remain blocked. The operational matrix still explicitly excludes bulk
imports, financial cancellation/compensation, unsupported layaway transitions,
and distinct supplier/restaurant/logistics writes. Do not claim universal
operational compatibility or SHARY recovery from these component results.

Finish the complete served staging journey and remaining required adapters,
then present exact release/rollback evidence for owner approval. Never ask the
client to repeat transactions or erase her original PWA storage.

## Served `cd48d16` repetition and confirmation cost

The committed candidate passed the served owner/worker emulator journey in
Chromium and WebKit, including shadow equality and preserved UNKNOWN recovery
copies. Real staging's restart still failed the unchanged 30-second assertion:
financial pending=0, UNKNOWN=0, projection pending=2. This remains a failed
staging gate, not a quota/billing diagnosis or permission to retry sales.

The confirmation path redundantly queried an immutable ledger a third time in
the same attempt, and rechecked/materialized the derived audit in separate
transactions. The permanent native-IndexedDB test fails against `cd48d16` with
`DUPLICATE_AUTHORITATIVE_CONFIRMATION_LOOKUP` and passes after using the already
authoritative same-attempt receipt. A restart/confirmed IDB row still performs a
fresh lookup; the receipt is never persisted as a cache shortcut.

Only the certification UI defers its secondary audit until the bounded
authoritative projection transaction. Ledger/sale/movement/stock/cash remain
atomic. Audit and local projection must complete before UI confirmation; a
failure stays durably projection-pending, without repeating commerce. Other
repository callers retain their original immediate-audit behavior. Synthetic
transaction and real client-Rules regressions verify materialization, retry and
unchanged commercial revision. The new served candidate must repeat staging;
these component proofs do not replace that gate.
