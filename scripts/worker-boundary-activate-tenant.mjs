/**
 * worker-boundary-activate-tenant.mjs
 *
 * Phase 3.3 single-command tenant activation. Runs, in this exact order,
 * with a hard stop on the first failure -- there is no flag to skip a step:
 *
 *   1. PREFLIGHT   - runPreflightChecks() (same as worker-boundary-preflight.mjs).
 *                    Anything but verdict:"GO" aborts here, before any write.
 *   2. EVIDENCE    - writes businesses/{ownerUid}/activationLog/{id} with the
 *                    full preflight report and pre-activation state, before
 *                    any mutation, so there is always a permanent record of
 *                    what the system looked like right before activation.
 *   3. REPAIR      - only if preflight's identity check was WARN (payload.identity
 *                    absent but root canonical): shells out to
 *                    worker-boundary-repair-identity.mjs --confirm.
 *   4. MIGRATE     - dry-run (captures source-hash) then --apply, shelling
 *                    out to worker-boundary-migrate.mjs, reusing the exact
 *                    already-verified script.
 *   5. PROMOTE     - worker-boundary-migrate.mjs --promote. Verifies the
 *                    businessUnit reaches CUTOVER_VERIFIED.
 *   6. FLAG ON     - worker-boundary-admin.mjs --action enable-workers.
 *                    This is the ONLY step that makes Workers reachable by
 *                    a real client -- everything before this point is
 *                    invisible to end users even if it partially fails.
 *   7. SMOKE       - reduced, Admin-SDK-only structural smoke (no browser):
 *                    re-reads flag/entitlement/businessUnit and confirms
 *                    they are self-consistent. A full live login smoke
 *                    (real browser, real invite/accept) is a recommended
 *                    separate, human-triggered step -- not automated here,
 *                    to avoid driving a browser against production from an
 *                    unattended command.
 *
 * Every step's own script re-enforces its own guards (confirm strings,
 * pilot-authorization, source-hash preconditions) independently -- this
 * orchestrator does not bypass any of them, it only sequences them.
 *
 * Usage:
 *   node scripts/worker-boundary-activate-tenant.mjs \
 *     --owner <ownerUid> --business <businessId> [--project <projectId>] \
 *     --confirm ACTIVATE_STAGING_TENANT   # or ACTIVATE_PRODUCTION_TENANT
 *
 * Output: JSON { ownerUid, businessId, projectId, steps:[...], result:'ACTIVATED'|'ABORTED' }
 */

import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertTenantAuthorizedForProduction } from './lib/pilot-authorization.mjs';
import { runPreflightChecks } from './lib/worker-boundary-preflight-core.mjs';
import { connectAdmin, connectAuth } from './lib/firebase-admin-connect.mjs';
import { writeAdminTelemetry } from './lib/admin-telemetry.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await import('../worker-data-boundary.js');
const boundary = globalThis.CLICK360_WORKER_DATA_BOUNDARY;
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
if (!ownerUid || !businessId) throw new Error('--owner and --business are required.');
const requiredConfirm = `ACTIVATE_${envTag}_TENANT`;
if (args.confirm !== requiredConfirm) throw new Error(`This command requires --confirm=${requiredConfirm}.`);

const pilotAuthorization = await assertTenantAuthorizedForProduction(projectId, ownerUid, businessId);
const db = await connectAdmin(projectId, 'worker-boundary-activate-tenant');
const auth = await connectAuth(projectId);

const steps = [];
function record(name, status, detail) {
  steps.push({ name, status, detail });
  return status;
}

async function abort(reason) {
  steps.push({ name:'ABORTED', status:'FAIL', detail:reason });
  await writeAdminTelemetry(db, { eventType:'worker_migration_failed', ownerId:ownerUid, businessId, detail:reason, operator }).catch(() => {});
  console.log(JSON.stringify({ ownerUid, businessId, projectId, pilotAuthorization, steps, result:'ABORTED' }, null, 2));
  process.exitCode = 1;
}

// STEP 1: PREFLIGHT
const preflight = await runPreflightChecks({ boundary, db, auth, ownerUid, businessId, projectId });
record('preflight', preflight.verdict === 'GO' ? 'PASS' : 'FAIL', `verdict=${preflight.verdict}, blockers=${preflight.blockers.map((entry) => entry.name).join(',') || 'none'}`);
if (preflight.verdict !== 'GO') {
  await abort(`Preflight verdict was NO-GO: ${preflight.blockers.map((entry) => `${entry.name}: ${entry.detail}`).join(' | ')}`);
  process.exit(1);
}

// STEP 2: EVIDENCE (before any mutation)
const activationId = `activate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const evidenceRef = db.collection('businesses').doc(ownerUid).collection('activationLog').doc(activationId);
await evidenceRef.create({
  activationId, ownerUid, businessId, projectId, operator,
  startedAt: new Date().toISOString(),
  preflight: { verdict:preflight.verdict, checks:preflight.checks },
  status:'IN_PROGRESS'
});
record('evidence', 'PASS', `businesses/${ownerUid}/activationLog/${activationId} written before any mutation.`);

// STEP 3: REPAIR (only if preflight flagged payload.identity as absent-but-repairable)
const identityCheck = preflight.checks.find((entry) => entry.name === 'identity');
if (identityCheck?.status === 'WARN') {
  const repairDry = await runScript('worker-boundary-repair-identity.mjs', ['--owner', ownerUid, '--business', ownerUid, '--project', projectId, '--dry-run']);
  if (!repairDry.ok || !String(repairDry.report?.action || '').includes('REPAIR')) {
    await abort(`Identity repair dry-run did not return REPAIR as expected: ${JSON.stringify(repairDry.report || repairDry.error)}`);
    process.exit(1);
  }
  const repairApply = await runScript('worker-boundary-repair-identity.mjs', ['--owner', ownerUid, '--business', ownerUid, '--project', projectId, '--confirm', `REPAIR_${envTag}_IDENTITY`]);
  if (!repairApply.ok || repairApply.report?.action !== 'REPAIR' || !repairApply.report?.payloadDataUnchanged) {
    await abort(`Identity repair apply failed or did not confirm payload.data unchanged: ${JSON.stringify(repairApply.report || repairApply.error)}`);
    process.exit(1);
  }
  record('repair', 'PASS', `payload.identity materialized; payload.data confirmed unchanged (hashBefore vs hashAfter check inside the repair script itself).`);
} else {
  record('repair', 'PASS', 'Not needed (payload.identity already canonical).');
}

// STEP 4: MIGRATE dry-run + apply
const migrateDry = await runScript('worker-boundary-migrate.mjs', ['--owner', ownerUid, '--business', businessId, '--project', projectId]);
if (!migrateDry.ok || migrateDry.report?.result?.action !== 'DRY_RUN_VERIFIED') {
  await abort(`Migration dry-run did not return DRY_RUN_VERIFIED: ${JSON.stringify(migrateDry.report || migrateDry.error)}`);
  process.exit(1);
}
const sourceHash = migrateDry.report.sourceHash;
const migrateApply = await runScript('worker-boundary-migrate.mjs', [
  '--owner', ownerUid, '--business', businessId, '--project', projectId,
  '--apply', '--confirm', `APPLY_${envTag}_WORKER_BOUNDARY`, '--source-hash', sourceHash
]);
if (!migrateApply.ok || !['APPLIED_VERIFIED', 'NOOP_VERIFIED'].includes(migrateApply.report?.result?.action)) {
  await abort(`Migration apply did not reach VERIFIED: ${JSON.stringify(migrateApply.report || migrateApply.error)}`);
  process.exit(1);
}
record('migrate', 'PASS', `sourceHash=${sourceHash}, action=${migrateApply.report.result.action}, status=${migrateApply.report.result.status}.`);

// STEP 5: PROMOTE
const promote = await runScript('worker-boundary-migrate.mjs', [
  '--owner', ownerUid, '--business', businessId, '--project', projectId,
  '--promote', '--confirm', `PROMOTE_${envTag}_WORKER_BOUNDARY`, '--source-hash', sourceHash
]);
if (!promote.ok || promote.report?.result?.status !== 'CUTOVER_VERIFIED') {
  await abort(`Promote did not reach CUTOVER_VERIFIED: ${JSON.stringify(promote.report || promote.error)}`);
  process.exit(1);
}
record('promote', 'PASS', `businessUnits/${businessId}.status = CUTOVER_VERIFIED (action=${promote.report.result.action}).`);

// STEP 6: FLAG ON (the only step that makes Workers reachable by a real client)
const enableFlag = await runScript('worker-boundary-admin.mjs', [
  '--action', 'enable-workers', '--owner', ownerUid, '--business', businessId, '--project', projectId,
  '--confirm', `ENABLE_WORKERS_${envTag}_TENANT`, '--by', operator
]);
if (!enableFlag.ok || enableFlag.report?.after?.enabled !== true) {
  await abort(`Enabling the Workers flag failed: ${JSON.stringify(enableFlag.report || enableFlag.error)}`);
  process.exit(1);
}
record('flagOn', 'PASS', `businesses/${ownerUid}/featureFlags/workers.enabled = true.`);

// STEP 7: REDUCED SMOKE (Admin-SDK structural check; no browser)
const smokeStatus = await runScript('worker-boundary-admin.mjs', ['--action', 'status', '--owner', ownerUid, '--business', businessId, '--project', projectId]);
const smokeOk = smokeStatus.ok
  && smokeStatus.report?.workersFlag?.enabled === true
  && smokeStatus.report?.businessUnitStatus === 'CUTOVER_VERIFIED'
  && smokeStatus.report?.seats
  && Number(smokeStatus.report.seats.activeMembers) <= (Number(smokeStatus.report.seats.baseSeatCap || 0) + Number(smokeStatus.report.seats.addOnSeats || 0));
record('smokeReduced', smokeOk ? 'PASS' : 'FAIL', smokeOk
  ? 'Flag enabled, businessUnit CUTOVER_VERIFIED, seat entitlement internally consistent (Admin-SDK structural check only -- schedule a real browser login smoke separately before relying on this for the pilot).'
  : `Structural smoke check failed: ${JSON.stringify(smokeStatus.report || smokeStatus.error)}`);
if (!smokeOk) {
  await abort('Reduced smoke check failed after activation completed -- investigate immediately; consider running worker-boundary-deactivate-tenant.mjs.');
  process.exit(1);
}

await evidenceRef.update({ status:'ACTIVATED', completedAt:new Date().toISOString(), steps });

console.log(JSON.stringify({ ownerUid, businessId, projectId, pilotAuthorization, activationId, steps, result:'ACTIVATED' }, null, 2));
