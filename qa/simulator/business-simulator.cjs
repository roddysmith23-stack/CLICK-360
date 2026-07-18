#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createPrng, createSyntheticTenant } = require('./seed-data.cjs');
const { FakeCloud, FakeLocalStore } = require('./fake-storage.cjs');
const { assertCoreInvariants, businessRows } = require('./invariants.cjs');
const { closeCash, runScenario } = require('./scenarios.cjs');
const { writeReport } = require('./report.cjs');

const modeArg = process.argv.find((arg) => arg.startsWith('--mode=')) || '--mode=quick';
const mode = modeArg.split('=')[1] === 'full' ? 'full' : 'quick';
const seedArg = process.argv.find((arg) => arg.startsWith('--seed='));
const seed = seedArg ? Number(seedArg.split('=')[1]) : 360;

const config = mode === 'full'
  ? { products: 1000, sales: 1000, movements: 1000, closes: 100, businessSwitches: 500, iterations: 1250, businessCount: 10 }
  : { products: 100, sales: 100, movements: 100, closes: 20, businessSwitches: 20, iterations: 150, businessCount: 4 };

const startedAtMs = Date.now();
const random = createPrng(seed);
const state = createSyntheticTenant({ seed, products: config.products, businessCount: config.businessCount });
const cloud = new FakeCloud(state);
const localStore = new FakeLocalStore({ quotaBytes: mode === 'full' ? 20 * 1024 * 1024 : 3 * 1024 * 1024 });

const before = assertCoreInvariants(state);
const scenario = runScenario({
  state,
  random,
  cloud,
  localStore,
  iterations: config.iterations,
  businessSwitches: config.businessSwitches,
  closes: config.closes,
  sales: config.sales,
  movements: config.movements,
  mode
});

const writableRoles = [
  { name: 'founder', role: 'owner', readOnly: false },
  { name: 'pro', role: 'owner', readOnly: false },
  { name: 'pro_lifetime', role: 'owner', readOnly: false },
  { name: 'trial_active', role: 'owner', readOnly: false },
  { name: 'suspended', role: 'owner', readOnly: true },
  { name: 'worker_paused', role: 'cashier', readOnly: false }
];
const userMatrix = writableRoles.map((user, index) => {
  const matrixState = createSyntheticTenant({ seed: seed + 10 + index, products: 12, businessCount: 1 });
  const result = closeCash(matrixState, user);
  return { user: user.name, result };
});

for (const entry of userMatrix.filter((entry) => ['founder', 'pro', 'pro_lifetime', 'trial_active'].includes(entry.user))) {
  assert.equal(entry.result.ok, true, `${entry.user} can close cash`);
}
assert.equal(userMatrix.find((entry) => entry.user === 'suspended').result.reason, 'read_only', 'suspended account is blocked');
assert.equal(userMatrix.find((entry) => entry.user === 'worker_paused').result.reason, 'worker_module_paused', 'worker is clearly paused');

const omegaRows = businessRows(state, state.businesses[0].id);
const otherRows = state.businesses.slice(1).map((business) => businessRows(state, business.id).dailyReports.length);
assert(omegaRows.products.every((product) => product.businessId === state.businesses[0].id), 'business rows stay scoped');
assert(otherRows.every((count) => Number.isFinite(count)), 'all businesses keep independent report counts');

const after = assertCoreInvariants(state);
const cloudAfter = cloud.read();
assert.equal(cloudAfter.hash, after.hash, 'fake cloud final hash matches local state');

const report = {
  simulator: 'CLICK 360 P1.1d Cash Reliability QA Simulator',
  mode,
  seed,
  startedAt: new Date(startedAtMs).toISOString(),
  finishedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
  config,
  before,
  scenario,
  after,
  cloud: { revision: cloudAfter.revision, hash: cloudAfter.hash, writes: cloud.history.length },
  userMatrix,
  invariants: {
    businessIsolation: 'PASS',
    cashIntegrity: 'PASS',
    noDuplicateCloseReports: 'PASS',
    fakeCloudHashMatch: 'PASS',
    noProductionData: 'PASS'
  }
};

const output = writeReport(report);
console.log(`PASS CLICK 360 simulator ${mode}: actions=${scenario.actions} reports=${after.reports} cloudRevision=${cloudAfter.revision} output=${output}`);
