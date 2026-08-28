/**
 * r37 (#91, commercial priority): configurable inactivity mode -- ONLY for
 * a shared/POS-terminal device (3/5/10/15 min), NEVER for a personal
 * device; must never abandon a draft (a sell cart with items) or a
 * pending/in-flight critical operation.
 *
 * This is deliberately a per-DEVICE (localStorage), not per-tenant
 * (Firestore/state) setting -- the same business can have a personal phone
 * and a shared counter tablet at once, and a tenant-wide setting could
 * silently log every owner off their own phone on deploy day. Defaulting
 * every device to 'personal' means this feature is a pure no-op for 100%
 * of existing sessions until an owner explicitly opts a specific device in
 * from Ajustes.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

// ── Per-device, not per-tenant: localStorage only, safe default ──
const modeBlock = app.slice(app.indexOf("const DEVICE_MODE_KEY"), app.indexOf('window.CLICK360_DEVICE_MODE = Object.freeze'));
assert(modeBlock.includes("localStorage.getItem(DEVICE_MODE_KEY)"), 'device mode must live in localStorage (per-device), never in tenant state/Firestore (which would apply to every device on the account)');
assert(/return\s+.*===\s*'shared_terminal'\s*\?\s*'shared_terminal'\s*:\s*'personal'/.test(modeBlock), 'device mode must default to "personal" for any unset/unrecognized value -- a new/blank device must never come up pre-armed to auto-logout');
assert(modeBlock.includes('DEVICE_INACTIVITY_ALLOWED_MINUTES = Object.freeze([3, 5, 10, 15])'), 'the only allowed inactivity timeouts must be exactly 3/5/10/15 minutes, matching the commercial spec');

// ── Never abandon a draft or a pending critical operation ──
assert(modeBlock.includes('function hasActiveDraftOrPendingOperation()'), 'a draft/pending-operation check must exist');
// FIX #3 (SHARY P0 recovery, 2026-08-28) changed the static `criticalActionGate`
// module-load capture to a lazily-resolved `resolveCriticalActionGate()` call
// (so a v16-domain.js load failure degrades gracefully instead of blocking
// every save) -- the literal source shape here changed accordingly. The real
// invariant this regex checks (an in-flight critical mutation must count as
// "do not log out yet") is unchanged and still enforced.
assert(/resolveCriticalActionGate\(\)\?\.size\?\.\(\)\s*\|\|\s*0\)\s*>\s*0\)\s*return true/.test(modeBlock), 'any in-flight critical mutation (criticalActionGate) must count as "do not log out yet"');
assert(/click360SellCartCount\?\.\(\)\s*\|\|\s*0\)\s*>\s*0\)\s*return true/.test(modeBlock), 'a non-empty sell cart (an in-progress sale draft) must count as "do not log out yet"');

const scheduleBlock = app.slice(app.indexOf('function scheduleInactivityCheck()'), app.indexOf('function scheduleInactivityCheck()') + 900);
assert(scheduleBlock.includes("if (deviceMode() !== 'shared_terminal' || !currentUser()) return;"), 'scheduleInactivityCheck must be a complete no-op on a personal device -- not just "never fires the logout", but never even arms a timer');
assert(/if \(hasActiveDraftOrPendingOperation\(\)\) \{\s*\/\/[\s\S]*?scheduleInactivityCheck\(\);\s*return;\s*\}/.test(scheduleBlock), 'when a draft/pending operation exists at the moment of firing, the check must DEFER (reschedule) instead of logging out -- the draft must never be silently discarded');
assert(scheduleBlock.includes('window.click360Logout?.();'), 'once genuinely idle with no draft/pending operation, the device must log out through the real, existing logout path (never a bespoke half-implemented teardown)');

// ── Activity resets the timer, but is throttled (mousemove floods must not busy-loop clearTimeout/setTimeout every frame) ──
assert(app.includes('function registerDeviceActivity()'), 'user activity must reset the idle timer');
assert(/now - inactivityLastActivityAtMs < 1000\) return/.test(app), 'activity handling must be throttled -- an unthrottled mousemove listener would thrash clearTimeout/setTimeout continuously');
assert(/\['click', 'keydown', 'touchstart', 'mousemove', 'scroll'\]/.test(app), 'the activity watch must listen for a broad set of real interaction signals, not just clicks (a cashier reading the screen while scrolling is still "active")');

// ── Wired into renderApp() so it starts as soon as a session exists, and into Settings so an owner can actually turn it on ──
const renderAppTailBlock = app.slice(app.indexOf("if (r !== 'legalGate') setTimeout(maybeShowLegalGraceBanner, 0);"), app.indexOf('markAppReady(`route:${r}`)') + 30);
assert(renderAppTailBlock.includes('startInactivityWatch();'), 'renderApp() must start the inactivity watch on every render (idempotent -- only truly arms once, and only for shared_terminal devices)');
assert(app.includes("$('#deviceModeSelect')"), 'Settings must expose a "Este dispositivo" device-mode selector');
assert(app.includes("$('#deviceInactivityMinutesSelect')"), 'Settings must expose the 3/5/10/15 minute selector');
assert(/deviceInactivityMinutesField[\s\S]{0,200}style\.display = currentMode === 'shared_terminal' \? '' : 'none'/.test(app), 'the minutes selector must only be visible when shared_terminal mode is actually selected -- never dangling/confusing on a personal device');

// A testing-only seam for the E2E harness, verified to never affect the
// real per-minute multiplier by default (60000 = a real minute).
assert(app.includes('let inactivityMsPerMinuteForTesting = 60000;'), 'the real, production per-minute multiplier must be a real minute (60000ms) by default');

console.log('PASS r37 inactivity-mode harness: device mode is a per-device (localStorage, never tenant-wide) setting defaulting to "personal" (a pure no-op until an owner explicitly opts a device in), the 3/5/10/15 minute options match spec, the idle check never fires while a sell-cart draft or an in-flight critical mutation exists (defers instead of discarding it), activity handling is throttled, and Settings exposes the device-mode + minutes controls correctly.');
