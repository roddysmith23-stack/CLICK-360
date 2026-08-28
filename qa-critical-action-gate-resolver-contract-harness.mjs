// FIX #3 deterministic contract test. Extracts the EXACT real source of
// resolveCriticalActionGate() / createLocalOperationGateFallback() straight
// out of app.js (not a reimplementation -- same extraction technique
// qa/extract-print-handoff.cjs already uses for the print pipeline) and
// asserts, in plain Node with no browser needed:
//  - normal case: real domain present -> resolves to a gate built by
//    window.CLICK360_V16_DOMAIN.createOperationGate() (not the fallback).
//  - load-failure case: domain absent -> resolves to the local fallback,
//    which preserves the REAL dedup contract (a second begin() with the
//    same in-flight key is correctly rejected, not silently allowed --
//    this is the concrete proof FIX #3 does not weaken anything: the gate
//    still does its one real job, it just no longer depends on
//    v16-domain.js to exist at all).
//  - upgrade case: fallback engaged, size()===0, domain becomes available
//    later -> next resolution call upgrades to the real gate. If an
//    operation is still in flight (size()>0), it must NOT swap mid-flight.
//  - null/missing must never mean "allowed": begin() on a released/absent
//    key still requires an explicit acquire; there is no code path here
//    that returns acquired:true without a real Map entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = app.indexOf(marker);
  if (start < 0) throw new Error(`extractFunction: could not find "${marker}" in app.js`);
  let stmtStart = start;
  while (stmtStart > 0 && !/\n/.test(app[stmtStart - 1])) stmtStart -= 1;
  const parenOpen = app.indexOf('(', start);
  let parenDepth = 0, parenClose = -1;
  for (let i = parenOpen; i < app.length; i += 1) {
    if (app[i] === '(') parenDepth += 1;
    else if (app[i] === ')') { parenDepth -= 1; if (parenDepth === 0) { parenClose = i; break; } }
  }
  if (parenClose < 0) throw new Error(`extractFunction: unbalanced parens for ${name}`);
  const braceOpen = app.indexOf('{', parenClose);
  let depth = 0, i = braceOpen;
  for (; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    else if (app[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error(`extractFunction: unbalanced braces for ${name}`);
  return app.slice(stmtStart, i + 1).trim();
}

assert.ok(app.includes('let resolvedCriticalActionGate = null;'), 'expected declaration present in app.js (source drifted?)');
assert.ok(app.includes('let criticalActionGateIsFallback = false;'), 'expected declaration present in app.js (source drifted?)');

const bundleSource = [
  "let resolvedCriticalActionGate = null;",
  "let criticalActionGateIsFallback = false;",
  extractFunction('createLocalOperationGateFallback'),
  extractFunction('resolveCriticalActionGate'),
  "return { resolveCriticalActionGate, reset() { resolvedCriticalActionGate = null; criticalActionGateIsFallback = false; }, isFallback() { return criticalActionGateIsFallback; } };"
].join('\n\n');

// eslint-disable-next-line no-new-func -- deliberately evaluating the real,
// verbatim extracted app.js source (not a reimplementation); see file header.
// No 'window' parameter here on purpose: references to `window` inside the
// extracted code must resolve to globalThis.window, which withDomain() sets
// per-test below -- that's how each case controls domain availability.
const factory = new Function(bundleSource);
const { resolveCriticalActionGate, reset, isFallback } = factory();

function withDomain(domain, fn) {
  const previous = globalThis.window;
  globalThis.window = { CLICK360_V16_DOMAIN: domain };
  try { return fn(); } finally { globalThis.window = previous; }
}

// --- Case A: normal, domain present from the start ---
reset();
withDomain({ createOperationGate: () => realGate() }, () => {
  const gate = resolveCriticalActionGate();
  assert.equal(isFallback(), false, 'Case A: must resolve to the real domain gate, not the fallback');
  const entry = gate.begin('tenant:product_saved', { x: 1 });
  assert.equal(entry.acquired, true, 'Case A: first acquire on a free key must succeed');
  gate.end('tenant:product_saved', entry.token);
});
console.log('Case A (normal load resolves to real gate): PASS');

function realGate() {
  const inFlight = new Map();
  return {
    begin(key, snapshot = null) {
      const k = String(key || ''); if (!k) return { acquired: false, snapshot: null, token: null };
      const cur = inFlight.get(k); if (cur) return { acquired: false, snapshot: cur.snapshot, token: null };
      const token = Symbol(k); inFlight.set(k, { token, snapshot }); return { acquired: true, snapshot, token };
    },
    end(key, token) {
      const k = String(key || ''); const cur = inFlight.get(k);
      if (!cur || cur.token !== token) return false;
      inFlight.delete(k); return true;
    },
    clear() { inFlight.clear(); },
    size() { return inFlight.size; }
  };
}

// --- Case B: domain genuinely absent -> local fallback, real dedup preserved ---
reset();
withDomain({}, () => {
  const gate = resolveCriticalActionGate();
  assert.equal(isFallback(), true, 'Case B: domain absent must resolve to the local fallback');
  const first = gate.begin('tenant:product_saved', { snap: 1 });
  assert.equal(first.acquired, true, 'Case B: first acquire on a free key must succeed (this is the exact write path that used to be permanently blocked)');
  // A concurrent second acquire attempt on the SAME key, before release,
  // must be correctly rejected as a real duplicate -- proves the fallback
  // still performs its one real job, not just "always allow".
  const secondWhileHeld = gate.begin('tenant:product_saved', { snap: 2 });
  assert.equal(secondWhileHeld.acquired, false, 'Case B: a genuine concurrent duplicate on the same key must still be rejected');
  assert.deepEqual(secondWhileHeld.snapshot, { snap: 1 }, 'Case B: duplicate rejection must return the ORIGINAL in-flight snapshot');
  // Release, then re-acquire must succeed -- the gate must never be
  // permanently "stuck" after a legitimate release.
  gate.end('tenant:product_saved', first.token);
  const afterRelease = gate.begin('tenant:product_saved', { snap: 3 });
  assert.equal(afterRelease.acquired, true, 'Case B: acquiring again after a real release must succeed (never permanently stuck)');
  gate.end('tenant:product_saved', afterRelease.token);
});
console.log('Case B (load-failure fallback preserves real dedup contract): PASS');

// --- Never allowed without a real acquire: empty/missing key ---
reset();
withDomain({}, () => {
  const gate = resolveCriticalActionGate();
  const empty = gate.begin('', { snap: 1 });
  assert.equal(empty.acquired, false, 'an empty/missing key must never be treated as acquired');
});
console.log('Never-allow-without-real-acquire (empty key): PASS');

// --- Case C: domain becomes available later, only swaps when idle ---
reset();
let domainRef = {}; // starts absent
withDomain(domainRef, () => {
  const gate1 = resolveCriticalActionGate();
  assert.equal(isFallback(), true, 'precondition: starts on fallback');
  const held = gate1.begin('tenant:product_saved', { snap: 'in-flight' });
  assert.equal(held.acquired, true);
  // Domain becomes available WHILE something is still in flight on the fallback.
  domainRef.createOperationGate = () => realGate();
  const gateWhileBusy = resolveCriticalActionGate();
  assert.equal(isFallback(), true, 'must NOT swap to the real gate while an operation is still in flight on the fallback (would silently lose tracking)');
  gate1.end('tenant:product_saved', held.token);
  // Now idle (size===0) -- next resolution must upgrade.
  const gateNowIdle = resolveCriticalActionGate();
  assert.equal(isFallback(), false, 'must upgrade to the real domain gate once the fallback is idle');
  const entry = gateNowIdle.begin('tenant:product_saved', { snap: 'post-upgrade' });
  assert.equal(entry.acquired, true, 'the upgraded real gate must work correctly for a fresh operation');
});
console.log('Case C (upgrades to real gate only once idle, never mid-flight): PASS');

// --- Case D: 150 cheap cycles mixing normal load / fallback load-failure,
// each a fresh "session" (reset()), asserting zero unauthorized allows and
// zero permanently-stuck gates across the whole run. ---
const CYCLES = 150;
let falseAllowCount = 0;
let stuckGateCount = 0;
for (let i = 0; i < CYCLES; i += 1) {
  reset();
  const domainPresent = i % 2 === 0;
  withDomain(domainPresent ? { createOperationGate: () => realGate() } : {}, () => {
    const gate = resolveCriticalActionGate();
    if (isFallback() === domainPresent) throw new Error(`cycle ${i}: gate resolution disagreed with domain availability`);
    const key = `tenant:product_saved:${i}`;
    const first = gate.begin(key, { i });
    assert.equal(first.acquired, true, `cycle ${i}: first acquire on a free key must succeed`);
    const duplicate = gate.begin(key, { i, dup: true });
    if (duplicate.acquired) falseAllowCount += 1;
    gate.end(key, first.token);
    const afterRelease = gate.begin(key, { i, again: true });
    if (!afterRelease.acquired) stuckGateCount += 1;
    else gate.end(key, afterRelease.token);
  });
}
assert.equal(falseAllowCount, 0, `${falseAllowCount} cycles allowed a genuine concurrent duplicate (false allow)`);
assert.equal(stuckGateCount, 0, `${stuckGateCount} cycles left the gate permanently stuck after a real release`);
console.log(`Case D (${CYCLES} cycles, mixed normal/fallback): PASS -- falseAllowCount=0 stuckGateCount=0`);

console.log('qa-critical-action-gate-resolver-contract-harness: PASS');
