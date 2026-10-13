# PR #96 — connected migration preparation

Production remains `21409a1d2dc7`. No SHARY commercial writes or physical-device claims.

## Connection implemented

The existing Auth entry point now supplies a migration preparation callback to
the existing operational bootstrap. It owns the existing Web Lock before the
callback can run. The release includes the existing reconciliation, immutable
IndexedDB recovery and importer files in both the static build and SW asset set.

Preparation requires the isolated demo/staging SDK project, owner context,
consistent build assets, and an authoritative `storageRollout/sparkV1` policy
with `enabled`, `automaticShadow` and explicit owner pilot membership. Missing
authorization is a no-op, not an implicit tenant rollout. No real tenant is
enabled by this change.

The callback reads the durable device source and authoritative legacy source,
uses the existing source selector, and censuses every source business using the
unscoped local journal. Foreign issuers are not acquired or replayed. UNKNOWN,
conflicts, pending projections or executable commands prevent shadow preparation.
Snapshot persistence IDs are preserved as evidence, never interpreted as sales.

The existing importer pins recovery, uploads bounded shadow batches, rereads
Firestore and independently reconstructs the exact source. Device revision,
full source hashes, remote revision/hash and complete journal counts are guarded.
Resources close in `finally`. Shadow PASS intentionally does not install a writer,
acknowledge journal operations, delete legacy, or display operational cloud confirmation.

## Executed evidence

- Callback contract + real bootstrap tests: PASS, including owner-wide coverage,
  foreign actor rejection, required lease, cache rejection and production denial.
- Outbox tests: 1, 99, 100, 101, 250 and 1000 rows enumerated completely; known
  executable rows remain untouched until the operational handoff is implemented.
- Actual Firebase Web SDK and client Rules emulator importer connection: PASS.
  Source and reconstructed SHA-256:
  `32daa2f1cd7fa6dc7eb75612344b53b5acc129bee8611d9b6f4d4d21818eea9d`.
  40 records; interrupted resume/idempotence and same-revision remote drift tested.
- Immutable IndexedDB recovery: Chromium, WebKit and Firefox PASS; 900000-byte
  source survives document restart with pending/UNKNOWN evidence unchanged.
- Production activation and cutover: disabled; not certified by these tests.
- Connected served-PWA shadow preparation: Chromium and WebKit PASS with a
  992091-byte durable local source, newer historical sale and two businesses.
  The original IndexedDB record and remote legacy envelope stayed byte-semantically
  unchanged. Document restart resumed and independently reverified the shadow.
  Source/reconstructed SHA-256 for Chromium:
  `6bb628af3f086162d60c984dbdff5b0119616bed7f284709bab7b06842170707`;
  WebKit: `bf4f45d5ed3c2d257d9f7431fef3b0375c09765e4f155c8d7dfcd19e23d4e007`.
  Scope is shadow preparation only, not operational cutover.
- An initial served shadow attempt timed out at the unchanged 60-second assertion
  without phase instrumentation. It is retained as FAIL, not labeled flaky or
  certified away. Phase diagnostics were added; repeated complete UI runs remain
  required before this head can receive any broad release certificate.

## Follow-up causes and corrections

The instrumented quota scenario reached `SHADOW_VERIFYING` before the 60-second
assertion expired (`output/spark-shadow-device-id-quota-before-20261013.log`).
The importer reread every independent collection serially. The follow-up keeps
all scopes (including source-empty modules), server-only reads and 100-row pages,
but allows at most three independent queries concurrently. The authenticated
client importer regression measures the concurrency and requires every read to
finish before comparison. No timeout, commercial retry or validation is removed.

`getDeviceId()` generated a new value when the localStorage device key could not
be written. Importer resume strictly checks `sourceDeviceId`, so a new value can
reject an otherwise intact source. Recovery now retains a separate owner-scoped
device identity in its existing IndexedDB database and rereads it after commit.
Schema v2 preserves the v1 immutable pins; it does not upgrade or clear the
commercial snapshot/journal databases. Chromium, WebKit and Firefox verify v1
pin preservation and stable device identity across document restart.

The connected served-PWA regression now rejects writes to the localStorage
device key deliberately and requires successful cold shadow resume. The real
staging shadow harness uses a small representative synthetic dataset and the
same failure, without weakening deployed Rules or using Admin for migration.

## Whole-owner journal coverage

The migration callback additionally checks the entire owner primary-key range,
not only secondary-index pages for businesses already present in the source.
It rejects omitted businesses and malformed identity/state rows, without claiming,
deleting or changing an operation. The check is repeated by the migration guard.
This introduces no journal database upgrade and does not affect operational replay.

Native IndexedDB tests in Chromium, WebKit and Firefox place an UNKNOWN after
100 valid operations under an omitted business. Source-only coverage fails;
complete coverage returns 101 records. A foreign owner's row is excluded.
Evidence: `output/spark-owner-outbox-coverage-unknown-20261013.log`.

Logs: `output/spark-migration-bootstrap-client-rules-20261013.log`,
`output/spark-migration-bootstrap-qa-20261013.log`,
`output/spark-migration-bootstrap-spark-20261013.log`.
Additional evidence: `output/spark-connected-shadow-pwa-diagnostic-20261013.log`,
`output/spark-migration-bootstrap-rules-full-20261013.log`.

## Not yet certified

Automatic operational cutover, executable journal handoff during legacy migration,
initialization of imported operational cash summaries/scoped worker proofs,
the blocked commercial adapters in the integration matrix, old-production PWA
upgrade with newer local source, and physical SHARY source reconciliation.
The real staging retail journey is operational evidence, not evidence for these gates.
Neither production readiness nor SHARY recovery can be declared from this checkpoint.
