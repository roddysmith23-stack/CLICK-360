/**
 * worker-boundary-repair-identity.mjs
 *
 * Staging-only, idempotent, reversible repair for the case where
 * businesses/{ownerUid}/state/main has a valid root-level identity but is
 * missing payload.identity (which p0-tenant-guard requires at runtime).
 *
 * Decision matrix (see planIdentityRepair in worker-data-boundary.js):
 *   Root valid  + nested absent     → REPAIR: materializes payload.identity
 *   Root valid  + nested matches    → NOOP:   document already correct
 *   Root valid  + nested contradicts → DENY:  aborts, no write
 *   Root contradicts expected        → DENY:  aborts, no write
 *
 * The write uses a Firestore transaction with updateTime precondition so
 * concurrent modifications are detected and the repair fails safely rather
 * than silently overwriting a racing update.
 *
 * Only payload.identity is written. payload.data and all other fields are
 * never touched. Production (click-360) is forbidden.
 *
 * Usage:
 *   node scripts/worker-boundary-repair-identity.mjs \
 *     --owner <ownerUid> \
 *     --business <businessId> \
 *     [--project click360-staging-7620168025]   # default
 *     [--dry-run]                                # plan only, no write
 *     --confirm REPAIR_STAGING_IDENTITY          # required for any write
 *
 * Output: JSON report with action, hashes before/after, updateTime.
 */

import crypto from 'node:crypto';
import process from 'node:process';

await import('../worker-data-boundary.js');
const boundary = globalThis.CLICK360_WORKER_DATA_BOUNDARY;
const STAGING_PROJECT = 'click360-staging-7620168025';
const PRODUCTION_PROJECT = 'click-360';
const P0_SCHEMA_VERSION = 10;

if (!boundary) throw new Error('Worker boundary module did not initialize.');

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(boundary.canonicalJson(value)).digest('hex');
}

async function connectAdmin(projectId) {
  const [{ applicationDefault, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore')
  ]);
  const app = getApps().find((candidate) => candidate.options.projectId === projectId)
    || initializeApp({ credential: applicationDefault(), projectId }, `repair-identity-${projectId}`);
  return getFirestore(app);
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || STAGING_PROJECT);
const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
const confirm = String(args.confirm || '');

// ── Safety guards ────────────────────────────────────────────────────────────
if (projectId === PRODUCTION_PROJECT) {
  throw new Error('REPAIR_FORBIDDEN: worker-boundary-repair-identity.mjs no puede ejecutarse contra producción (click-360).');
}
if (projectId !== STAGING_PROJECT) {
  throw new Error(`REPAIR_FORBIDDEN: Proyecto no aprobado para reparación de identidad: ${projectId}. Solo se permite ${STAGING_PROJECT}.`);
}
if (!args.owner || !args.business) {
  throw new Error('--owner y --business son obligatorios.');
}
if (!dryRun && confirm !== 'REPAIR_STAGING_IDENTITY') {
  throw new Error('La escritura requiere --confirm=REPAIR_STAGING_IDENTITY. Use --dry-run para planificar sin escribir.');
}

const ownerUid = String(args.owner);
const businessId = String(args.business);
const ownerId = ownerUid; // ownerId === ownerUid by CLICK 360 convention
const expectedTenantKey = boundary.identity(ownerUid, businessId).tenantKey;
const expected = {
  ownerUid,
  ownerId,
  businessId,
  tenantKey: expectedTenantKey,
  schemaVersion: P0_SCHEMA_VERSION
};

const db = await connectAdmin(projectId);
const docRef = db.collection('businesses').doc(ownerUid).collection('state').doc('main');
const snapshot = await docRef.get();

if (!snapshot.exists) {
  throw new Error(`REPAIR_FAILED: El documento businesses/${ownerUid}/state/main no existe en ${projectId}.`);
}

const raw = snapshot.data();
const updateTime = snapshot.updateTime?.toDate?.().toISOString?.() || '';
const hashBefore = stableHash(raw);

// ── Plan the repair using the shared boundary module function ────────────────
// This call validates root identity strictly and returns NOOP or REPAIR.
// Throws REPAIR_DENIED_ROOT_MISMATCH or REPAIR_DENIED_NESTED_MISMATCH on contradiction.
const plan = boundary.planIdentityRepair(raw, expected);

const report = {
  projectId,
  ownerUid,
  businessId,
  sourcePath: `businesses/${ownerUid}/state/main`,
  sourceUpdateTime: updateTime,
  hashBefore,
  action: dryRun ? `DRY_RUN_${plan.action}` : plan.action,
  reason: plan.reason,
  payloadIdentityWritten: null,
  hashAfter: null,
  sourcePreserved: true,
  payloadDataUnchanged: true
};

if (plan.action === 'NOOP') {
  report.hashAfter = hashBefore;
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// REPAIR path
if (dryRun) {
  report.payloadIdentityWritten = plan.payloadIdentity;
  report.hashAfter = '(not computed — dry run)';
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// Execute the repair in a transaction with updateTime precondition
await db.runTransaction(async (tx) => {
  const current = await tx.get(docRef);
  if (!current.exists) throw new Error('REPAIR_FAILED: El documento desapareció durante la transacción.');
  // Precondition: document must not have changed since we read it
  if (current.updateTime?.isEqual && !current.updateTime.isEqual(snapshot.updateTime)) {
    throw new Error('REPAIR_ABORTED: El documento state/main fue modificado mientras se preparaba la reparación. Vuelva a ejecutar el script.');
  }
  // Write ONLY payload.identity — never touch payload.data or any root field
  tx.update(docRef, { 'payload.identity': plan.payloadIdentity }, { lastUpdateTime: snapshot.updateTime });
});

// Verify the repair
const after = await docRef.get();
const rawAfter = after.data();

// Confirm payload.data is unchanged
const dataHashBefore = stableHash(raw?.payload?.data ?? {});
const dataHashAfter = stableHash(rawAfter?.payload?.data ?? {});
if (dataHashBefore !== dataHashAfter) {
  throw new Error('REPAIR_INTEGRITY_FAILED: payload.data cambió inesperadamente durante la reparación. Revisar inmediatamente.');
}

// Confirm payload.identity is now correct — validate the full p0-tenant-guard contract (all 5 fields)
boundary.validateSourceDocumentIdentity(rawAfter, expected);

report.payloadIdentityWritten = plan.payloadIdentity;
report.hashAfter = stableHash(rawAfter);
report.sourceUpdateTimeAfter = after.updateTime?.toDate?.().toISOString?.() || '';

console.log(JSON.stringify(report, null, 2));
