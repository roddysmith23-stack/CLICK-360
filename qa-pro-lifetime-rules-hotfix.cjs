const assert = require('assert');
const fs = require('fs');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require('@firebase/rules-unit-testing');
const {
  Timestamp,
  doc,
  getDoc,
  runTransaction,
  setDoc
} = require('firebase/firestore');

const RULES_PATH = process.env.RULES_PATH || 'firestore.rules';
const RULES = fs.readFileSync(RULES_PATH, 'utf8');
const PROJECT_ID = 'demo-click360-pro-lifetime-hotfix';
const EXPECT_PRO_LIFETIME = process.env.EXPECT_PRO_LIFETIME !== 'deny';

function tenantKey(uid) {
  return `owner:${uid}:business:${uid}`;
}

function access(uid, overrides = {}) {
  return {
    uid,
    ownerId: uid,
    businessId: uid,
    tenantKey: tenantKey(uid),
    email: `${uid}@example.test`,
    status: 'active',
    plan: 'pro',
    planCode: 'pro_lifetime',
    billingStatus: 'lifetime',
    lifetime: true,
    expiresAt: null,
    ...overrides
  };
}

function accessWithoutExpiry(uid, overrides = {}) {
  const value = access(uid, overrides);
  delete value.expiresAt;
  return value;
}

function state(uid, revision = 1) {
  return {
    schemaVersion: 10,
    ownerUid: uid,
    ownerId: uid,
    businessId: uid,
    tenantKey: tenantKey(uid),
    revision,
    payload: {
      schemaVersion: 10,
      identity: {
        schemaVersion: 10,
        ownerUid: uid,
        ownerId: uid,
        businessId: uid,
        tenantKey: tenantKey(uid)
      },
      data: {
        businesses: [{ id: 'biz_main' }],
        products: [],
        sales: [],
        movements: [],
        invoices: [],
        dailyReports: [],
        deletedProducts: [],
        auditLogs: [],
        layaways: [],
        cashSessions: [],
        notifications: [],
        legalAcceptances: [],
        settings: {
          workers: [],
          labelTemplates: [],
          customers: [],
          reminders: []
        }
      }
    }
  };
}

async function createFirstTenant(db, uid) {
  const stateRef = doc(db, 'businesses', uid, 'state', 'main');
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(stateRef);
    assert.equal(current.exists(), false, `${uid} must start without state/main`);
    transaction.set(stateRef, state(uid));
  });
}

async function main() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES }
  });

  const now = Date.now();
  const activeTrialStart = Timestamp.fromMillis(now - 60 * 60 * 1000);
  const expiredTrialStart = Timestamp.fromMillis(now - 8 * 24 * 60 * 60 * 1000);
  const expiredPaidAt = Timestamp.fromMillis(now - 60 * 1000);

  const allowed = {
    'legacy-paid-base': accessWithoutExpiry('legacy-paid-base', {
      status: 'paid_base', plan: 'base', planCode: 'base',
      billingStatus: 'subscription', lifetime: false
    }),
    'legacy-paid-pro': accessWithoutExpiry('legacy-paid-pro', {
      status: 'paid_pro', plan: 'pro', planCode: 'pro',
      billingStatus: 'subscription', lifetime: false
    }),
    'legacy-founder': access('legacy-founder', {
      status: 'founder', plan: 'founder', planCode: 'founder',
      billingStatus: 'internal', lifetime: true
    }),
    'legacy-trial-active': access('legacy-trial-active', {
      status: 'trial', plan: 'normal', planCode: 'base',
      billingStatus: 'trial', lifetime: false,
      trialDays: 7, trialStartedAt: activeTrialStart
    })
  };

  const denied = {
    'invalid-lifetime-false': access('invalid-lifetime-false', { lifetime: false }),
    'invalid-plan-code': access('invalid-plan-code', { planCode: 'pro_monthly' }),
    'invalid-billing': access('invalid-billing', { billingStatus: 'subscription' }),
    'invalid-suspended': access('invalid-suspended', { status: 'suspended' }),
    'invalid-uid-mismatch': access('invalid-uid-mismatch', {
      uid: 'different-owner',
      ownerId: 'invalid-uid-mismatch',
      businessId: 'invalid-uid-mismatch',
      tenantKey: tenantKey('invalid-uid-mismatch')
    }),
    'legacy-trial-expired': access('legacy-trial-expired', {
      status: 'trial', plan: 'normal', planCode: 'base',
      billingStatus: 'trial', lifetime: false,
      trialDays: 7, trialStartedAt: expiredTrialStart
    }),
    'legacy-paid-expired': access('legacy-paid-expired', {
      status: 'paid_base', plan: 'base', planCode: 'base',
      billingStatus: 'subscription', lifetime: false,
      expiresAt: expiredPaidAt
    })
  };

  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const [uid, value] of Object.entries({
        'shary-pro-lifetime': access('shary-pro-lifetime'),
        ...allowed,
        ...denied
      })) {
        await setDoc(doc(db, 'accountAccess', uid), value);
      }
      await setDoc(
        doc(db, 'businesses', 'protected-other-tenant', 'state', 'main'),
        state('protected-other-tenant')
      );
      await setDoc(
        doc(db, 'businesses', 'demo-click360', 'state', 'main'),
        state('demo-click360')
      );
    });

    for (const uid of Object.keys(allowed)) {
      const db = env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
      await assertSucceeds(createFirstTenant(db, uid));
      await assertSucceeds(getDoc(doc(db, 'businesses', uid, 'state', 'main')));
    }

    for (const uid of Object.keys(denied)) {
      const db = env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore();
      await assertFails(createFirstTenant(db, uid));
    }

    const shary = env.authenticatedContext('shary-pro-lifetime', {
      email: 'shary-pro-lifetime@example.test'
    }).firestore();
    if (EXPECT_PRO_LIFETIME) {
      await assertSucceeds(createFirstTenant(shary, 'shary-pro-lifetime'));
      await assertSucceeds(getDoc(doc(
        shary,
        'businesses',
        'shary-pro-lifetime',
        'state',
        'main'
      )));
    } else {
      await assertFails(createFirstTenant(shary, 'shary-pro-lifetime'));
    }
    await assertFails(getDoc(doc(shary, 'businesses', 'protected-other-tenant', 'state', 'main')));
    await assertFails(setDoc(
      doc(shary, 'businesses', 'protected-other-tenant', 'state', 'main'),
      state('protected-other-tenant')
    ));
    await assertFails(getDoc(doc(shary, 'businesses', 'demo-click360', 'state', 'main')));
    await assertFails(setDoc(
      doc(shary, 'businesses', 'demo-click360', 'state', 'main'),
      state('demo-click360')
    ));

    console.log(`PASS: PRO Lifetime canonical first tenant is ${EXPECT_PRO_LIFETIME ? 'allowed' : 'denied as the live baseline'}.`);
    console.log('PASS: cross-tenant and demo-click360 access remains denied.');
    console.log('PASS: malformed, expired, and suspended access remains denied.');
    console.log('PASS: paid_base, paid_pro, founder, and active trial behavior remains valid.');
  } finally {
    await env.cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
