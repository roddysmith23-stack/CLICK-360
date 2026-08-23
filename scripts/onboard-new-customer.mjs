/**
 * CEO Admin: guided end-to-end new-customer onboarding (Commercial MVP
 * Section 10). Wraps admin-access-v16.mjs -- the same audited backup ->
 * transaction -> verify -> audit-log pipeline already used for every
 * activation -- with a human-readable preview so a non-technical operator
 * can see exactly what a customer will receive before confirming, without
 * ever touching Firestore by hand.
 *
 * Real precondition this flow cannot skip: CLICK 360 authenticates only via
 * Google Sign-In (no admin-created passwords). A brand-new customer must
 * sign in once themselves -- which creates their Firebase Auth user and a
 * 'pending'/trial accountAccess record automatically -- before an admin can
 * activate a paid plan for them. If that hasn't happened yet, this script
 * says so plainly instead of failing with a raw "user not found" error.
 * Once they've signed in, they also complete CLICK 360's own client-side
 * onboarding form (business name, type, currency, timezone) on first
 * approved login -- this script does not duplicate that step, only the
 * commercial activation (plan/limits/entitlements) an admin controls.
 *
 * Business type here is a UX preset only, recorded for the sales record; it
 * never grants or restricts rights -- the plan is the only thing that does.
 * Add-ons are recorded as requested capacity/notes, not priced -- see
 * Section 8: no approved add-on price exists yet, so nothing is invented.
 *
 * Usage:
 *   node scripts/onboard-new-customer.mjs \
 *     --actor roddysmithceo@gmail.com --email new.customer@gmail.com \
 *     --plan pro --period year --business-type retail --addons "extra storage"
 *   # review the printed preview + PLAN, then re-run with --apply --confirm=<printed phrase>
 */
import { execFileSync } from 'node:child_process';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { REQUIRED_PROJECT_ID, normalizeEmail } from './lib/click360-v16-admin-core.mjs';

const BUSINESS_TYPE_LABELS = {
  retail: 'Retail / comercio',
  restaurant: 'Restaurante',
  distribution: 'Distribucion',
  services: 'Servicios',
  other: 'Otro'
};

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
const projectId = String(args.project || REQUIRED_PROJECT_ID);
const actorEmail = normalizeEmail(args.actor);
const customerEmail = normalizeEmail(args.email);
const plan = String(args.plan || 'base').toLowerCase();
const period = String(args.period || (plan === 'founder_legacy' ? 'historical' : 'year')).toLowerCase();
const businessType = String(args['business-type'] || '').toLowerCase();
const addOns = String(args.addons || '');
const apply = args.apply === true;

if (!actorEmail) throw new Error('--actor is required.');
if (!customerEmail) throw new Error('--email is required (the customer\'s Google account email).');
if (businessType && !BUSINESS_TYPE_LABELS[businessType]) {
  throw new Error(`--business-type must be one of: ${Object.keys(BUSINESS_TYPE_LABELS).join(', ')}`);
}

const app = initializeApp({ credential: applicationDefault(), projectId }, `onboard-customer-${Date.now()}`);
const auth = getAuth(app);

let authUser;
try {
  authUser = await auth.getUserByEmail(customerEmail);
} catch (error) {
  if (error.code === 'auth/user-not-found') {
    console.log(JSON.stringify({
      result: 'BLOCKED_CUSTOMER_HAS_NOT_SIGNED_IN',
      message: `${customerEmail} has no Firebase Auth account yet. CLICK 360 authenticates only via Google Sign-In -- ask the customer to open the app and sign in with this exact Google account once (they will land in the 7-day trial / pending state automatically), then re-run this command.`
    }, null, 2));
    process.exit(1);
  }
  throw error;
}

const inspectArgs = [
  'scripts/admin-access-v16.mjs',
  '--command', 'inspect',
  '--project', projectId,
  '--actor', actorEmail,
  '--email', customerEmail,
  '--uid', authUser.uid
];
const inspection = JSON.parse(execFileSync('node', inspectArgs, { encoding: 'utf8' }));

const activateArgs = [
  'scripts/admin-access-v16.mjs',
  '--command', 'activate',
  '--project', projectId,
  '--actor', actorEmail,
  '--email', customerEmail,
  '--uid', authUser.uid,
  '--plan', plan,
  '--period', period
];
if (businessType) activateArgs.push('--business-type', businessType);
if (addOns) activateArgs.push('--addons', addOns);

const dryRun = JSON.parse(execFileSync('node', activateArgs, { encoding: 'utf8' }));
const proposed = dryRun.proposed;
const limits = { businesses: proposed.businessLimit, workers: proposed.workerLimit };

const preview = {
  step: 'PREVIEW',
  customer: { email: customerEmail, uid: authUser.uid, currentStatus: inspection.accountAccess?.status || 'none (new customer)' },
  businessType: businessType ? BUSINESS_TYPE_LABELS[businessType] : 'not set (customer chooses on first login)',
  plan: { name: proposed.plan, status: proposed.status, period: proposed.activationPeriod },
  addOnsRequested: proposed.onboardingProfile?.addOnsRequested?.length ? proposed.onboardingProfile.addOnsRequested : 'none',
  whatTheCustomerReceives: {
    negociosPermitidos: limits.businesses,
    cuposDeWorkersIncluidos: 2,
    cuposDeWorkersMaximos: limits.workers,
    nota: 'Productos activos y almacenamiento se rigen por PLAN_CATALOG en v16-domain.js; ver Mi plan y acceso del cliente tras activar.'
  },
  requiredConfirmationToApply: dryRun.requiredConfirmation,
  requiredExpectedBeforeHash: inspection.accountAccess?.beforeHash
};

if (!apply) {
  console.log(JSON.stringify(preview, null, 2));
  console.log('\nTo apply, re-run with --apply and the confirmation shown above, e.g.:');
  console.log(`  node scripts/onboard-new-customer.mjs --actor ${actorEmail} --email ${customerEmail} --plan ${plan} --period ${period}${businessType ? ` --business-type ${businessType}` : ''}${addOns ? ` --addons "${addOns}"` : ''} --apply --confirm "${dryRun.requiredConfirmation}"`);
  process.exit(0);
}

if (String(args.confirm || '') !== dryRun.requiredConfirmation) {
  throw new Error(`Confirmation mismatch. Run without --apply first to see the current required phrase (it is tied to a fresh backup hash and expires the moment accountAccess changes).`);
}

const finalActivateArgs = [...activateArgs, '--apply', '--confirm', dryRun.requiredConfirmation, '--expected-before-hash', inspection.accountAccess.beforeHash];
const result = JSON.parse(execFileSync('node', finalActivateArgs, { encoding: 'utf8' }));
console.log(JSON.stringify({ ...preview, step: 'APPLIED', result: result.result, backupPath: result.backupPath, auditPath: result.auditPath }, null, 2));
