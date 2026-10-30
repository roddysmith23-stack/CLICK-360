# P0: authenticated startup after a committed modular cutover

## Demonstrated defects

The previous production `v16-storage.js` rejected `click-360` in
`promoteVerifiedSnapshot`. A server could already be MODULAR while the original
device retained its protected legacy snapshot and still needed that local
promotion. Staging admitted the promotion, hiding the production-only defect.
`qa/spark-production-local-handoff-e2e.mjs` executes the old production file to
reproduce `INDEXEDDB_VERIFIED_HANDOFF_REQUIRED`, then verifies the correction
against native IndexedDB in Chromium and WebKit, with zero server writes.

The asynchronous Auth observer also lacked an outer exception boundary.
An identity setup exception left its last gate state AUTHENTICATED_RESOLVING.
`qa-startup-progress.mjs` reproduces that behavior using the previous observer
and checks that the corrected observer displays a failure code instead.
Neither reproduction establishes the exact last stage reached by a particular
physical phone; that requires the newly observable client result.

The exact-head staging check additionally demonstrated a preservation-only
policy bypass: after an existing cutover, P0A-only enrollment could skip the
modular coordinator and load legacy instead. The preservation-only branch now
first reads authoritative storage mode; migrating, modular and frozen controls
are always handled by the operational coordinator, including its production
enrollment/revocation checks. This does not enable a new migration.

Withholding the bootstrap module also reproduced a legacy fallthrough in real
staging: authenticated access was allowed without a modular writer and showed
the old source's 9 sales instead of the modular 11. The module is now required
inside the caught startup boundary; absence produces
`SPARK_BOOTSTRAP_MODULE_UNAVAILABLE` without reading legacy. The support code
includes the loaded build so a partial update is distinguishable on-screen.

## Repair and boundaries

- Production local promotion requires an opaque proof issued by the complete
  handoff verifier, bound to project, owner and the executing build. Copying
  the proof object does not copy its authority.
- Source, metadata, journal, original pins, private approvals, business coverage,
  financial annotations and server records must still match exactly. The
  original source remains preserved. Native IndexedDB CAS remains mandatory.
- This release can finish an already-committed handoff from `2875f6e7496f` using
  that original build's exact approvals and pins. Loaded assets must all be the
  current build. Compatibility never authorizes a new cutover under old
  approvals, nor an unknown source build.
- No Firestore Rules, commercial data, storageMode, plan, pilot scope or
  approval documents are changed by the release procedure.
- Auth notifications for an identity already resolving share its attempt;
  real identity changes invalidate it normally.

## Observable startup

The access screen displays a support code for the pending stage, including
account server read, identity installation, local restoration, Web Lock,
handoff server read, module read, journal reconciliation, writer installation,
current cash and view installation. `click360StartupDiagnostic` exposes only
stage/build/status fields, without owner IDs, tokens or commercial records.

After 15 seconds without a completed stage the UI reports WAITING and the exact
stage. This is a user-feedback threshold, not a network timeout or cancellation.
The original promise is retained: no timed retry, reload, parallel coordinator
or early writer is created. Successful completion continues the same attempt.
Exceptions produce FAILED and a sanitized support code. Only waiting/failure
events use existing private telemetry, once per attempt/stage.

`qa/startup-auth-pwa.mjs` exercises a held SDK account read and an identity
exception in the actual served PWA with Auth, Firestore and Rules emulators.
It checks visible diagnostics, absence of an early writer, and continuation to
READY after the same read resolves, without another login or Retry.

## Release and acceptance

Require complete required CI, Chromium/WebKit served-PWA regressions, a real
staging source-preserving interrupted-handoff check, exact artifact validation,
Hosting/Rules backup and private read-only pre/post release boundaries.
Rollback changes Hosting code only and retains the modular fence and records.
Never restore the old monolith over modular data.

Publication is not physical acceptance. Confirm READY, a live modular writer
and server-sourced views in the original client before declaring operational
access restored. Do not request artificial commercial transactions.
