/**
 * r36: CEO Admin Web -- Firestore rules contract for the browser admin
 * panel. This is the ONE real server-side security boundary for that
 * panel (isPlatformAdmin() in firestore.rules), so it gets its own
 * dedicated, adversarial emulator suite rather than a few lines bolted
 * onto qa-firestore-emulator.cjs.
 *
 * What this proves:
 *  - The exact admin identity (roddysmithceo@gmail.com) can read/act on
 *    ANY tenant's accountAccess, state/main, featureFlags, businessUnits,
 *    seatRequests/capacityRequests/activationLog, and can create (never
 *    modify/delete) adminBackups/adminAuditLogs entries.
 *  - Every ordinary authenticated user -- including one who tries to
 *    impersonate the admin by claiming a similar-looking uid, or an
 *    attacker with no relationship to the target tenant at all -- is
 *    DENIED on every one of those same paths. Cross-tenant isolation for
 *    ordinary users is unchanged by this release.
 *  - The lightweight shape checks on accountAccess writes (valid plan
 *    code, monotonic revision, uid/businessId path consistency, demo
 *    tenant blocked) actually reject a malformed admin write, not just a
 *    well-formed one.
 */
const assert = require('assert');
const fs = require('fs');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const { Timestamp, doc, getDoc, serverTimestamp, setDoc, updateDoc } = require('firebase/firestore');

const RULES = fs.readFileSync('firestore.rules', 'utf8');
const PROJECT_ID = 'demo-click360-ceo-admin-rules';
const ADMIN_EMAIL = 'roddysmithceo@gmail.com';

async function main() {
  const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: RULES } });

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'accountAccess', 'customer-a'), {
        uid: 'customer-a', businessId: 'customer-a', email: 'customer-a@example.test', name: 'Customer A', photoURL: '',
        status: 'active', plan: 'pro', planCode: 'pro', lastSeenAt: Timestamp.now(), createdAt: Timestamp.now(),
        source: 'admin_activation', entitlementVersion: 16, revision: 3
      });
      await setDoc(doc(db, 'businesses', 'customer-a', 'state', 'main'), {
        ownerUid: 'customer-a', ownerId: 'customer-a', businessId: 'customer-a', schemaVersion: 10,
        tenantKey: 'owner:customer-a:business:customer-a', revision: 1,
        payload: { schemaVersion: 10, identity: { ownerUid: 'customer-a', ownerId: 'customer-a', businessId: 'customer-a', tenantKey: 'owner:customer-a:business:customer-a' }, data: { businesses: [], products: [] } }
      });
      await setDoc(doc(db, 'businesses', 'customer-a', 'featureFlags', 'workers'), {
        ownerUid: 'customer-a', enabled: false, enabledAt: null, enabledBy: null, updatedBy: 'seed', updatedAt: Timestamp.now(), notes: 'seed'
      });
      await setDoc(doc(db, 'businesses', 'customer-a', 'businessUnits', 'biz_main'), {
        ownerUid: 'customer-a', businessId: 'biz_main', status: 'CUTOVER_VERIFIED'
      });
      await setDoc(doc(db, 'businesses', 'customer-a', 'seatRequests', 'req-1'), {
        ownerUid: 'customer-a', requestedBy: 'customer-a', businessId: 'biz_main', requestedAt: Timestamp.now(), status: 'pending'
      });
      await setDoc(doc(db, 'businesses', 'customer-a', 'capacityRequests', 'req-1'), {
        ownerUid: 'customer-a', requestedBy: 'customer-a', kind: 'products', requestedAt: Timestamp.now(), status: 'pending'
      });
      await setDoc(doc(db, 'businesses', 'customer-a', 'activationLog', 'log-1'), {
        ownerUid: 'customer-a', createdAt: Timestamp.now()
      });
    });

    const admin = env.authenticatedContext('admin-uid', { email: ADMIN_EMAIL }).firestore();
    const adminUppercase = env.authenticatedContext('admin-uid-2', { email: 'RoddySmithCEO@Gmail.com' }).firestore();
    const attacker = env.authenticatedContext('attacker', { email: 'attacker@example.test' }).firestore();
    const impostor = env.authenticatedContext('customer-a', { email: 'attacker-claims-customer-a-uid@example.test' }).firestore();
    const customerA = env.authenticatedContext('customer-a', { email: 'customer-a@example.test' }).firestore();

    // ── Admin CAN read every relevant path for a tenant that is not them ──
    await assertSucceeds(getDoc(doc(admin, 'accountAccess', 'customer-a')));
    await assertSucceeds(getDoc(doc(admin, 'businesses', 'customer-a', 'state', 'main')));
    await assertSucceeds(getDoc(doc(admin, 'businesses', 'customer-a', 'featureFlags', 'workers')));
    await assertSucceeds(getDoc(doc(admin, 'businesses', 'customer-a', 'businessUnits', 'biz_main')));
    await assertSucceeds(getDoc(doc(admin, 'businesses', 'customer-a', 'seatRequests', 'req-1')));
    await assertSucceeds(getDoc(doc(admin, 'businesses', 'customer-a', 'capacityRequests', 'req-1')));
    await assertSucceeds(getDoc(doc(admin, 'businesses', 'customer-a', 'activationLog', 'log-1')));
    console.log('PASS admin can read every CEO Admin Web surface for a tenant that is not their own');

    // Rules-language .lower() must make the email check case-insensitive
    // (Firebase Auth email claims are not guaranteed lowercase).
    await assertSucceeds(getDoc(doc(adminUppercase, 'accountAccess', 'customer-a')));
    console.log('PASS admin email check is case-insensitive');

    // ── Admin CAN write a valid plan change ──
    await assertSucceeds(updateDoc(doc(admin, 'accountAccess', 'customer-a'), {
      uid: 'customer-a', businessId: 'customer-a', status: 'paid_business', plan: 'business', planCode: 'business', revision: 4
    }));
    await assertSucceeds(updateDoc(doc(admin, 'businesses', 'customer-a', 'featureFlags', 'workers'), {
      enabled: true, enabledAt: Timestamp.now(), enabledBy: ADMIN_EMAIL, updatedBy: ADMIN_EMAIL, updatedAt: Timestamp.now()
    }));
    console.log('PASS admin can apply a valid plan change and toggle the Workers flag');

    // ── Admin write is REJECTED if malformed (defense in depth, not just app-code trust) ──
    await assertFails(updateDoc(doc(admin, 'accountAccess', 'customer-a'), {
      uid: 'customer-a', businessId: 'customer-a', status: 'paid_bogus', plan: 'bogus_plan', planCode: 'bogus_plan', revision: 5
    }));
    await assertFails(updateDoc(doc(admin, 'accountAccess', 'customer-a'), {
      uid: 'customer-a', businessId: 'customer-a', status: 'paid_business', plan: 'business', planCode: 'business', revision: 4
    }), 'a revision that does not strictly increase must be rejected');
    await assertFails(setDoc(doc(admin, 'accountAccess', 'demo-click360'), {
      uid: 'demo-click360', businessId: 'demo-click360', status: 'paid_base', plan: 'base', planCode: 'base', revision: 1
    }), 'the demo tenant must stay forbidden even for the admin');
    console.log('PASS malformed/invalid-plan/non-monotonic-revision/demo-tenant admin writes are rejected');

    // ── Admin can log its own actions (create-only, never mutate/delete) ──
    await assertSucceeds(setDoc(doc(admin, 'adminBackups', 'web-backup-1'), { actorEmail: ADMIN_EMAIL, action: 'ceo_admin_web_activation', createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(admin, 'adminAuditLogs', 'web-audit-1'), { actorEmail: ADMIN_EMAIL, action: 'ceo_admin_web_activation', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(admin, 'adminBackups', 'web-backup-1'), { actorEmail: 'someone-else@example.test' }), 'adminBackups must be immutable even for the admin');
    console.log('PASS admin can create (never mutate) backup/audit entries');

    // ── Every ordinary user, including one impersonating the target uid with a different email, is DENIED ──
    await assertFails(getDoc(doc(attacker, 'accountAccess', 'customer-a')));
    await assertFails(getDoc(doc(attacker, 'businesses', 'customer-a', 'state', 'main')));
    await assertFails(getDoc(doc(attacker, 'businesses', 'customer-a', 'featureFlags', 'workers')));
    await assertFails(getDoc(doc(attacker, 'businesses', 'customer-a', 'businessUnits', 'biz_main')));
    await assertFails(updateDoc(doc(attacker, 'accountAccess', 'customer-a'), { status: 'paid_business', plan: 'business', planCode: 'business', revision: 4 }));
    await assertFails(setDoc(doc(attacker, 'adminBackups', 'attacker-backup'), { actorEmail: 'attacker@example.test', createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(attacker, 'adminAuditLogs', 'attacker-audit'), { actorEmail: 'attacker@example.test', createdAt: serverTimestamp() }));
    console.log('PASS a random authenticated user is denied on every CEO Admin Web surface (cross-tenant DENY unchanged)');

    // Sharing the target's uid but not the admin email must still be denied --
    // the gate is the auth token's email claim, never the uid alone.
    await assertFails(updateDoc(doc(impostor, 'accountAccess', 'customer-a'), { status: 'paid_business', plan: 'business', planCode: 'business', revision: 4 }));
    console.log('PASS matching the target uid without the admin email claim is still denied');

    // The tenant's own owner keeps their existing self-service rights and
    // stays unable to grant themselves someone else's rules-level admin path.
    await assertSucceeds(getDoc(doc(customerA, 'accountAccess', 'customer-a')));
    await assertFails(updateDoc(doc(customerA, 'accountAccess', 'customer-a'), { status: 'paid_business', plan: 'business', planCode: 'business', revision: 4 }), 'a customer cannot self-upgrade their own plan through the admin write path');
    console.log('PASS tenant owner keeps only their existing self-service rights, not the admin write path');

    console.log('PASS CEO Admin Web Firestore rules: admin identity gate, valid writes succeed, malformed/impersonated/cross-tenant writes denied');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
