'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(process.env.CLICK360_BOOT_SOURCE || 'index.html', 'utf8');
const script = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(code => code.includes('hadServiceWorkerController'));
assert(script, 'actual controllerchange script must exist');
function harness() {
  const events = {}, timers = [], storage = new Map();
  let reloads = 0, modal = false;
  const state = {
    navigator: { serviceWorker: { controller: {}, addEventListener: (type, fn) => { events[type] = fn; } } },
    document: { getElementById: () => ({}), body: { classList: { contains: () => modal } } },
    location: { hash: '#home', reload: () => { reloads++; } },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: fn => { timers.push(fn); }, click360SyncStatus: { status: 'syncing' },
  };
  state.window = state;
  vm.createContext(state); vm.runInContext(script, state);
  return { state, fire: () => events.controllerchange(), tick: () => timers.shift()?.(),
    modal: value => { modal = value; }, reloads: () => reloads };
}
for (const [name, change, expected] of [
  ['deferred checkout navigation', h => { h.state.location.hash = '#sell'; }, 0],
  ['deferred product dialog', h => h.modal(true), 0],
  ['safe idle home', () => {}, 1],
]) {
  const h = harness(); h.fire(); change(h); h.state.click360SyncStatus.status = 'synced';
  h.tick(); h.tick();
  assert.equal(h.reloads(), expected, name);
}
for (const [name, change] of [
  ['checkout opened during final 900ms', h => { h.state.location.hash = '#sell'; }],
  ['sync restarted during final 900ms', h => { h.state.click360SyncStatus.status = 'syncing'; }],
  ['dialog opened during final 900ms', h => h.modal(true)],
]) {
  const h = harness(); h.state.click360SyncStatus.status = 'synced'; h.fire(); change(h); h.tick();
  assert.equal(h.reloads(), 0, name);
}
const busy = harness(); busy.fire(); for (let index = 0; index < 15; index++) busy.tick();
assert.equal(busy.reloads(), 0, 'permanent sync is bounded and never reloads');
const once = harness(); once.state.click360SyncStatus.status = 'synced'; once.fire(); once.tick(); once.fire(); once.tick();
assert.equal(once.reloads(), 1, 'at most one heal per session');
console.log('PASS r38 safe update: 8 real-controller-handler timing/navigation/modal scenarios.');
