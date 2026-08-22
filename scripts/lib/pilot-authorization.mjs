/**
 * Phase 3.3 production authorization gate.
 *
 * Every script that can target click-360 (migration, identity repair, the
 * admin tool's production actions, tenant activation/rollback) calls
 * assertTenantAuthorizedForProduction(ownerUid, businessId) before doing
 * anything else. This is INDEPENDENT of, and in addition to, each script's
 * own --confirm string: a correct --confirm on the wrong tenant, a
 * copy-pasted command, or a future batch/loop can never reach an
 * unauthorized tenant, because there is no wildcard or pattern matching --
 * only an exact ownerUid+businessId pair explicitly present in
 * scripts/config/pilot-authorized-tenants.json passes.
 *
 * Adding a tenant to that file is a deliberate, reviewed, git-committed
 * change made only after a human has explicitly approved that specific
 * customer for the pilot -- not something any script can do to itself.
 *
 * Staging is intentionally NOT gated by this file: it holds no real
 * customer data, and Phase 3.1/3.2 already proved the underlying mechanics
 * there extensively. This gate exists specifically for the point where
 * real production data first becomes reachable.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = path.resolve(__dirname, '..', 'config', 'pilot-authorized-tenants.json');
const PRODUCTION_PROJECT = 'click-360';

export async function loadPilotAllowlist() {
  const raw = await fs.readFile(ALLOWLIST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed[PRODUCTION_PROJECT])) {
    throw new Error(`PILOT_ALLOWLIST_MALFORMED: ${ALLOWLIST_PATH} must have a "${PRODUCTION_PROJECT}" array.`);
  }
  return parsed[PRODUCTION_PROJECT];
}

/**
 * Throws PILOT_TENANT_NOT_AUTHORIZED unless projectId !== production, or the
 * exact (ownerUid, businessId) pair is present in the allowlist. Returns the
 * matching allowlist entry (authorizedBy/authorizedAt/notes) on success, so
 * callers can echo it back in their own report for the audit trail.
 */
export async function assertTenantAuthorizedForProduction(projectId, ownerUid, businessId) {
  if (String(projectId || '').trim() !== PRODUCTION_PROJECT) return null;
  const allowlist = await loadPilotAllowlist();
  const entry = allowlist.find((candidate) => candidate.ownerUid === ownerUid && candidate.businessId === businessId);
  if (!entry) {
    throw new Error(
      `PILOT_TENANT_NOT_AUTHORIZED: ${ownerUid}/${businessId} is not present in ${ALLOWLIST_PATH}. ` +
      'Add an explicit, reviewed entry there before any production operation for this tenant can run.'
    );
  }
  if (!entry.authorizedBy || !entry.authorizedAt) {
    throw new Error(`PILOT_ALLOWLIST_ENTRY_INCOMPLETE: ${ownerUid}/${businessId} entry is missing authorizedBy/authorizedAt.`);
  }
  return entry;
}
