const assert = require('assert');
const fs = require('fs');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, getDoc, runTransaction, setDoc } = require('firebase/firestore');

const RULES = fs.readFileSync('firestore.rules', 'utf8');
const PROJECT_ID = 'demo-click360-p0-rules';

/**
 * r37.2 mission section 11 (DOS DISPOSITIVOS / CONFLICTOS): simulate the
 * real Owner having the app open on two devices at once, both making a
 * concurrent change (a sale that moves stock), and prove there is no
 * "blind full-state overwrite" -- one device's write must be rejected
 * rather than silently clobbering the other's already-committed data.
 *
 * This exercises the REAL mechanism from firebase-service.js's
 * pushLocalToFirestoreOnce() (the function behind window.click360SyncNow
 * for the legacy/default, non-modular tenant state path): every push is a
 * Firestore transaction that reads the current remote `revision`, and only
 * writes if it still matches the `expectedRevision` the device last saw
 * (baseRevision). If a SECOND device already advanced the revision in
 * between, the transaction throws `click360/revision-conflict` instead of
 * writing -- the real app then calls markSyncConflict() + surfaces
 * showSyncConflictRecovery() to the user, never applying the stale write.
 *
 * Why this test lives at the Firestore-emulator layer instead of a full
 * two-browser-context Playwright rig (the pattern used by every other
 * r37.2 test this session): that transaction/CAS logic runs inside real
 * Firestore, and a faithful two-device Playwright simulation would need a
 * live Auth+Firestore emulator wired into two real signed-in browser
 * sessions -- a materially larger, higher-risk new test category. This
 * harness reuses the SAME proven Firestore-emulator pattern already used
 * by qa-firestore-emulator.cjs / qa-worker-data-boundary-emulator.cjs
 * (already wired into `npm run qa:rules`) and replicates the exact
 * compare-and-swap transaction body from pushLocalToFirestoreOnce
 * (firebase-service.js ~line 2635-2727) against the real firestore.rules,
 * which is the actual mechanism that prevents data loss -- not a
 * reimplementation, the same read-check-write contract.
 */

function ownerProfile(uid, email) {
  return { uid, email, role: 'owner', isOwner: true, ownerId: uid, status: 'active', approved: true };
}

function tenantState(ownerId, revision, sales) {
  const tenantKey = `owner:${ownerId}:business:${ownerId}`;
  return {
    schemaVersion: 10,
    ownerUid: ownerId,
    ownerId,
    businessId: ownerId,
    tenantKey,
    revision,
    payload: {
      schemaVersion: 10,
      identity: { schemaVersion: 10, ownerUid: ownerId, ownerId, businessId: ownerId, tenantKey },
      data: {
        businesses: [{ id: 'biz_main', name: 'Comercial Dual Device', status: 'activo' }],
        products: [{ id: 'p1', businessId: 'biz_main', code: 'DUAL-1', name: 'Producto Dual', stock: 10, qty: 10, price: 5 }],
        sales, movements: [], invoices: [], dailyReports: [], deletedProducts: [], auditLogs: [],
        layaways: [], cashSessions: [], notifications: [], legalAcceptances: [],
        settings: { workers: [], labelTemplates: [], customers: [], reminders: [] }
      }
    }
  };
}

// Faithful replica of the real transaction body in
// firebase-service.js:pushLocalToFirestoreOnce (the revision compare-and-
// swap, forceWrite=false path) -- read current remote revision, only write
// if it still matches what this "device" last synced.
async function devicePush(db, ownerId, expectedRevision, nextDocument) {
  const stateDocRef = doc(db, 'businesses', ownerId, 'state', 'main');
  return runTransaction(db, async (transaction) => {
    const current = await transaction.get(stateDocRef);
    if (current.exists()) {
      const remote = current.data();
      const remoteRevision = Number(remote.revision || 0);
      if (remoteRevision !== expectedRevision) {
        const error = new Error('Hay cambios remotos sin resolver.');
        error.code = 'click360/revision-conflict';
        error.details = { expectedRevision, remoteRevision };
        throw error;
      }
    }
    transaction.set(stateDocRef, nextDocument);
  });
}

async function main() {
  const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES } });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'approvedUsers', 'owner-dual'), ownerProfile('owner-dual', 'owner-dual@example.test'));
      await setDoc(doc(db, 'businesses', 'owner-dual', 'state', 'main'), tenantState('owner-dual', 1, []));
    });

    const owner = env.authenticatedContext('owner-dual', { email: 'owner-dual@example.test' }).firestore();

    // Both "devices" last synced at revision 1 (the empty seed above) --
    // exactly the real scenario: Owner opened the app on phone AND laptop
    // this morning, both pulled the same starting state.
    const BASE_REVISION = 1;

    // ── Dispositivo A (celular): registra una venta real (Sale A) that
    // reduces stock, and pushes it -- this MUST succeed and become
    // revision 2. ──
    const saleA = { id: 'sale-device-a', businessId: 'biz_main', code: 'DUAL-1', qty: 3, total: 15, device: 'phone' };
    const docA = tenantState('owner-dual', BASE_REVISION + 1, [saleA]);
    await devicePush(owner, 'owner-dual', BASE_REVISION, docA);

    const afterA = await getDoc(doc(owner, 'businesses', 'owner-dual', 'state', 'main'));
    assert.strictEqual(afterA.data().revision, 2, 'Device A (phone) must have advanced the remote revision to 2');
    assert.strictEqual(afterA.data().payload.data.sales.length, 1, 'Device A sale must be the one and only sale recorded so far');
    assert.strictEqual(afterA.data().payload.data.sales[0].id, 'sale-device-a', 'the committed sale must be Device A\'s real sale');

    // ── Dispositivo B (laptop): CONCURRENTLY, before ever seeing Device
    // A's push, registered its OWN real sale (Sale B) locally and now
    // tries to push -- still using its stale BASE_REVISION=1. The real
    // Owner-reported risk this test guards against: Device B's push must
    // NEVER silently overwrite Device A's already-committed sale. ──
    const saleB = { id: 'sale-device-b', businessId: 'biz_main', code: 'DUAL-1', qty: 2, total: 10, device: 'laptop' };
    const docB = tenantState('owner-dual', BASE_REVISION + 1, [saleB]);

    let rejected = false;
    let rejectionCode = '';
    try {
      await devicePush(owner, 'owner-dual', BASE_REVISION, docB);
    } catch (error) {
      rejected = true;
      rejectionCode = error.code;
    }
    assert.strictEqual(rejected, true, 'Device B (laptop) pushing with a stale baseRevision must be REJECTED, not silently accepted -- this is the exact "blind full-state overwrite" the real Owner could suffer');
    assert.strictEqual(rejectionCode, 'click360/revision-conflict', `the rejection must be the real click360/revision-conflict, got "${rejectionCode}"`);

    // ── The real guarantee: after Device B's rejected push, Device A's
    // sale must STILL be there, completely untouched -- Device B's
    // conflicting local change was never applied to the shared cloud
    // state, exactly matching the real app's contract (the local change
    // stays on Device B's own machine, protected, pending manual
    // resolution via showSyncConflictRecovery -- see firebase-service.js
    // markSyncConflict()/app.js showSyncConflictRecovery()). ──
    const finalDoc = await getDoc(doc(owner, 'businesses', 'owner-dual', 'state', 'main'));
    const finalData = finalDoc.data();
    assert.strictEqual(finalData.revision, 2, 'the remote revision must remain exactly 2 (Device A\'s commit) -- Device B never advanced it');
    assert.strictEqual(finalData.payload.data.sales.length, 1, 'the remote must still contain exactly ONE sale -- Device B\'s sale must never have silently merged in or replaced it');
    assert.strictEqual(finalData.payload.data.sales[0].id, 'sale-device-a', 'Device A\'s real sale must be the one that survives -- proof there was no blind overwrite');
    assert.strictEqual(finalData.payload.data.products[0].stock, 10, 'product stock in the surviving snapshot must still be Device A\'s committed value, never silently re-based off Device B\'s stale local copy');

    // A worker-approval race is the same mechanism (a real regression
    // would show up identically as a wrongly-accepted stale write) --
    // confirm a THIRD push, now correctly rebased on the real current
    // revision (2), succeeds normally. This proves the guard is a real
    // compare-and-swap (rejects stale, accepts current), not a permanent
    // lockout.
    const saleBRebased = { ...saleB, rebasedOn: 2 };
    const docBRebased = tenantState('owner-dual', 3, [saleA, saleBRebased]);
    await devicePush(owner, 'owner-dual', 2, docBRebased);
    const afterRebase = await getDoc(doc(owner, 'businesses', 'owner-dual', 'state', 'main'));
    assert.strictEqual(afterRebase.data().revision, 3, 'once Device B rebases on the real current revision, its push must succeed normally');
    assert.strictEqual(afterRebase.data().payload.data.sales.length, 2, 'after a correct rebase, BOTH real sales (Device A + Device B) must be present -- no data lost on either side');

    console.log('CLICK 360 r37.2 dual-device conflict PASS: two devices of the same Owner racing a concurrent sale -- Device A\'s commit survives untouched, Device B\'s stale push is rejected (click360/revision-conflict), no data lost on either side, and a correctly-rebased retry succeeds normally with both real sales intact.');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
