# P0D — non-destructive device preflight

Extends the existing P0A/P0B bootstrap, not an alternative storage system.
No importer, replay, commercial write, writer activation, storageMode change
or approval is invoked by this path. Founder 2/2/2000 and both storage guards
remain unchanged.

## Default and private policy

Absent/disabled `businesses/{owner}/recoveryPreflightPolicy/main` means OFF.
Only IAM administrators manage it; all client policy writes are denied.
An individually enabled preparation pilot requires:

```
enabled, ownerUid, buildSha,
baselineCaptureHash, baselineSourceHash, deviceIdHash, businessIds
```

Bind the policy to a fully reconstructed P0A baseline, its original durable
device identity, every owner business and the exact deployed build. This is
NOT `storageApprovals/runtimePreparation` or `storageApprovals/cutover`.
Those commercial approvals remain absent and rollout flags remain disabled.

## Automatic preparation

The existing same-owner Auth epoch/device lease first completes P0A, retaining
the source and entire original journal. The optional P0D hook then rereads
both copies, every paginated part, hashes, source metadata and full journal;
requires current local stability and a fresh matching legacy server revision;
and consults the exact server ledger for journal rows. No row is resent,
claimed, confirmed, deleted or adopted by another user.

Nonempty journals fail closed after the complete ledger census until typed
command/source-coverage proof exists. A ledger confirmation alone does not
prove its projection is included in the snapshot. UNKNOWN, identity drift,
missing history, changed immutable financial fields, incomplete parts or
unproved financial obligations prevent readiness. Older closed components
without financial proof remain protected read-only history, never zeroes.

For a valid empty executable journal, reuse source selection, cash/history
proofs, handoff validation and the exact record codec roundtrip. Compute delta
from record data hashes, not each wrapper's whole-source provenance hash.
Original snapshot/journal and non-executable legacy-save references stay intact.

## Owner/support receipt

`businesses/{owner}/recoveryPreflights/{reportId}` is owner-private, immutable,
idempotent and server timestamped. It is bound to the policy, current verified
capture, original-device baseline and build. It contains only hashes, counts
and a sanitized reason. READY/BLOCKED are **client preflight claims**, not
server financial attestations and never permission to migrate. No public
notification, PII, polling, schedulers or paid services are added. A local
`click360-device-preflight` event is separate from operational sync status.

The existing read-only recovery inspector now lists private receipts and
independently recomputes them when both sources are reconstructed in that
inspection. It does not trust the READY label. Inspect a new capture before
preparing any current-source commercial approval.

## Recovery and release

Policy OFF immediately prevents future receipt creation and optional ledger
reads, without deleting recovery copies, journals or reports. Failure never
downgrades an already verified P0A copy or restores an older state.

Pre-cutover: keep legacy/local/P0A intact. Post-cutover recovery remains the
existing forward-only export/ledger/delta reconciliation; never restore old
state/main over newer modular records. Commercial cutover still requires new
owner approval bound to the actual current source and deployed build.

Permanent regressions: `qa-p0d-device-preflight.mjs`, recovery Web SDK Rules
suite, and `certifyDevicePreflight` in the existing served PWA suite, Chromium
and WebKit. Large datasets remain in emulators; private customer data never
enters staging or GitHub. No physical device recovery is claimed synthetically.
