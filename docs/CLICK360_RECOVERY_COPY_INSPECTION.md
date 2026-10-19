# Recovery-copy inspection and financial migration boundary

`scripts/inspect-recovery-copy-readonly.mjs` is a support-only reader. It has
no restore, replay, policy activation or commercial-write operation. Supply an
explicit project, a private identity file, its independently verified owner
SHA-256, and a **new** private output directory. Never commit its private files.

```sh
node scripts/inspect-recovery-copy-readonly.mjs PROJECT PRIVATE_IDENTITY_JSON EXPECTED_OWNER_SHA256 NEW_PRIVATE_DIRECTORY
```

It reads up to ten recent manifests and enumerates every part of each selected
verified copy, using bounded pages. It independently reconstructs canonical
JSON and verifies part hashes, capture/source/journal hashes, identity, device
revision, build, counts and the referenced historical revision. It retains the
exact capture locally with restrictive permissions and reports only sanitized
counts, hashes and classifications. It never infers a physical iPhone identity
from a device string or assumes the historical legacy document is current.

Important distinctions:

- A verified recovery copy is **not** operational cloud synchronization.
- An empty modular journal is **not** an empty legacy pending-save queue.
  Both counts are reported independently. Snapshot-save references are not
  executable commands and must never be replayed as sales.
  The actual bootstrap now retains `capacitySnapshotProof` in its recovery
  pin, separately from journal reconciliation. Regression sizes 76/101/1000
  prove every snapshot reference is accounted for without ledger lookup or
  financial replay; malformed/duplicate references stop import.
- The planner's local codec roundtrip is explicitly labeled local; it is not
  a Firestore shadow reread, semantic migration certification or cutover.
- A lossless codec roundtrip does not establish financial correctness of
  imported session summaries. The real migration bootstrap now calls
  `deriveCashSummaries` for **every** covered business before constructing the
  importer. Unverified openings, receipts, report totals or session identities
  stop shadow writes. Both original source and recovery capture survive.
- Do not repair or invent historical counters merely to satisfy this check.
  Financial reconciliation and operational integration remain release gates.

Regression: `node qa-spark-migration-bootstrap.mjs` rejects an unverified
session in either business, proves importer writes never start, and verifies
that the source/capture remain intact. Existing coverage retains the complete
99/100/101/250/1000-row census, unknown/foreign-actor handling, drift guards,
and production recovery-only boundary.

The candidate also selectively retains the production #98 parser-readiness
barrier and live-product editor reference guard, rather than overwriting them
with the older #96 base. Their original editor browser regression is retained;
the bootstrap harness executes the real startup fragment in all three document
readiness states. No production Rules, rollout policy or operational data is
changed by this development patch.
