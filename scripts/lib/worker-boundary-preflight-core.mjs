/**
 * Shared preflight check logic, used by both the standalone
 * worker-boundary-preflight.mjs CLI and worker-boundary-activate-tenant.mjs
 * (which calls this as its own first, non-skippable step). Keeping this in
 * one place means the activation command can never drift from what a human
 * would see by running preflight manually first.
 */
import { assertWorkersRulesDeployed } from './firestore-rules-remote.mjs';

const P0_SCHEMA_VERSION = 10;

export async function runPreflightChecks({ boundary, db, auth, ownerUid, businessId, projectId }) {
  const checks = [];
  function check(name, status, detail) {
    checks.push({ name, status, detail });
  }

  // 1-3: identity, schema, state/main
  let stateData = null;
  try {
    const stateSnapshot = await db.collection('businesses').doc(ownerUid).collection('state').doc('main').get();
    if (!stateSnapshot.exists) {
      check('stateMain', 'FAIL', 'businesses/{ownerUid}/state/main does not exist.');
    } else {
      const raw = stateSnapshot.data();
      stateData = raw;
      const expectedTenantKey = boundary.identity(ownerUid, ownerUid).tenantKey;
      const rootValid = raw.ownerUid === ownerUid && raw.ownerId === ownerUid && raw.businessId === ownerUid
        && raw.tenantKey === expectedTenantKey && Number(raw.schemaVersion) === P0_SCHEMA_VERSION;
      check('schema', Number(raw.schemaVersion) === P0_SCHEMA_VERSION ? 'PASS' : 'FAIL', `root schemaVersion=${raw.schemaVersion}, expected ${P0_SCHEMA_VERSION}`);
      check('stateMain', 'PASS', `state/main exists, revision=${raw.revision ?? raw.payload?.revision ?? 'unknown'}`);
      if (!rootValid) {
        check('identity', 'FAIL', 'Root identity does not match the canonical P0 contract (ownerUid/ownerId/businessId/tenantKey/schemaVersion). Run worker-boundary-repair-identity.mjs --dry-run to see the exact diff, or investigate before proceeding -- a contradictory root must never be silently repaired.');
      } else {
        const expected = { ownerUid, ownerId:ownerUid, businessId:ownerUid, tenantKey:expectedTenantKey, schemaVersion:P0_SCHEMA_VERSION };
        try {
          boundary.validateSourceDocumentIdentity(raw, expected);
          check('identity', 'PASS', 'payload.identity present and matches the canonical contract.');
        } catch (identityError) {
          if (String(identityError.message).includes('SOURCE_IDENTITY_ABSENT')) {
            check('identity', 'WARN', 'payload.identity is absent but root identity is canonical -- run worker-boundary-repair-identity.mjs before activation (REPAIR expected, not a blocker by itself).');
          } else {
            check('identity', 'FAIL', identityError.message);
          }
        }
      }
    }
  } catch (error) {
    check('stateMain', 'FAIL', `Could not read state/main: ${error.message}`);
  }

  // 4, 9: modules / stock
  if (stateData) {
    const legacyState = stateData.payload?.data || stateData.state || stateData;
    const business = (legacyState.businesses || []).find((entry) => entry.id === businessId);
    if (!business) {
      check('modules', 'FAIL', `No business with id "${businessId}" found in payload.data.businesses[]. Confirm the exact businessId with the customer.`);
    } else {
      const products = (legacyState.products || []).filter((product) => product.businessId === businessId);
      const sales = (legacyState.sales || []).filter((sale) => sale.businessId === businessId);
      check('modules', 'PASS', `business "${business.name}" found; products=${products.length}, sales=${sales.length}.`);
      // Migration normalizes stock from qty when stock is absent (mirrors app.js's
      // normalizeState() / fix 18fd918) -- a product is only a real blocker here if
      // NEITHER field resolves to a valid non-negative number, since that's what
      // would still migrate as NaN/undefined.
      const resolvedStock = (product) => {
        if (typeof product.stock === 'number' && !Number.isNaN(product.stock)) return product.stock;
        if (typeof product.qty === 'number' && !Number.isNaN(product.qty)) return product.qty;
        return NaN;
      };
      const badStock = products.filter((product) => Number.isNaN(resolvedStock(product)) || resolvedStock(product) < 0);
      check('stock', badStock.length === 0 ? 'PASS' : 'FAIL', badStock.length === 0
        ? `All ${products.length} products have a valid non-negative stock (directly or via qty fallback, normalized during migration).`
        : `${badStock.length} product(s) have no valid stock or qty (missing/negative/non-numeric on both): ${badStock.map((p) => p.id).join(', ')}.`);
      const cashSessions = (legacyState.cashSessions || []).filter((session) => session.businessId === businessId);
      const staleOpenCash = cashSessions.filter((session) => session.status === 'open');
      check('cash', staleOpenCash.length === 0 ? 'PASS' : 'WARN', staleOpenCash.length === 0
        ? `No open cash sessions (${cashSessions.length} total, all closed).`
        : `${staleOpenCash.length} cash session(s) currently open -- confirm with the owner before activation, an open session is not itself an error but should be understood.`);
    }
  } else {
    check('modules', 'FAIL', 'Cannot evaluate modules without state/main.');
    check('stock', 'FAIL', 'Cannot evaluate stock without state/main.');
    check('cash', 'FAIL', 'Cannot evaluate cash sessions without state/main.');
  }

  // 5: Auth
  try {
    const userRecord = await auth.getUser(ownerUid);
    check('auth', userRecord.disabled ? 'FAIL' : 'PASS', userRecord.disabled
      ? `Firebase Auth user ${ownerUid} exists but is DISABLED.`
      : `Firebase Auth user ${ownerUid} exists and is active (email=${userRecord.email || 'n/a'}).`);
  } catch (error) {
    check('auth', 'FAIL', `Firebase Auth user ${ownerUid} not found: ${error.message}`);
  }

  // 6, 7: seats, existing workers
  try {
    const unitRef = db.collection('businesses').doc(ownerUid).collection('businessUnits').doc(businessId);
    const [unitSnapshot, seatSnapshot, membersSnapshot] = await Promise.all([
      unitRef.get(), unitRef.collection('entitlement').doc('seats').get(), unitRef.collection('members').get()
    ]);
    if (!unitSnapshot.exists) {
      check('seats', 'WARN', 'Not yet migrated (no businessUnits doc) -- expected before first activation, not a blocker.');
      check('existingWorkers', 'PASS', 'No modular members yet (tenant not migrated).');
    } else {
      const unitStatus = unitSnapshot.data()?.status;
      check('businessUnitStatus', unitStatus === 'CUTOVER_VERIFIED' ? 'PASS' : 'WARN', `businessUnits/${businessId}.status = ${unitStatus}`);
      if (seatSnapshot.exists) {
        const seats = seatSnapshot.data();
        const capacity = Number(seats.baseSeatCap || 0) + Number(seats.addOnSeats || 0);
        check('seats', 'PASS', `baseSeatCap=${seats.baseSeatCap}, addOnSeats=${seats.addOnSeats}, activeMembers=${seats.activeMembers}, capacity=${capacity}.`);
      } else {
        check('seats', unitStatus ? 'FAIL' : 'WARN', unitStatus ? 'businessUnits exists but entitlement/seats is missing -- data inconsistency, investigate before activation.' : 'Not yet migrated.');
      }
      const activeMembers = membersSnapshot.docs.filter((docSnapshot) => docSnapshot.data()?.status === 'active');
      check('existingWorkers', 'PASS', `${membersSnapshot.size} member doc(s) total, ${activeMembers.length} active.`);
    }
  } catch (error) {
    check('seats', 'FAIL', `Could not read businessUnits/entitlement: ${error.message}`);
  }

  // 8: Rules deployed
  try {
    const rulesCheck = await assertWorkersRulesDeployed(projectId);
    check('rules', rulesCheck.ok ? 'PASS' : 'FAIL', rulesCheck.ok
      ? `Deployed Firestore rules for ${projectId} include the Workers rollout mechanics (updated ${rulesCheck.updateTime}).`
      : `Deployed Firestore rules for ${projectId} are MISSING: ${rulesCheck.missing.join(', ')}. Deploy firestore.rules before activation.`);
  } catch (error) {
    check('rules', 'FAIL', `Could not verify deployed rules: ${error.message}`);
  }

  // 11: invitations
  try {
    const invitationsSnapshot = await db.collection('businesses').doc(ownerUid).collection('invitations').get();
    const forThisBusiness = invitationsSnapshot.docs.filter((docSnapshot) => docSnapshot.data()?.businessUnitId === businessId);
    const stuckPending = forThisBusiness.filter((docSnapshot) => docSnapshot.data()?.status === 'pending');
    check('invitations', 'PASS', `${forThisBusiness.length} invitation(s) for this business unit, ${stuckPending.length} still pending (informational, not a blocker).`);
  } catch (error) {
    check('invitations', 'WARN', `Could not read invitations: ${error.message}`);
  }

  // 12: rollback possibility
  check('rollbackPossible', stateData ? 'PASS' : 'FAIL', stateData
    ? 'state/main is present and is never modified by any migration step -- rollback (disable flag, then businessUnits ROLLBACK_ONLY if needed) always remains available.'
    : 'Cannot confirm rollback safety without a readable state/main.');

  const blockers = checks.filter((entry) => entry.status === 'FAIL');
  const warnings = checks.filter((entry) => entry.status === 'WARN');
  const verdict = blockers.length === 0 ? 'GO' : 'NO-GO';

  return { checks, blockers, warnings, verdict };
}
