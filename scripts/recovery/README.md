# SHARY recovery tooling

This directory contains acquisition and controlled recovery tools, not an automatic rollback to C9. It is excluded from the static Hosting build. Production remains untouched until every recovery gate is closed.

## Acquisition

Build with the private tenant configuration, never embed the recovered commercial payload:

```sh
python3 scripts/recovery/build_acquisition_package.py --config PRIVATE_CONFIG --output NEW_PRIVATE_PACKAGE_DIRECTORY
```

The recipient extracts the package and launches `INICIAR_RECUPERACION.cmd` on the Windows x64 Chrome/Edge computer used for CLICK360, accepting the normal Windows backup permission prompt. The program never opens or refreshes CLICK360, closes sessions, clears storage, unregisters a service worker, or contacts the cloud. It copies from a retained VSS snapshot. It checks existing VSS quota before creating another snapshot; it never deletes recovery points or changes security policy.

Only `SHARY_PARA_ENTREGAR.zip` is returned. `RAW_PRIVADO_NO_ENVIAR` stays private on that PC with an owner/admin ACL. Shared storage containers, authentication records, cookies and passwords are not included in the deliverable. Selected commercial values are sanitized before export. Source/copy hashes and physical storage versions are retained. A completed operation is idempotent; rerunning does not overwrite its evidence.

Supported parser coverage is explicit. SQLite/new binary formats remain private and report PARTIAL, never PASS. VSS is disk-consistent, not a capture of unsaved RAM. Physical acquisition is not claimed to have happened until the returned package exists.

## Offline classification

```sh
node scripts/recovery/classify-client-candidates.mjs PRIVATE_C9 PRIVATE_ACQUISITION_JSON NEW_PRIVATE_COMPARISON_JSON
node scripts/recovery/dry-run.mjs PRIVATE_FINAL_CANDIDATE PRIVATE_CURRENT_TYPED_DOCUMENT NEW_PRIVATE_DRY_RUN.md
```

This creates no merged data and no server writes. Cache records can be UNKNOWN, LOCAL-PENDING, STALE or DUPLICATE. No cached timestamp/count is promoted to SERVER-COMMITTED. Missing IDs are `absentNotProvenDeleted`. Products, sales, movements, layaways, cash, tombstones, operation ledger, templates and profiles are compared by entity ID.

## Restore gates and exact commands

Default invocation is offline status only:

```sh
node scripts/recovery/shary-recovery.mjs --candidate=PRIVATE_CANDIDATE
```

The final attestation must bind the candidate SHA-256 and real evidence file hashes, exact production updateTime/revision, a unique operation ID prefixed `SHARY_DATA_RECOVERY_2026_08_31_`, and PASS for identity, schema, intrinsicIntegrity, noSyntheticData, deltasExplained, newerWritesPreserved, liveWritersControlled and rollbackTested. Include the entity-level dry run as evidence with `kind: "dry-run"`. An incomplete C9 candidate remains `restoreEligible:false`. The CLI independently enforces identity, logical business scope and intrinsic validation; a PASS string alone does not bypass those checks.

Only after reconciliation, preserve the final candidate separately from the historical C9 file. Use a new private directory whose parent already exists:

```sh
node scripts/recovery/shary-recovery.mjs --mode=backup --candidate=PRIVATE_FINAL_CANDIDATE --attestation=PRIVATE_ATTESTATION --directory=NEW_PRE_RESTORE_DIRECTORY --apply=SHARY_DATA_RECOVERY_2026_08_31
node scripts/recovery/shary-recovery.mjs --mode=restore --candidate=PRIVATE_FINAL_CANDIDATE --attestation=PRIVATE_ATTESTATION --directory=NEW_PRE_RESTORE_DIRECTORY --apply=SHARY_DATA_RECOVERY_2026_08_31
```

Backup saves the exact typed Firestore preimage, identity/access and explicit modular/print document manifest, metadata, candidate, dry run and hashes; it additionally creates and reads back an immutable admin backup. Restore atomically writes only the pinned SHARY state document plus its recovery audit, under an updateTime precondition. Revision increases; unknown envelope fields are retained. Two independent server reads verify typed field hashes. Neither Rules, Functions, accountAccess nor another tenant is written by restore.

Conditional rollback command (only the exact post-restore updateTime, never a guessed current version):

```sh
node scripts/recovery/shary-recovery.mjs --mode=rollback --candidate=PRIVATE_FINAL_CANDIDATE --attestation=PRIVATE_ATTESTATION --directory=NEW_PRE_RESTORE_DIRECTORY --post-update-time=EXACT_RECOVERY_UPDATE_TIME --apply=SHARY_DATA_RECOVERY_2026_08_31
```

Rollback restores preimage business fields with monotonic synchronization metadata. It requires the expected recovery hash/marker AND updateTime, is atomic with audit, and refuses any intervening external write. Hosting rollback never implies data rollback.

## Synthetic verification

```sh
node qa-recovery-safety.mjs
node qa-recovery-offline-tools.mjs
node qa-recovery-emulator.mjs
python scripts/recovery/test_acquisition.py
node qa/recovery-parser-browser-e2e.mjs
```

Python parser dependencies must be installed in an isolated environment or the packaged Windows runtime; `CLICK360_RECOVERY_PYTHON` selects that interpreter. CI builds and tests the packaged Windows runtime against synthetic records and a real synthetic Chromium profile. No QA source contains SHARY payloads or credentials.
