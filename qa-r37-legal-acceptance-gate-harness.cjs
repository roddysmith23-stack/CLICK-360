/**
 * r37 (Sections 17-20, adjusted after production-risk review): structural
 * companion to qa/r37-legal-acceptance-gate-e2e.mjs. That live-browser
 * test proves the full routing/UI/write-gate behavior end to end (except
 * the save()->Firestore round trip, which needs real Firebase auth the
 * offline harness cannot bootstrap). This harness proves the write path
 * itself is wired correctly: the accept flow persists a versioned record
 * with authUid/role context through the SAME canonical helper the
 * onboarding flow uses, the classification function distinguishes
 * brand-new owners (hard gate) from already-onboarded legacy owners
 * (dismissible grace banner, then a mutation-only gate), and neither
 * write path can ever deadlock against its own gate.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');
const domain = fs.readFileSync('v16-domain.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

assert(/const PRIVACY_VERSION = '\d{4}-\d{2}-\d{2}';/.test(domain), 'v16-domain.js must define PRIVACY_VERSION independently from TERMS_VERSION');
assert(/PRIVACY_VERSION,/.test(domain.slice(domain.indexOf('const api = Object.freeze'))), 'PRIVACY_VERSION must be exported on the public domain API');
assert(!domain.includes("'2026-07-13'"), 'no stale hardcoded 2026-07-13 fallback should remain in v16-domain.js');
assert(!app.includes("'2026-07-13'"), 'no stale hardcoded 2026-07-13 fallback should remain in app.js (must match the real current TERMS_VERSION)');

const hasAcceptedFn = app.slice(app.indexOf('function hasAcceptedCurrentLegalVersions('), app.indexOf('function legalGateEligible('));
assert(hasAcceptedFn.includes('entry.uid === uid'), 'hasAcceptedCurrentLegalVersions() must scope the read-back check to the current uid');
assert(hasAcceptedFn.includes('entry.termsVersion === termsVersion'), 'hasAcceptedCurrentLegalVersions() must require the CURRENT termsVersion to match -- a stale acceptance from an old version must not silently satisfy a new one');
assert(hasAcceptedFn.includes('privacyVersion'), 'hasAcceptedCurrentLegalVersions() must also check privacyVersion independently from termsVersion');

const statusFn = app.slice(app.indexOf('function legalAcceptanceStatus('), app.indexOf('function requiresLegalHardGate('));
assert(statusFn.includes("!state.settings?.onboarding?.completedAt) return 'hard_gate'"), 'a never-onboarded (brand new) owner must classify as hard_gate');
assert(statusFn.includes("!Number.isFinite(presentedAtMs)) return 'grace_unpresented'"), 'a legacy owner whose banner has never been shown must classify as grace_unpresented (not immediately hard-gated)');
assert(statusFn.includes('LEGAL_GRACE_MS'), 'the grace window must be a named, single-source constant, not a magic number scattered across checks');
assert(/const LEGAL_GRACE_MS = 7 \* 24 \* 60 \* 60 \* 1000;/.test(app), 'the grace window must be exactly 7 days');

const hardGateFn = app.slice(app.indexOf('function requiresLegalHardGate('), app.indexOf('function legalMutationGateActive('));
assert(hardGateFn.includes('tenantDataHydrated'), 'requiresLegalHardGate() must never fire before real tenant data is hydrated (UNKNOWN != FALSE -- do not gate on the empty seed state)');
assert(hardGateFn.includes("=== 'hard_gate'"), 'requiresLegalHardGate() must only route-block for the hard_gate classification -- grace/mutation_gate states must never route-block');

const mutationGateFn = app.slice(app.indexOf('function legalMutationGateActive('), app.indexOf('function persistLegalMetaLocal('));
assert(mutationGateFn.includes('tenantDataHydrated'), 'legalMutationGateActive() must never fire before real tenant data is hydrated');
assert(mutationGateFn.includes("=== 'mutation_gate'"), 'legalMutationGateActive() must only block writes for the mutation_gate classification, never for grace states');

const eligibleFn = app.slice(app.indexOf('function legalGateEligible('), app.indexOf('function legalAcceptanceStatus('));
assert(eligibleFn.includes('isOwnerUser()'), 'the legal gate must be scoped to owner accounts only (workers have their own future consent flow in the invite flow, not this gate)');
assert(eligibleFn.includes('click360IsPlatformAdmin'), 'the legal gate must exempt internal platform staff accounts (the gate is for commercial customers, not AIIA staff)');

const persistFn = app.slice(app.indexOf('function persistLegalMetaLocal('), app.indexOf('function persistLegalMetaLocal(') + 500);
assert(!persistFn.includes('writeGateStatus'), 'persistLegalMetaLocal() must bypass writeGateStatus() entirely (direct localStorage write) -- legal-compliance bookkeeping must never be blocked by the very gate it exists to satisfy (that would be an unrecoverable deadlock)');

const acceptFn = app.slice(app.indexOf('async function acceptLegalTerms('), app.indexOf('async function recordLegalGracePresented('));
assert(acceptFn.includes('persistLegalMetaLocal()'), 'acceptLegalTerms() must persist locally via the gate-bypassing helper, not save() (which would deadlock if called from mutation_gate status)');
assert(acceptFn.includes('window.click360SaveLegalAcceptance'), 'acceptLegalTerms() must persist through the SAME canonical click360SaveLegalAcceptance() helper the onboarding flow uses -- not a second, divergent write path');
assert(!acceptFn.includes('if (!save('), 'acceptLegalTerms() must not call save() -- that would route through writeGateStatus() and could deadlock during mutation_gate');

const presentFn = app.slice(app.indexOf('async function recordLegalGracePresented('), app.indexOf('function legalAcceptanceGateView('));
assert(presentFn.includes('persistLegalMetaLocal()'), 'recordLegalGracePresented() must persist locally via the gate-bypassing helper');
assert(presentFn.includes('window.click360SaveLegalGracePresented'), 'recordLegalGracePresented() must sync termsPresentedAt to the cloud so CEO Admin can compute grace status without hand-editing Firestore');
assert(presentFn.includes('existing.termsPresentedAt || nowIso'), 'termsPresentedAt must be write-once locally -- re-presenting the banner must never reset (extend) an already-running grace clock');

const bindGateFn = app.slice(app.indexOf('function bindLegalGate('), app.indexOf('function bindLegalGate(') + 900);
assert(bindGateFn.includes('acceptBtn.disabled = true'), 'the hard-gate accept button must disable itself immediately on click (anti-double-click)');
assert(bindGateFn.includes('acceptLegalTerms('), 'the hard gate must accept via the shared acceptLegalTerms() helper, not a duplicated inline implementation');

const bannerFn = app.slice(app.indexOf('function renderLegalGraceBannerModal('), app.indexOf('function renderLegalGraceBannerModal(') + 2500);
assert(bannerFn.includes('legalGraceAcceptBtn'), 'the grace banner must offer a "Revisar y aceptar" action');
assert(bannerFn.includes('legalGraceLaterBtn'), 'the grace banner must offer a "Recordarme después" dismiss action');
assert(bannerFn.includes("laterBtn.onclick = () => closeModal();"), '"Recordarme después" must simply dismiss the modal -- it must never block or force acceptance');
assert(bannerFn.includes('acceptLegalTerms('), 'the grace banner must accept via the shared acceptLegalTerms() helper');

const throttleFn = app.slice(app.indexOf('function maybeShowLegalGraceBanner('), app.indexOf('function maybeShowLegalGraceBanner(') + 900);
assert(throttleFn.includes('has-modal'), 'the banner must never stack on top of an already-open modal');
assert(throttleFn.includes('sessionStorage'), 'the banner must be throttled to at most once per session (in addition to the once-per-day check against lastShownAt)');
assert(throttleFn.includes('lastShownDate === todayKey'), 'the banner must be throttled to at most once per day across sessions, per the "no volver a mostrar en cada navegación" requirement');

const renderAppFn = app.slice(app.indexOf('function renderApp('), app.indexOf('function renderApp(') + 700);
assert(/r !== 'legal' && requiresLegalHardGate\(\)/.test(renderAppFn), 'renderApp() must exempt the #legal route itself from the hard gate -- otherwise reading the terms before accepting them is impossible');
assert(!/r !== 'legal' && requiresLegalHardGate\(\)[\s\S]{0,10}\|\|.*grace/.test(renderAppFn), 'renderApp() must NOT route-block for any grace/mutation_gate status -- only hard_gate may force a route change');

const writeGateFn = app.slice(app.indexOf('function writeGateStatus('), app.indexOf('function writeBlockMessage('));
assert(/if \(legalMutationGateActive\(\)\) return \{ allowed: false, reason: 'legal_acceptance_required' \};/.test(writeGateFn), 'writeGateStatus() must block on legalMutationGateActive() with a distinct, identifiable reason');
assert(writeGateFn.indexOf('legalMutationGateActive()') < writeGateFn.indexOf('click360WriteGate'), 'the legal mutation gate must be checked before any other write-gate reason, so its distinct reason is never masked by an unrelated block');

assert(app.includes("if (reason === 'legal_acceptance_required') return "), 'writeBlockMessage() must have a specific, human-readable message for the legal_acceptance_required reason, not the generic fallback');

assert(app.includes("id=\"onboardingMarketing\" type=\"checkbox\">"), 'onboarding must offer a marketing consent checkbox, kept SEPARATE and OPTIONAL from the required Terms/Privacy checkbox');
assert(!app.includes("id=\"onboardingMarketing\" type=\"checkbox\" required"), 'marketing consent must never be required -- it is optional by design, unlike the Terms/Privacy checkbox');
assert(app.includes('marketingConsent = { granted:'), 'marketing consent must be stored as its own field, never folded into legalAcceptances');

const acceptanceRuleBlock = rules.slice(rules.indexOf('match /legalAcceptances/'), rules.indexOf('match /legalAcceptances/') + 1400);
assert(acceptanceRuleBlock.includes('"locale"'), 'firestore.rules must require locale on every legalAcceptances write (matches click360SaveLegalAcceptance\'s payload)');
assert(acceptanceRuleBlock.includes('request.resource.data.uid == request.auth.uid'), 'firestore.rules must enforce that a legalAcceptances write can only ever be for the writer\'s own uid');
assert(acceptanceRuleBlock.includes('isPlatformAdmin()'), 'firestore.rules must let CEO Admin read legalAcceptances cross-tenant (isPlatformAdmin()) so legal status is visible without hand-editing Firestore');

const graceRuleBlock = rules.slice(rules.indexOf('match /legalGraceStatus/'), rules.indexOf('match /legalGraceStatus/') + 1600);
assert(graceRuleBlock.length > 100, 'firestore.rules must define a legalGraceStatus collection for CEO-Admin-visible grace tracking');
assert(graceRuleBlock.includes('isPlatformAdmin()'), 'legalGraceStatus must be readable by CEO Admin');
assert(graceRuleBlock.includes('request.resource.data.termsPresentedAt == resource.data.termsPresentedAt'), 'legalGraceStatus updates must enforce that termsPresentedAt is write-once server-side too (not just trusted client-side) -- otherwise a compromised/buggy client could reset a customer\'s grace clock indefinitely');
assert(graceRuleBlock.includes('allow delete: if false;'), 'legalGraceStatus records must never be deletable (compliance audit trail)');

console.log('PASS r37 legal acceptance-gate harness: hard-gate/grace/mutation-gate classification is correct and hydration-safe, both write paths (accept, present) bypass writeGateStatus() to avoid a self-deadlock, the write-gate blocks mutations (never routes) once grace expires, marketing consent stays separate and optional, and firestore.rules protects termsPresentedAt as write-once with CEO Admin read visibility');
