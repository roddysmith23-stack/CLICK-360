/**
 * worker-boundary-deactivate-tenant.mjs
 *
 * Phase 3.3 single-command tenant rollback. Inverse of
 * worker-boundary-activate-tenant.mjs, in this exact order:
 *
 *   1. FLAG OFF        - worker-boundary-admin.mjs --action disable-workers.
 *                        This alone is immediate and unbypassable at the
 *                        rules layer (businessUnitReady() denies instantly)
 *                        -- for the overwhelming majority of pilot issues,
 *                        this single step is the entire rollback needed,
 *                        and it is always run first, before anything else.
 *   2. EVIDENCE         - records the rollback (reason, operator, before/after
 *                        flag state) in businesses/{ownerUid}/activationLog.
 *   3. MODULAR ROLLBACK - OPTIONAL, only with --rollback-modular: additionally
 *                        marks businessUnits/{businessId}.status =
 *                        ROLLBACK_ONLY via worker-boundary-migrate.mjs
 *                        --rollback. Use this only for suspected data
 *                        corruption in the modular tree, not for an
 *                        ordinary "pause this tenant" rollback (flag-off
 *                        alone already fully hides the module).
 *
 * state/main is NEVER touched by either step -- the legacy flow keeps
 * working immediately in both cases, which is the whole point.
 *
 * Usage:
 *   node scripts/worker-boundary-deactivate-tenant.mjs \
 *     --owner <ownerUid> --business <businessId> [--project <projectId>] \
 *     --reason "<why>" --confirm DEACTIVATE_STAGING_TENANT   # or _PRODUCTION_
 *     [--rollback-modular]   # also mark the businessUnit ROLLBACK_ONLY
 *
 * Output: JSON { ownerUid, businessId, projectId, steps:[...], result:'DEACTIVATED' }
 */

import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertTenantAuthorizedForProduction } from './lib/pilot-authorization.mjs';
import { connectAdmin } from './lib/firebase-admin-connect.mjs';
import { writeAdminTelemetry } from './lib/admin-telemetry.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGING_PROJECT = 'click360-staging-7620168025';
const PRODUCTION_PROJECT = 'click-360';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inline] = argv[index].replace(/^--/, '').split('=');
    const next = argv[index + 1];
    result[key] = inline ?? (next && !next.startsWith('--') ? (index += 1, next) : true);
  }
  return result;
}

async function runScript(scriptName, scriptArgs) {
  const scriptPath = path.join(__dirname, scriptName);
  try {
    const { stdout } = await execFileAsync('node', [scriptPath, ...scriptArgs], { maxBuffer:10 * 1024 * 1024 });
    return { ok:true, report:JSON.parse(stdout) };
  } catch (error) {
    let parsed = null;
    try { parsed = JSON.parse(error.stdout || ''); } catch (_ignored) { /* not JSON, fine */ }
    return { ok:false, report:parsed, error:error.stderr || error.message };
  }
}

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || STAGING_PROJECT);
if (projectId !== STAGING_PROJECT && projectId !== PRODUCTION_PROJECT) throw new Error(`Unapproved project: ${projectId}`);
const isProduction = projectId === PRODUCTION_PROJECT;
const envTag = isProduction ? 'PRODUCTION' : 'STAGING';
const ownerUid = String(args.owner || '');
const businessId = String(args.business || '');
const operator = String(args.by || 'AIIA-admin');
const reason = String(args.reason || '');
const rollbackModular = args['rollback-modular'] === true;
if (!ownerUid || !businessId) throw new Error('--owner and --business are required.');
if (!reason) throw new Error('--reason is required (recorded in the evidence trail).');
const requiredConfirm = `DEACTIVATE_${envTag}_TENANT`;
if (args.confirm !== requiredConfirm) throw new Error(`This command requires --confirm=${requiredConfirm}.`);

const pilotAuthorization = await assertTenantAuthorizedForProduction(projectId, ownerUid, businessId);
const db = await connectAdmin(projectId, 'worker-boundary-deactivate-tenant');

const steps = [];
function record(name, status, detail) {
  steps.push({ name, status, detail });
}

async function fail(reasonMessage) {
  steps.push({ name:'FAILED', status:'FAIL', detail:reasonMessage });
  await writeAdminTelemetry(db, { eventType:'worker_rollback_executed', ownerId:ownerUid, businessId, detail:`ROLLBACK STEP FAILED: ${reasonMessage}`, operator }).catch(() => {});
  console.log(JSON.stringify({ ownerUid, businessId, projectId, pilotAuthorization, steps, result:'FAILED' }, null, 2));
  process.exitCode = 1;
}

// STEP 1: FLAG OFF (always first, always run)
const disableFlag = await runScript('worker-boundary-admin.mjs', [
  '--action', 'disable-workers', '--owner', ownerUid, '--business', businessId, '--project', projectId,
  '--confirm', `DISABLE_WORKERS_${envTag}_TENANT`, '--by', operator, '--notes', `rollback: ${reason}`
]);
if (!disableFlag.ok || disableFlag.report?.after?.enabled !== false) {
  await fail(`Disabling the Workers flag failed: ${JSON.stringify(disableFlag.report || disableFlag.error)}`);
  process.exit(1);
}
record('flagOff', 'PASS', `businesses/${ownerUid}/featureFlags/workers.enabled = false. Legacy state/main flow is immediately authoritative again for every client.`);

// STEP 2: EVIDENCE
const activationId = `deactivate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
await db.collection('businesses').doc(ownerUid).collection('activationLog').doc(activationId).create({
  activationId, ownerUid, businessId, projectId, operator, reason,
  type:'ROLLBACK', rollbackModular, occurredAt:new Date().toISOString(),
  flagBefore:disableFlag.report.before, flagAfter:disableFlag.report.after
});
record('evidence', 'PASS', `businesses/${ownerUid}/activationLog/${activationId} written.`);

// STEP 3: MODULAR ROLLBACK (optional)
if (rollbackModular) {
  const rollbackDry = await runScript('worker-boundary-migrate.mjs', ['--owner', ownerUid, '--business', businessId, '--project', projectId]);
  if (!rollbackDry.ok || rollbackDry.report?.result?.action !== 'DRY_RUN_VERIFIED') {
    await fail(`Rollback dry-run (to obtain source-hash) failed: ${JSON.stringify(rollbackDry.report || rollbackDry.error)}`);
    process.exit(1);
  }
  const sourceHash = rollbackDry.report.sourceHash;
  const rollback = await runScript('worker-boundary-migrate.mjs', [
    '--owner', ownerUid, '--business', businessId, '--project', projectId,
    '--rollback', '--confirm', `ROLLBACK_${envTag}_WORKER_BOUNDARY`, '--source-hash', sourceHash
  ]);
  if (!rollback.ok || rollback.report?.result?.status !== 'ROLLBACK_ONLY') {
    await fail(`Modular rollback did not reach ROLLBACK_ONLY: ${JSON.stringify(rollback.report || rollback.error)}`);
    process.exit(1);
  }
  record('modularRollback', 'PASS', `businessUnits/${businessId}.status = ROLLBACK_ONLY. state/main untouched (stateMainWriteCount=${rollback.report.result.stateMainWriteCount}); legacy flow remains fully intact.`);
} else {
  record('modularRollback', 'PASS', 'Skipped (--rollback-modular not passed) -- flag-off alone already fully hides the module from every client.');
}

await writeAdminTelemetry(db, { eventType:'worker_rollback_executed', ownerId:ownerUid, businessId, detail:reason, operator }).catch(() => {});

console.log(JSON.stringify({ ownerUid, businessId, projectId, pilotAuthorization, activationId, steps, result:'DEACTIVATED' }, null, 2));
