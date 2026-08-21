/**
 * worker-boundary-admin.mjs
 *
 * Simple administrative tool (for AIIA / a trusted human operator) to manage
 * the Phase 3.2 gradual Workers rollout per tenant, while there is no
 * self-serve purchase flow yet:
 *   - enable-workers / disable-workers: flip businesses/{ownerUid}/featureFlags/workers.
 *     Clients can never write this doc (see firestore.rules); this script,
 *     via the Admin SDK, is the only way to turn a tenant's Workers module on.
 *   - set-addon-seats: set the purchased add-on seat quota for one tenant's
 *     business unit (no price is computed or enforced here -- that stays a
 *     separate business decision made before calling this script).
 *   - status: read-only snapshot of a tenant's flag + seat entitlement.
 *
 * Every mutating action requires an explicit --confirm string that differs
 * by project (staging vs production) and by action, so a copy-pasted
 * command can never silently target the wrong environment.
 *
 * Usage:
 *   node scripts/worker-boundary-admin.mjs --action status --owner <ownerUid> [--business <businessId>] [--project <projectId>]
 *   node scripts/worker-boundary-admin.mjs --action enable-workers  --owner <ownerUid> --confirm ENABLE_WORKERS_STAGING_TENANT
 *   node scripts/worker-boundary-admin.mjs --action disable-workers --owner <ownerUid> --confirm DISABLE_WORKERS_STAGING_TENANT
 *   node scripts/worker-boundary-admin.mjs --action set-addon-seats --owner <ownerUid> --business <businessId> --seats <N> --confirm SET_SEATS_STAGING_TENANT
 *
 * For production tenants, pass --project click-360 and use the matching
 * *_PRODUCTION_TENANT confirm string. This script does not otherwise
 * restrict production -- the safety boundary for "do not touch production
 * yet" during Phase 3.2 is operational (nobody runs this against
 * click-360 until the pilot is explicitly approved), not a code guard,
 * because this IS the intended production activation tool for the pilot.
 *
 * Output: JSON report with the before/after state.
 */

import process from 'node:process';

await import('../worker-data-boundary.js');
const boundary = globalThis.CLICK360_WORKER_DATA_BOUNDARY;
const STAGING_PROJECT = 'click360-staging-7620168025';
const PRODUCTION_PROJECT = 'click-360';

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

async function connectAdmin(projectId) {
  const [{ applicationDefault, getApps, initializeApp }, { getFirestore }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/firestore')
  ]);
  const app = getApps().find((candidate) => candidate.options.projectId === projectId)
    || initializeApp({ credential:applicationDefault(), projectId }, `worker-boundary-admin-${projectId}`);
  return getFirestore(app);
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || STAGING_PROJECT);
if (projectId !== STAGING_PROJECT && projectId !== PRODUCTION_PROJECT) {
  throw new Error(`Unknown project: ${projectId}. Use ${STAGING_PROJECT} or ${PRODUCTION_PROJECT}.`);
}
const isProduction = projectId === PRODUCTION_PROJECT;
const action = String(args.action || '');
const ownerUid = String(args.owner || '');
const operator = String(args.by || 'AIIA-admin');
if (!ownerUid) throw new Error('--owner is required.');

const db = await connectAdmin(projectId);
const flagRef = db.collection('businesses').doc(ownerUid).collection('featureFlags').doc('workers');

async function actionStatus() {
  const flagSnapshot = await flagRef.get();
  const report = {
    projectId, ownerUid, action,
    workersFlag: flagSnapshot.exists ? flagSnapshot.data() : null
  };
  const businessId = args.business ? String(args.business) : '';
  if (businessId) {
    const unitRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId);
    const [unitSnapshot, seatSnapshot] = await Promise.all([
      unitRef.get(), unitRef.collection('entitlement').doc('seats').get()
    ]);
    report.businessId = businessId;
    report.businessUnitStatus = unitSnapshot.exists ? unitSnapshot.data()?.status : null;
    report.seats = seatSnapshot.exists ? seatSnapshot.data() : null;
  }
  return report;
}

async function actionSetWorkersEnabled(enabled) {
  const requiredConfirm = `${enabled ? 'ENABLE' : 'DISABLE'}_WORKERS_${isProduction ? 'PRODUCTION' : 'STAGING'}_TENANT`;
  if (args.confirm !== requiredConfirm) throw new Error(`This action requires --confirm=${requiredConfirm}.`);
  const existingSnapshot = await flagRef.get();
  const existing = existingSnapshot.exists ? existingSnapshot.data() : null;
  const payload = {
    ownerUid,
    enabled,
    enabledAt: enabled ? new Date().toISOString() : (existing?.enabledAt || null),
    enabledBy: enabled ? operator : (existing?.enabledBy || null),
    updatedBy: operator,
    updatedAt: new Date().toISOString(),
    notes: String(args.notes || (enabled ? 'manually enabled by admin (worker-boundary-admin.mjs)' : 'manually disabled by admin (worker-boundary-admin.mjs)'))
  };
  if (!existingSnapshot.exists) await flagRef.create(payload);
  else await flagRef.set(payload, { merge:false });
  return { projectId, ownerUid, action, before:existing, after:payload };
}

async function actionSetAddOnSeats() {
  const businessId = String(args.business || '');
  if (!businessId) throw new Error('--business is required for set-addon-seats.');
  const nextAddOnSeats = Number(args.seats);
  if (!Number.isInteger(nextAddOnSeats) || nextAddOnSeats < 0) throw new Error('--seats must be a non-negative integer.');
  const requiredConfirm = `SET_SEATS_${isProduction ? 'PRODUCTION' : 'STAGING'}_TENANT`;
  if (args.confirm !== requiredConfirm) throw new Error(`This action requires --confirm=${requiredConfirm}.`);
  const seatRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId).collection('entitlement').doc('seats');
  const seatSnapshot = await seatRef.get();
  if (!seatSnapshot.exists) throw new Error('No seat entitlement doc exists for this tenant/business; run worker-boundary-migrate.mjs first.');
  const before = seatSnapshot.data();
  await seatRef.update({ addOnSeats:nextAddOnSeats, updatedBy:operator, updatedAt:new Date().toISOString() });
  const after = (await seatRef.get()).data();
  return { projectId, ownerUid, businessId, action, before, after };
}

let report;
if (action === 'status') report = await actionStatus();
else if (action === 'enable-workers') report = await actionSetWorkersEnabled(true);
else if (action === 'disable-workers') report = await actionSetWorkersEnabled(false);
else if (action === 'set-addon-seats') report = await actionSetAddOnSeats();
else throw new Error(`Unknown --action: ${action}. Use status | enable-workers | disable-workers | set-addon-seats.`);

console.log(JSON.stringify(report, null, 2));
