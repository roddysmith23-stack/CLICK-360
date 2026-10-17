# P0A — original-device recovery preservation

Continuation of PR #96 from `5c1c657a7f99fa4531e9c82a7dfa9f8bba836e3c`.
No production deployment, commercial mutation or real customer activation.

## Boundaries

`RECOVERY_COPY_CLIENT_VERIFIED` means the authenticated client reread the
immutable fragments from Firestore, reconstructed the exact durable record and
complete journal, and checked canonical SHA-256, byte identity and counts.
It is **not** independent server verification and is **not**
`OPERATIONAL_CLOUD_SYNC_CONFIRMED`. A manifest flag alone is never sufficient:
every reuse revalidates all fragments. No Function, Storage or billing dependency.

This uses the existing PWA bootstrap, native journal, immutable recovery store,
canonical SHA-256 implementation and Firestore Web SDK. It does not alter the
operational transaction repository or replace modular migration.

## Connected sequence

1. Existing Auth resolves the owner and tenant. Mixed-build/context checks and
   the existing owner/device Web Lock remain mandatory.
2. Read the original same-origin IndexedDB record. Never seed an empty business.
3. Capture the complete journal in one read-only primary-key transaction:
   queued, inflight, UNKNOWN, confirmed, projection metadata and original issuers.
   No first-page-only census, claim, rewrite, confirmation or commercial replay.
4. Preserve an immutable native capture **before** remote/source selection or
   UNKNOWN reconciliation can stop migration. Recovery DB v3 adds a store;
   existing v1/v2 snapshot pins and device identities remain intact. Production
   tenant snapshots and journal schemas are not reset or deleted.
5. Attach a fresh server-sourced legacy revision and canonical hash to a second
   immutable capture. Lack of a server does not invalidate the first local pin.
6. With explicit server policy, preserve private fragments at
   `businesses/{ownerUid}/recoveryCopies/{captureHash}/parts/p{position}`.
   The manifest and fragments are deterministic and resumable. No business
   operational collection, ledger, `metadata/storage` or `state/main` is written.
7. Read fragments from server, require the complete ordered set, compare every
   part, reconstruct original Unicode JSON, check canonical SHA-256, recheck
   local/journal stability and remote revision/hash, then record CLIENT_VERIFIED.
8. Reread the manifest from server. Retain the original snapshot, journal and
   local capture; never delete the last recovery source. No restore is provided.

Each document contains at most 48k UTF-16 characters of content (under 192k
UTF-8 bytes), far below Firestore's document limit. The aggregate transport
envelope is bounded to 16 MiB, including journal/metadata; this is not a product
entitlement or an increase to the 8 MiB device-state / 850000-byte legacy guards.
Five-fragment transactions and 100-row read pages bound request sizes.
Same material capture retries reuse its IDs. There is no periodic cloud polling,
scheduler, automatic deletion, paid service, financial replay or restore button.

## Activation and production entry

Server-managed `storageRollout/sparkV1` must have `enabled:true`,
`automaticRecoveryCopy:true` and explicitly include the owner in `pilotOwnerUids`.
Workers, other tenants, anonymous users and non-piloted owners cannot write it.
Do not enable a real owner in this execution.

The actual `enterApprovedApp` production path can invoke **recovery-only** under
that policy. It cannot invoke operational modular bootstrap. The factory must
receive `productionRecoveryOnly:true`; even an accidentally enabled shadow flag
cannot cross into import/cutover through this entry. Absent policy retains the
existing production path. Optional-copy failure remains PENDING and cannot
erase or roll back local data. Native legacy capacity/dirty-state guards remain.

In staging, `automaticShadow:false` permits recovery-only certification with
UNKNOWN retained; no storage-mode control is installed and all businesses retain
their existing writer mode. With shadow enabled, the original complete outbox
reconciler still runs after preservation; UNKNOWN/conflict and executable
command handoff continue to stop migration.

## Security review

New Rules apply only to the private recovery namespace. Owner/role/business
operational Rules, ledger immutability, financial transactions and the existing
legacy fence are unchanged. Parts are create-only; the manifest permits only
UPLOADING -> CLIENT_VERIFIED without changing identity/hashes/revisions/counts.
Both timestamps are server timestamps. The scope fingerprint fixture explicitly
records this additive authorization change; the exact guard is not disabled.
Rules cannot calculate SHA-256 or attest independent verification. Never use a
client marker to authorize cutover, stock or other commercial state.

## Tests / precise scope

- Native Chromium/WebKit/Firefox: v1 recovery pins preserved through v3,
  complete owner journal including UNKNOWN row 101, immutable capture/restart.
- Synthetic RPC with actual native recovery: 850000, 860000, 1 MiB, 1.2 MiB,
  3 MiB and 7 MiB; lost response, deterministic resume, corruption, source drift,
  no legacy writes and rejection above the existing device limit.
- Real Web SDK Rules emulator: owner/pilot authorization, denied worker,
  anonymous/cross-tenant access, immutable parts/manifests, bounded fields.
- Existing served PWA/Auth/Rules emulator suite now starts with recovery-only:
  newer local historical sale, two businesses, 100 queued + 1 UNKNOWN, lost reply
  after a real fragment commit, cold restart/resume and remote reconstruction.
  Then the existing owner/worker operational journey and shadow tests remain.
- Production entry is executed in the existing VM boundary regression:
  disabled policy, absent pilot, worker, missing source, offline and lock conflict.
  These are routing tests, **not production or physical-iPhone certification**.

Real staging command after clean exact build/Rules deployment:

    node qa/spark-real-staging-shadow-e2e.mjs --project=click360-staging-7620168025 --sha=<FULL_SHA> --recovery-only=true

Only that script's newly generated `qa-spark-staging-*` identities are used.
Its small representative data avoids large-scale quota consumption; scale stays
in emulators. Log the actual result before declaring staging certified.

## Hitos and remaining risk

Hito A requires final exact-HEAD CI, Rules/served-PWA recovery tests, real staging
reconstruction, old-PWA preservation evidence and a reviewed publication path.
Implemented components alone do not complete it. Physical SHARY data remains
unobserved until authorized publication and opening her original PWA online.

Hito B is not completed by a recovery copy: blocked operational adapters,
executable legacy-journal handoff and full operational cutover remain tracked in
`CLICK360_OPERATIONAL_INTEGRATION_MATRIX.md`. Hito C still needs exact production
Hosting/Rules backup, rollback, current read-only census and owner authorization.

Rollback never restores old state over newer commercial data. Before cutover,
disable the recovery pilot and restore compatible Hosting/Rules only after
preserving current private copies. No data deletion or restore is required.
After operational cutover, retain the fence and reconcile forward instead.
