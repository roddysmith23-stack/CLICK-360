/**
 * worker-boundary-monitor.mjs
 *
 * Phase 3.3 pilot observability. Reads businesses/{ownerUid}'s
 * telemetryEvents for a time window and produces (a) an alert-style report
 * of anything concerning, and (b) the 48-72h pilot success-criteria numbers
 * for that tenant. There is no push/real-time alerting pipeline yet -- this
 * is a pull-based report AIIA/an operator runs during the observation
 * window (see docs/CLICK360_PHASE3_3_PILOT_READY.md for the recommended
 * cadence), reading from the SAME telemetryEvents collection every real
 * client write and every admin-script write already goes to.
 *
 * Usage:
 *   node scripts/worker-boundary-monitor.mjs --owner <ownerUid> [--business <businessId>] [--project <projectId>] [--since-hours <N>]
 *
 * Output: JSON { ownerUid, windowStart, windowEnd, counts:{...}, alerts:[...], successCriteria:{...} }
 */

import process from 'node:process';
import { assertTenantAuthorizedForProduction } from './lib/pilot-authorization.mjs';
import { connectAdmin } from './lib/firebase-admin-connect.mjs';

const STAGING_PROJECT = 'click360-staging-7620168025';
const PRODUCTION_PROJECT = 'click-360';

// Event types that map directly onto the six required pilot detections.
const ALERT_RULES = [
  { key:'worker_login_failed', label:'Login de trabajador fallido', severity:'P1' },
  { key:'worker_invite_failed', label:'Invitación fallida', severity:'P1' },
  { key:'worker_permission_denied', label:'DENY de permisos inesperado', severity:'P1' },
  { key:'worker_cross_tenant_denied', label:'Intento cross-tenant', severity:'P0' },
  { key:'worker_stock_error', label:'Error de stock', severity:'P0' },
  { key:'worker_seat_exhausted', label:'Cupos de trabajador agotados', severity:'INFO' },
  { key:'worker_migration_failed', label:'Migración/activación fallida', severity:'P0' },
  { key:'worker_rollback_executed', label:'Rollback ejecutado', severity:'P0' }
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || STAGING_PROJECT);
if (projectId !== STAGING_PROJECT && projectId !== PRODUCTION_PROJECT) throw new Error(`Unapproved project: ${projectId}`);
const ownerUid = String(args.owner || '');
const businessId = args.business ? String(args.business) : '';
if (!ownerUid) throw new Error('--owner is required.');
if (projectId === PRODUCTION_PROJECT && !businessId) throw new Error('--business is required for production (pilot-authorization check).');

const pilotAuthorization = await assertTenantAuthorizedForProduction(projectId, ownerUid, businessId);

const sinceHours = Number(args['since-hours'] || 72);
const windowStart = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
const windowEnd = new Date();

const db = await connectAdmin(projectId, 'worker-boundary-monitor');

// telemetryEvents stores ownerId (not businessId-scoped createdAt indexing),
// so we filter client-side after an ownerId query -- pilot tenant volumes
// are small by design (1-3 customers), this is deliberately simple rather
// than requiring a composite index for a report that runs a few times a day.
const snapshot = await db.collection('telemetryEvents').where('ownerId', '==', ownerUid).get();
const events = snapshot.docs
  .map((docSnapshot) => docSnapshot.data())
  .filter((event) => {
    const createdAt = typeof event.createdAt === 'string' ? new Date(event.createdAt) : event.createdAt?.toDate?.();
    if (!createdAt) return false;
    if (businessId && event.businessId && event.businessId !== businessId && event.businessId !== ownerUid) return false;
    return createdAt >= windowStart && createdAt <= windowEnd;
  });

const counts = {};
for (const event of events) counts[event.eventType] = (counts[event.eventType] || 0) + 1;

const alerts = ALERT_RULES
  .filter((rule) => (counts[rule.key] || 0) > 0)
  .map((rule) => ({ severity:rule.severity, eventType:rule.key, label:rule.label, count:counts[rule.key] }));

// 48-72h pilot success criteria (see docs/CLICK360_PHASE3_3_PILOT_READY.md):
// successful logins, accepted invitations, worker operations, P0/P1 errors,
// stock coherence, absence of cross-tenant, no rollback needed.
const successCriteria = {
  successfulLogins: counts.login || 0,
  failedLogins: counts.worker_login_failed || 0,
  acceptedInvitations: counts.invitation || 0,
  failedInvitations: counts.worker_invite_failed || 0,
  workerOperations: (counts.sync || 0),
  p0Errors: alerts.filter((alert) => alert.severity === 'P0').reduce((sum, alert) => sum + alert.count, 0),
  p1Errors: alerts.filter((alert) => alert.severity === 'P1').reduce((sum, alert) => sum + alert.count, 0),
  stockErrors: counts.worker_stock_error || 0,
  crossTenantAttempts: counts.worker_cross_tenant_denied || 0,
  rollbacksExecuted: counts.worker_rollback_executed || 0,
  meetsSuccessBar: (counts.worker_cross_tenant_denied || 0) === 0
    && (counts.worker_stock_error || 0) === 0
    && (counts.worker_rollback_executed || 0) === 0
    && (counts.worker_migration_failed || 0) === 0
};

console.log(JSON.stringify({
  ownerUid, businessId:businessId || null, projectId, pilotAuthorization,
  windowStart:windowStart.toISOString(), windowEnd:windowEnd.toISOString(), sinceHours,
  eventCount:events.length, counts, alerts, successCriteria
}, null, 2));
