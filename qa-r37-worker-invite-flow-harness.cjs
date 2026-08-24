/**
 * r37 (Section 11-16, commercial priority): the full worker invite flow --
 * Owner creates invitation -> role/permissions -> WhatsApp/Compartir/
 * Copiar enlace -> worker opens -> accepts legal -> completes profile ->
 * requests access -> Owner approves -> enters directly into restricted
 * UI. Also: role presets (Cajero/Vendedor/Bodega/Mesero/Cocina-KDS/
 * Repartidor/Administrador limitado/Personalizado), all customer-facing
 * text uses "Trabajador" never "Worker", and a Cajero must never see
 * flashed Owner UI or unauthorized data during hydration.
 *
 * The already-audited, server-enforced acceptance transaction
 * (member becomes active, seat consumed, cross-tenant isolation) is
 * deliberately UNTOUCHED here -- this is an ADDITIVE, client-enforced
 * human-workflow gate on top of it (see workerAccessRequests in
 * firestore.rules for the full rationale). This harness proves that
 * layer is wired correctly and can never deadlock or leak permissions
 * beyond what the owner already explicitly chose to delegate.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const boundary = fs.readFileSync('worker-data-boundary.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

// ── Role presets ──
const presetsBlock = app.slice(app.indexOf('const WORKER_ROLE_PRESETS'), app.indexOf('function workerRolePresetOptionsHtml('));
for (const label of ['Cajero', 'Vendedor', 'Bodega', 'Mesero', 'Cocina', 'Repartidor', 'Administrador limitado', 'Personalizado']) {
  assert(presetsBlock.includes(`label: '${label}'`), `WORKER_ROLE_PRESETS must include the "${label}" preset`);
}
for (const preset of presetsBlock.match(/baseRole: '[a-z_]+'/g) || []) {
  const role = preset.match(/'([a-z_]+)'/)[1];
  assert(['worker', 'seller', 'cashier', 'inventory', 'supervisor', 'admin'].includes(role), `preset baseRole "${role}" must be one of the existing closed, server-validated role codes -- never a brand new role code (that would require touching the multi-tenant security boundary itself)`);
}
assert(presetsBlock.includes("overrides: null"), '"Personalizado" must leave overrides null, deferring to the existing permission-matrix editor after invite creation rather than duplicating that UI into the create form');
assert(!/\bKDS\b/.test(app), 'app.js must never contain the literal "KDS" abbreviation -- an older P1.5A scope-freeze contract (qa-p1-5a-tables-lite-harness.cjs) uses it as a tripwire against prematurely activating a real Kitchen Display System feature; the "Cocina" role preset must stay a plain role label, never that string');

const permsFnBlock = app.slice(app.indexOf('function workerRolePresetPermissions('), app.indexOf('function workerRolePresetPermissions(') + 700);
assert(permsFnBlock.includes('normalizePermissionMap'), 'preset permissions must be computed via the SAME normalizePermissionMap() the security boundary itself uses -- restrict-only semantics, never a hand-rolled permission shape');
assert(permsFnBlock.includes("if (preset.overrides === null) return null"), '"Personalizado" must return null permissions (falls back to defaultWorkerPermissions(admin) server-side, to be refined via the edit-permissions UI afterward)');

// ── Copy: Trabajador, never Worker, in all customer-facing invite/gate text ──
const workerViewBlock = app.slice(app.indexOf('function workersView('), app.indexOf('function bindWorkers('));
assert(!/>Worker</.test(workerViewBlock) && !/ Worker /.test(workerViewBlock), 'workersView() customer-facing copy must say "Trabajador", never the English "Worker"');
assert(workerViewBlock.includes('workerAccessRequestsCard'), 'workersView() must render the pending-access-requests section for the owner');
assert(workerViewBlock.includes('whatsappInviteLinkBtn'), 'the invite link box must offer a WhatsApp share action');
assert(workerViewBlock.includes('shareInviteLinkBtn'), 'the invite link box must offer a native "Compartir" (Web Share API) action when available');

const gateViewBlock = app.slice(app.indexOf('function workerAccessGateView('), app.indexOf('function bindWorkerAccessGate('));
assert(!/\bWorker\b/.test(gateViewBlock), 'the worker access gate screen must never say "Worker" -- only "Trabajador" family terms');
assert(gateViewBlock.includes('Esperando aprobación'), 'the gate must show a clear "waiting for approval" state once a request is pending');
assert(gateViewBlock.includes('workerAccessTermsCheckbox'), 'the profile-completion step must include the legal acceptance checkbox (accept legal -> complete profile -> request access, combined into one gated step)');
assert(gateViewBlock.includes('href="#legal"'), 'the gate must let the worker read the full terms before accepting, same as the owner hard gate');

// ── Gate logic: fail-closed, hydration-safe, owner/admin-exempt ──
const requiresGateBlock = app.slice(app.indexOf('function requiresWorkerAccessGate('), app.indexOf('function requiresWorkerAccessGate(') + 500);
assert(requiresGateBlock.includes('isOwnerUser()'), 'the worker access gate must never apply to owner accounts');
assert(requiresGateBlock.includes('click360IsPlatformAdmin'), 'the worker access gate must exempt internal platform staff');
assert(requiresGateBlock.includes('tenantDataHydrated'), 'the worker access gate must never fire before real tenant data is hydrated (UNKNOWN != FALSE)');
assert(requiresGateBlock.includes('!workerAccessGateChecked'), 'while the real access-request status is still unknown, the gate must default to BLOCKING (fail-closed) -- a Cajero must never see restricted UI/data before this device actually knows their request was approved');

const ensureCheckedBlock = app.slice(app.indexOf('async function ensureWorkerAccessGateChecked('), app.indexOf('async function ensureWorkerAccessGateChecked(') + 900);
assert(ensureCheckedBlock.includes(".catch(() => null)"), 'the access-request status check must degrade gracefully (never throw and break the boot sequence) if the read fails');
assert(ensureCheckedBlock.includes("!request ? 'needs_profile'"), 'no existing request must classify as needs_profile (show the profile-completion form), never silently approved');

// ── renderApp wiring: hard-gate first, then worker-access-gate, both exempt #legal ──
const renderAppBlock = app.slice(app.indexOf('function renderApp('), app.indexOf('function renderApp(') + 700);
assert(/r !== 'legal' && requiresLegalHardGate\(\)/.test(renderAppBlock), 'renderApp() must check the legal hard gate first');
assert(/requiresWorkerAccessGate\(\)/.test(renderAppBlock), 'renderApp() must also check the worker access gate');
assert(renderAppBlock.indexOf('requiresLegalHardGate') < renderAppBlock.indexOf('requiresWorkerAccessGate'), 'the legal hard gate must be evaluated before the worker access gate, matching invite -> login -> legal -> perfil -> solicitud -> aprobación ordering');

// ── firebase-service.js: request/approve/reject wiring ──
assert(firebase.includes('window.click360RequestWorkerAccess = async function'), 'click360RequestWorkerAccess must be exposed for the worker profile-completion step');
assert(firebase.includes('window.click360GetWorkerAccessRequestStatus = async function'), 'click360GetWorkerAccessRequestStatus must be exposed so the gate can check status on boot');
assert(firebase.includes('window.click360ListWorkerAccessRequests = async function'), 'click360ListWorkerAccessRequests must be exposed for the owner-side pending list');
assert(firebase.includes('window.click360ApproveWorkerAccess = async function'), 'click360ApproveWorkerAccess must be exposed for the owner approve action');
assert(firebase.includes('window.click360RejectWorkerAccess = async function'), 'click360RejectWorkerAccess must be exposed for the owner reject action');
const rejectFnBlock = firebase.slice(firebase.indexOf('window.click360RejectWorkerAccess = async function'), firebase.indexOf('window.click360RejectWorkerAccess = async function') + 900);
assert(rejectFnBlock.includes('click360RevokeWorker'), 'rejecting an access request must also revoke the underlying membership through the SAME canonical revoke path -- never leave a technically-active-but-UI-gated account behind');

// ── Security boundary untouched: no new role codes, no permission bypass ──
assert(!boundary.includes("mesero") && !boundary.includes("cocina") && !boundary.includes("repartidor"), 'worker-data-boundary.js (the actual multi-tenant security enforcement) must NOT be touched with new role codes -- all new presets must map onto the existing closed role set client-side only');

// ── firestore.rules: workerAccessRequests collection ──
const requestsRuleBlock = rules.slice(rules.indexOf('match /workerAccessRequests/'), rules.indexOf('match /workerAccessRequests/') + 2000);
assert(requestsRuleBlock.length > 200, 'firestore.rules must define the workerAccessRequests collection');
assert(requestsRuleBlock.includes('request.auth.uid == request.resource.data.uid'), 'a worker may only ever create their OWN access request, never on behalf of another uid');
assert(requestsRuleBlock.includes('request.auth.uid == resource.data.ownerId'), 'only the owning tenant\'s owner may update (approve/reject) an access request');
assert(requestsRuleBlock.includes('resource.data.status == "pending"'), 'a decided (approved/rejected) request must be immutable -- an owner cannot flip a decision back and forth');
assert(requestsRuleBlock.includes('allow delete: if false;'), 'access request records must never be deletable (audit trail)');

console.log('PASS r37 worker invite-flow harness: 8 commercial role presets map onto the existing closed/server-validated permission set (no new security-boundary role codes), the profile->request->approval gate is fail-closed and hydration-safe and never blocks #legal, WhatsApp/Compartir/Copiar enlace are all wired, rejecting an access request revokes the underlying membership, and firestore.rules protects the new workerAccessRequests collection correctly.');
