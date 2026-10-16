# P0A isolated recovery release

Base: production/main `21409a1d2dc710315ab8c3c27e5da566f004cc8e`.
Source of certified recovery protocol: PR #96 `ca6cfd03b251`.
PR #96 remains separate and is NOT certified operationally by this release.

## Exact scope

Four browser components only: canonical SHA-256 helpers, read-only original
journal reader, immutable native recovery store and recovery-only bootstrap.
The fragment protocol is selectively preserved from #96, not redesigned.
There is no importer, transaction repository, commercial replay, storageMode
write, operational ledger write or cutover implementation in this artifact.
Existing production app.js, access, entitlements and financial domain remain
unchanged. Founder effective acquired floor remains 2 / 2 / 2000.

Recovery runs are scoped to the authenticated epoch as well as the owner Web
Lock. A redundant same-owner Auth delivery before legacy unlock must drain the
invalidated run and enter recovery under its current context. Stale progress
cannot confirm the new epoch. A deterministic regression reproduces the missing
second run before the correction. This is not a timed retry or commercial replay.

Necessary transport dependency selectively ported from #96 commit
`fa2e6ecdd168948ede763f9b1055cb7a7c41f672`: configure supported Firestore
long-poll framing before persistence/reads. In the real WebKit A/B the patched
first page completed verification; its cold restart used the unpatched original
SW-cached asset and stalled again before recovery progress. Diagnostic asset
interception is never accepted as release certification. The exact unmodified
served candidate must pass both boots. No timeout increase or verification
relaxation is permitted.

The original journal is opened without a version, read with a full primary-key
cursor, never upgraded or confirmed by P0A. A missing journal is not created.
Raw source snapshot, metadata, all journal states including UNKNOWN and remote
historical revision/hash are included in an immutable local recovery capture.
Cloud fragments remain private/create-only. Reread, reconstruction and SHA-256
verification precede CLIENT_VERIFIED. This is client verification, not server
attestation or operational synchronization. There is no restore button.

## Rules and deployment files

`firebase.json` and `firebase.staging.json` BOTH explicitly deploy
`firestore.rules`. Do not deploy `firestore.spark.rules` from PR #96.
The legacy Rules after removing the clearly bounded additive P0A section must
remain byte-identical to the deployed production source SHA-256:
`38b504d5d0806071c6d29b1787d8261aa2dc8026ecdba891352158b8147a448b`.
Both the permanent sentinel and independent release-boundary test enforce this.
The existing full commercial Rules suite and P0A Web SDK suite run against that
same exact file, not an alternate ruleset.

New paths only:

- `storageRollout/sparkV1`: authenticated policy read; existing platform admin
  identity alone can write. Default absent/disabled means no recovery.
- `businesses/{ownerUid}/recoveryCopies/{captureHash}`: private owner read,
  explicitly piloted active owner creates bounded UPLOADING manifest; only
  state/timestamp can transition to CLIENT_VERIFIED.
- Its `parts/p{position}`: owner-private, bounded immutable fragments.

Activation requires enabled + automaticRecoveryCopy true + automaticShadow
false + explicit owner allowlist. Workers cannot copy or read owner snapshots.
No broad wildcard, operational authorization, storage fence or plan change is
introduced. Owners cannot write the pilot policy.

## Publication and reversible activation

Require final exact-commit CI, complete exact-Rules regressions, old production
PWA upgrade/native IDB preservation and real staging client reconstruction.
Save native deployed Hosting version, release manifest and full Rules source.
Clone live Hosting to a rollback channel before publishing.
Deploy only Hosting + firestore:rules from the exact merged build.
Verify actual served asset bytes and native deployed Rules hash.
Keep policy disabled during publication. Strictly verify the actual authorized
owner from existing identity-pinned incident evidence and fresh read-only Auth,
access and legacy source; never put that identity into shared application code.
Enable only that owner, with shadow false. Compare commercial source before
and after. Disable by setting enabled/automaticRecoveryCopy false; no deletion
or snapshot restore is needed. Recovery copies remain immutable.

Rollback Hosting by cloning the saved compatible version back to live; keep
private recovery read access or preserve copies before reverting Rules. Never
restore old commercial data, delete IndexedDB or clear the journal.

## Required real-device acceptance

Only ask the customer to open the ORIGINAL PWA on the SAME iPhone online.
No transaction, diagnostic, reinstall or cache action.
Do not claim real-device recovery until server fragments from that installation
are independently reconstructed, hashed and compared with its manifest.
`RECOVERY_COPY_CLIENT_VERIFIED` is not `OPERATIONAL_CLOUD_SYNC_CONFIRMED`.
P0B remains disabled and continues separately on #96.
