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
 * For production tenants, pass --project click-360, --business <businessId>
 * (required for every production action, even `status`), and use the
 * matching *_PRODUCTION_TENANT confirm string. Phase 3.3 adds a second,
 * independent code guard on top of that confirm string: the exact
 * ownerUid+businessId pair must already be present in
 * scripts/config/pilot-authorized-tenants.json (see
 * scripts/lib/pilot-authorization.mjs), checked before ANY Firestore access
 * against production, including read-only `status`. That file starts empty
 * and is only ever extended by a deliberate, reviewed, git-committed change
 * made after a human has explicitly approved that one customer for the
 * pilot -- so this tool cannot reach an unauthorized tenant no matter what
 * flags are passed.
 *
 * Output: JSON report with the before/after state.
 */

import process from 'node:process';
import { assertTenantAuthorizedForProduction } from './lib/pilot-authorization.mjs';

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
const businessId = args.business ? String(args.business) : '';
const operator = String(args.by || 'AIIA-admin');
if (action !== 'dashboard' && !ownerUid) throw new Error('--owner is required.');
// Phase 3.3: independent, exact-tenant authorization gate for production --
// checked before ANY Firestore access, including read-only `status`.
// `dashboard` is exempt from requiring --business (it has no single tenant),
// but in production it only ever reports on tenants already present in the
// allowlist -- see actionDashboard().
let pilotAuthorization = null;
if (action !== 'dashboard') {
  if (isProduction && !businessId) throw new Error('--business is required for every production action (including status), for the pilot-authorization check.');
  pilotAuthorization = await assertTenantAuthorizedForProduction(projectId, ownerUid, businessId);
}

const db = await connectAdmin(projectId);
const flagRef = ownerUid ? db.collection('businesses').doc(ownerUid).collection('featureFlags').doc('workers') : null;

async function tenantSnapshot(forOwnerUid, forBusinessId) {
  const unitRef = db.collection('businesses').doc(forOwnerUid).collection('businessUnits').doc(forBusinessId);
  const ownerFlagRef = db.collection('businesses').doc(forOwnerUid).collection('featureFlags').doc('workers');
  const [unitSnapshot, seatSnapshot, flagSnapshot] = await Promise.all([
    unitRef.get(), unitRef.collection('entitlement').doc('seats').get(), ownerFlagRef.get()
  ]);
  const seats = seatSnapshot.exists ? seatSnapshot.data() : null;
  return {
    ownerUid:forOwnerUid, businessId:forBusinessId,
    workersEnabled: flagSnapshot.exists ? flagSnapshot.data()?.enabled === true : false,
    businessUnitStatus: unitSnapshot.exists ? unitSnapshot.data()?.status : null,
    seats: seats ? { baseSeatCap:seats.baseSeatCap, addOnSeats:seats.addOnSeats, activeMembers:seats.activeMembers, capacity:(Number(seats.baseSeatCap||0)+Number(seats.addOnSeats||0)) } : null
  };
}

async function actionStatus() {
  const flagSnapshot = await flagRef.get();
  const report = {
    projectId, pilotAuthorization, ownerUid, action,
    workersFlag: flagSnapshot.exists ? flagSnapshot.data() : null
  };
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

// Phase 3.3 admin checklist/dashboard: one row per tenant with everything
// AIIA needs to see at a glance (Workers ON/OFF, seat usage, migration
// status). Staging discovers tenants by scanning for CUTOVER_VERIFIED
// business units (safe: no real customer data). Production NEVER scans --
// it only ever reports on the tenants already present in the pilot
// allowlist, so this can never become an accidental broad read of real
// customer data.
async function actionDashboard() {
  let pairs = [];
  if (isProduction) {
    const { loadPilotAllowlist } = await import('./lib/pilot-authorization.mjs');
    const allowlist = await loadPilotAllowlist();
    pairs = allowlist.map((entry) => ({ ownerUid:entry.ownerUid, businessId:entry.businessId }));
  } else {
    const unitsSnapshot = await db.collectionGroup('businessUnits').get();
    pairs = unitsSnapshot.docs
      .filter((docSnapshot) => docSnapshot.data()?.ownerUid && docSnapshot.data()?.businessId)
      .map((docSnapshot) => ({ ownerUid:docSnapshot.data().ownerUid, businessId:docSnapshot.data().businessId }));
  }
  const tenants = await Promise.all(pairs.map((pair) => tenantSnapshot(pair.ownerUid, pair.businessId)));
  return { projectId, action, tenantCount:tenants.length, tenants };
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
  return { projectId, pilotAuthorization, ownerUid, action, before:existing, after:payload };
}

async function actionSetAddOnSeats() {
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
  return { projectId, pilotAuthorization, ownerUid, businessId, action, before, after };
}

// Phase 3.3 manual seat-sale audit trail: marks an owner-created
// businesses/{ownerUid}/seatRequests/{requestId} as fulfilled (clients can
// never write this field themselves -- see firestore.rules) and, in the
// same call, applies the seat change via actionSetAddOnSeats' logic, so the
// request and the entitlement change are always recorded together.
async function actionFulfillSeatRequest() {
  const requestId = String(args.request || '');
  if (!requestId) throw new Error('--request <requestId> is required for fulfill-seat-request.');
  const nextAddOnSeats = Number(args.seats);
  if (!Number.isInteger(nextAddOnSeats) || nextAddOnSeats < 0) throw new Error('--seats must be a non-negative integer.');
  const requiredConfirm = `FULFILL_SEAT_REQUEST_${isProduction ? 'PRODUCTION' : 'STAGING'}_TENANT`;
  if (args.confirm !== requiredConfirm) throw new Error(`This action requires --confirm=${requiredConfirm}.`);
  const requestRef = db.collection('businesses').doc(ownerUid).collection('seatRequests').doc(requestId);
  const requestSnapshot = await requestRef.get();
  if (!requestSnapshot.exists) throw new Error(`No seatRequests/${requestId} exists for ${ownerUid}.`);
  const requestData = requestSnapshot.data();
  if (requestData.status === 'fulfilled') throw new Error(`seatRequests/${requestId} was already fulfilled at ${requestData.fulfilledAt}; use set-addon-seats directly for any further change.`);
  const requestBusinessId = String(requestData.businessId || '');
  if (businessId && businessId !== requestBusinessId) throw new Error(`--business (${businessId}) does not match the request's businessId (${requestBusinessId}).`);
  const seatRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(requestBusinessId).collection('entitlement').doc('seats');
  const seatSnapshot = await seatRef.get();
  if (!seatSnapshot.exists) throw new Error('No seat entitlement doc exists for this tenant/business; run worker-boundary-migrate.mjs first.');
  const seatsBefore = seatSnapshot.data();
  await seatRef.update({ addOnSeats:nextAddOnSeats, updatedBy:operator, updatedAt:new Date().toISOString() });
  const seatsAfter = (await seatRef.get()).data();
  await requestRef.update({
    status:'fulfilled', fulfilledAt:new Date().toISOString(), fulfilledBy:operator,
    resolvedAddOnSeats:nextAddOnSeats, fulfillmentNotes:String(args.notes || 'external payment confirmed manually; see AIIA/operator records')
  });
  return {
    projectId, pilotAuthorization, ownerUid, businessId:requestBusinessId, requestId, action,
    request:{ before:requestData, note:'marked fulfilled' }, seats:{ before:seatsBefore, after:seatsAfter }
  };
}

let report;
if (action === 'status') report = await actionStatus();
else if (action === 'dashboard') report = await actionDashboard();
else if (action === 'enable-workers') report = await actionSetWorkersEnabled(true);
else if (action === 'disable-workers') report = await actionSetWorkersEnabled(false);
else if (action === 'set-addon-seats') report = await actionSetAddOnSeats();
else if (action === 'fulfill-seat-request') report = await actionFulfillSeatRequest();
else throw new Error(`Unknown --action: ${action}. Use status | dashboard | enable-workers | disable-workers | set-addon-seats | fulfill-seat-request.`);

console.log(JSON.stringify(report, null, 2));
