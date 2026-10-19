# P0B integration evidence — 2026-10-17

Production remains `9090f2105d17f2b10e2dd97bab7a548df671597b` (P0A only).
No production commercial writes, cutover, merge or deployment in this work.
PR #96 remains the only operational continuation; no Blaze or Functions.

## Exact published staging baseline

`ee5805236ebf1b5aced5c65b1f516a2e2aa39564` has all three required GitHub
workflows SUCCESS. Hosting serves that build at
<https://click360-staging-7620168025.web.app/>; its seven release-critical
assets matched the isolated exact-commit build. Deployed Rules SHA-256:
`6f7bda04f4c7461dc8959b2113324a36a409996ad50976139fb78ab17d8270f6`.

Actual Web SDK/Auth/Rules/PWA retail journey passed Chromium and WebKit:
owner/worker, revocation, two businesses, exact cash sessions, sales, inventory,
receivables, printing one label, two offline sales followed by restart/replay,
and independent browser-device reads. Final pending/UNKNOWN counts were zero.
This uses seeded synthetic modular authority, **not** an automatic cutover.
Evidence: `output/staging-ee58-retail-20261017.log`.

Both browsers also passed 903,721-byte local-newer shadow import, server reread,
semantic equality, durable source preservation and cold restart. Hash pairs:

- Chromium: `a57b7d9db1dc9aa429c0616045db070e51c0942c8501fb5cfcf4fe5ebb5b4ecd`.
- WebKit: `39b33cd819fec521e6e31f171c7e554e45d55b19168bd89707be27d9bf5d7d11`.

Evidence: `output/staging-ee58-shadow-20261017.log`. No operational writer or
cutover was activated. Hosting rollback channel `pre-ee58-20261017` preserves
the preceding staging build; native Rules and manifest are retained privately.

## Subsequent connected candidate (requires its own exact-HEAD gates)

- Owner manual movement edit/cancel is an atomic append-only compensation,
  optional replacement, immutable original amount, cash counters and ledger.
  Sale receipts/openings/inventory/closed history/unproven imported movements
  are excluded, never silently passed to legacy.
- The served PWA regression reproduced a real projection defect: operation-ID
  matching collapsed reversal and replacement. Canonical record IDs now win;
  only a single-receipt legacy alias can be normalized by operation ID.
- The actual modal handler rebinds an equal durable-refreshed live movement;
  stale content/revision cannot mutate state or enqueue a command. Native VM,
  repository and served Chromium/WebKit journeys exercise these paths.
- Runtime preparation is connected after verified shadow and a durable handoff
  pin. Exact administrative approval, source/device/journal stability, complete
  business coverage and server reread are required. Interrupted preparation
  resumes idempotently; only exact approved derived runtimes can be excluded
  from original-source semantic reconstruction. Mode remains `migrating`.
- Approval records are **private per owner**, including complete approved cash
  summaries. They must not be stored in globally readable rollout flags. Owner
  self-authorization, cross-owner/worker/anonymous reads and summary forgery
  have permanent Web SDK Rules tests. Approval does not authorize cutover.

## Fresh production recovery inspection (read-only)

### Subsequent exact staging certificate: `fef3521`

Exact candidate `fef3521f0a5210d2c1676e5c2613165217b7a280` was deployed only to
the synthetic staging project. Hosting bytes matched its isolated build and
Rules SHA-256 was
`bc0c15deee331adb436de2923f62830039120ea6f55eb9d104d7d0129827c160`.
Both Chromium and WebKit passed the actual retail journey, followed by the
shadow **and private-approved runtime preparation** journey. Two businesses,
903,721 bytes, two restarts, unchanged original IndexedDB and legacy, no writer
installation and no cutover. Source/reconstructed hash pairs were equal:

- Chromium: `ff29cdaa7fe147954fbf457d36c045d2bb26f23a7ad19a2562c15df02c5a0e1c`.
- WebKit: `02ceacc87ac341c7061a7416745056757d1b41cd8918707a2cf447829a4fb101`.

Evidence: `output/staging-fef3521-retail-20261017.log` and
`output/staging-fef3521-runtime-shadow-20261017.log`. This certifies their
explicit scopes, not an end-to-end automatic operational cutover. Hosting
channel `pre-fef3521-20261017` and private native Rules backup retain the
preceding build. Production was independently reread and remained `9090f2105d17`
with Rules hash
`1d65fe291deac9664805f5b5425b36dfad30f8e2baae8db44dc72e65489ff4e6`.

The next connected unit verifies a pre-modular local source before the existing
bootstrap IndexedDB CAS, **only after** an independently approved modular
control already exists. Private approvals, complete source/journal pins, exact
metadata/working date, whole-owner coverage, fresh complete server reread and
semantic equality are mandatory. It never changes storageMode or policy. New
remote operations or local drift stop this first handoff verifier; they are not
silently reconciled or overwritten. This unit requires its own exact-HEAD gates.

The received copy reconstructed to snapshot SHA-256
`f58503079fa2cbd8ca326b726eb4af9a5246ef82209e4b9462577047898afd55`:
20 parts, 931,078 bytes, 45 sales, 134 movements, 463 products, 36 sessions,
34 reports and 312 audit records. It preserves 15 sales and 27 movements not
in the historical legacy document; no duplicate IDs were found. The captured
command journal has zero executable/UNKNOWN rows; 76 separate legacy-save
references are preserved, not replayed as transactions.

The copy was verified on October 15 at 19:29:37 America/Guayaquil. It does not
prove that the iPhone has made no newer changes. Read-only handoff planning of
that captured source preserves ten connected closed-history sessions as
immutable evidence; no payment method or zero counter is invented.

`RECOVERY_COPY_CLIENT_VERIFIED` is not `OPERATIONAL_CLOUD_SYNC_CONFIRMED`.

## Gates still required before real activation

### Further connected candidate: independently approved automatic activation

The exact `c8a7fe6` baseline has all three workflows SUCCESS and both real
staging matrices PASS in Chromium/WebKit. Its native handoff preserves the
original immutable pin while an exact full-record IndexedDB CAS safely changes
the working cache. A forged flag, concurrent working-date change, wrong tenant,
pre-cutover proof and production entry cannot clear capacity protection.

The subsequent coordinator candidate reuses that full verifier in a distinct
`PRE_CUTOVER_VERIFIED` phase. Explicit administrative `automaticMigration` AND
`automaticCutover` are required in addition to the exact private source/build/
whole-owner approval and prepared runtime authorization. A transaction rechecks
control revision, legacy revision/hash, private approvals, every runtime and the
native source/journal before changing ONLY owner-wide storage control. A fresh
server confirmation precedes the separate MODULAR handoff/cache/view bootstrap;
the metadata transition itself never claims operational cloud confirmation.
The owner must not publish its own approval and production remains fail-closed.

Actual Web SDK emulator tests include authorized activation and maintenance
between preflight/commit (control revision, private approval, same-revision
legacy content and runtime) without altering commercial records. Full exact-
HEAD CI, strict Rules budget and real served automatic-flow staging are still
separate mandatory gates. The staging harness has an explicit synthetic-only
automatic option; the earlier manual fixture is not relabeled automatic.

Runtime preparation is not the owner-wide operational cutover/local installation
handoff or worker-proof publication. Nonempty executable migration journals,
sale cancellation, broader unsupported financial modules, complete historical
aggregates and compound print-profile/default settings remain separately gated.
Do not claim universal operational coverage or enable those tenants prematurely.

The current iPhone source must be read and reconciled on the original origin;
unknown operations, drift or semantic differences stop activation without
overwriting local data. Production promotion and actual individual cutover still
require the owner's final evidence-based authorization. No physical iPhone,
physical printer or physical second-device acceptance is inferred from emulation.

## Final integration follow-up (17 October, Guayaquil)

`6450adef5f9412bec5287bd2854426af6c0663b5` has all three GitHub workflows
SUCCESS. The previous `760e76f` real retail journey passed both Chromium and
WebKit. The real `6450ade` automatic owner coordinator also reached verified
activation, native handoff, imported-session close/report and restart in
Chromium. Its WebKit preparation exceeded the test's single 30-second envelope;
that matrix is NOT certified. Completed import chunks/scopes are now observed
with a bounded per-progress deadline; a repeated heartbeat, oscillation, conflict
or stall cannot reset it or authorize success. No business retry or financial
verification has been removed.

The next candidate adds worker scoped proofs for every owner business in the
SAME root activation transaction, derived from authoritative accountAccess
(approvedUsers only if absent). Proofs contain only plan/overrides and exact
source identity. Each is server-reread; post-handoff accepts only these exact
derived paths, never generic metadata exclusions. Founder override 600 remains
stored as 600 and the existing acquired floor still evaluates to 2/2/2000.

Rules change only five root reads in the scoped-proof write predicate from
get to getAfter. Owner/worker identity, contract, field allowlist, commercial
transaction validators and legacy permissions remain unchanged. Rules do NOT
force an arbitrary owner client to publish every business proof: the coordinator
enforces full coverage atomically and verifies it. A missing proof denies worker
availability rather than granting permissions. Do not misrepresent that boundary.

The real protected-history cash renderer/handler now offers an owner-only new
independent session with explicitly entered fund and working date. It never
modifies the protected predecessor or infers unknown historical counters. The
real handler/parser VM regressions pass; this particular new button still needs
its served-browser result and is not covered by the older successor certificate.

Spark UI emulator listeners use dedicated non-ephemeral ports; startup reports
exact port conflicts and aborts readiness on child exit. Teardown owns only its
captured process tree, including detached Java descendants. A zombie is proven
from process state, not interpreted from EPERM alone. New lifecycle, progress,
contract-drift and missing/conflicting scoped-proof regressions are permanent.

Production remains recovery-only and unmodified. The most recently received
physical-source copy must not be presented as the current iPhone's complete
state. Full latest-candidate CI, served staging, production approval and physical
device reconciliation remain separate gates.
