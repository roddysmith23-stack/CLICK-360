/**
 * worker-boundary-preflight.mjs
 *
 * Phase 3.3: given one owner/business, answers GO / NO-GO for activating
 * Workers on that tenant. See scripts/lib/worker-boundary-preflight-core.mjs
 * for the exact checks performed (identity, schema, state/main, modules,
 * auth, seats, existing workers, deployed rules, stock, cash, invitations,
 * rollback possibility) -- this file is a thin CLI wrapper around that
 * shared core, which worker-boundary-activate-tenant.mjs also calls
 * directly as its own non-skippable first step.
 *
 * This script is READ-ONLY: it never writes anything. For production it
 * still requires the tenant to already be in the pilot allowlist (same as
 * every other production-capable script), because even preflight reads are
 * real customer data reads.
 *
 * Usage:
 *   node scripts/worker-boundary-preflight.mjs --owner <ownerUid> --business <businessId> [--project <projectId>]
 *
 * Output: JSON { ownerUid, businessId, projectId, checks:[...], verdict:'GO'|'NO-GO', blockers:[...] }
 */

import process from 'node:process';
import { assertTenantAuthorizedForProduction } from './lib/pilot-authorization.mjs';
import { runPreflightChecks } from './lib/worker-boundary-preflight-core.mjs';
import { connectAdmin, connectAuth } from './lib/firebase-admin-connect.mjs';

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

const args = parseArgs(process.argv.slice(2));
const projectId = String(args.project || STAGING_PROJECT);
if (projectId !== STAGING_PROJECT && projectId !== PRODUCTION_PROJECT) throw new Error(`Unapproved project: ${projectId}`);
const ownerUid = String(args.owner || '');
const businessId = String(args.business || '');
if (!ownerUid || !businessId) throw new Error('--owner and --business are required.');

const pilotAuthorization = await assertTenantAuthorizedForProduction(projectId, ownerUid, businessId);
const db = await connectAdmin(projectId);
const auth = await connectAuth(projectId);

const { checks, blockers, warnings, verdict } = await runPreflightChecks({ boundary, db, auth, ownerUid, businessId, projectId });

console.log(JSON.stringify({
  ownerUid, businessId, projectId, pilotAuthorization,
  checks, verdict, blockers:blockers.map((entry) => entry.name), warnings:warnings.map((entry) => entry.name)
}, null, 2));

if (verdict === 'NO-GO') process.exitCode = 1;
