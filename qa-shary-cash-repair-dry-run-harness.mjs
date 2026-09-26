import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AUTHORIZED_SESSION_HASHES,
  BUSINESS_DATE,
  INCIDENT_ID,
  assessRepairState,
  buildPatchedSessions,
  sha256,
  typeAwareDiff
} from './scripts/incidents/shary-cash-repair-core.mjs';

const businessId = 'synthetic-shary-business';
const candidateIds = ['candidate-a', 'candidate-b'];
const syntheticAuthorizedHashes = candidateIds.map(sha256).sort();

function fixture() {
  const saleId = 'sale-48';
  return {
    cashSessions: [
      ...candidateIds.map((id, index) => ({ id, businessId, date:BUSINESS_DATE, status:'open', openedAt:`2026-09-02T10:0${index}:00.000Z` })),
      { id:'session-sale', businessId, date:BUSINESS_DATE, status:'closed' }
    ],
    sales: [{ id:saleId, operationId:'sale-op', businessId, cashSessionId:'session-sale', date:BUSINESS_DATE, status:'paid', total:48 }],
    movements: [
      ...candidateIds.map((id) => ({ id:`movement-${id}`, businessId, cashSessionId:id, date:BUSINESS_DATE, kind:'apertura', amount:0 })),
      { id:'movement-48', operationId:'sale-op', saleId, businessId, cashSessionId:'session-sale', date:BUSINESS_DATE, kind:'ingreso', amount:48 }
    ],
    dailyReports: [
      { id:'report-a', businessId, cashSessionId:'session-sale', date:BUSINESS_DATE, status:'reopened', saleIds:[saleId] },
      { id:'report-b', businessId, cashSessionId:'session-other', date:BUSINESS_DATE, status:'closed', saleIds:[saleId] }
    ],
    products: [{ id:'p1', businessId, stock:1, qty:1 }],
    deletedProducts: []
  };
}

const state = fixture();
const candidateAssessment = assessRepairState(state, businessId, '2026-09-26', syntheticAuthorizedHashes);
assert.equal(candidateAssessment.authorized, true);
assert.equal(candidateAssessment.staleUnresolvedCount, 2);
assert.equal(candidateAssessment.currentOrFutureUnresolvedCount, 0);
assert.deepEqual(candidateAssessment.candidates.map((candidate) => candidate.linkedSales), [0, 0]);
assert.deepEqual(candidateAssessment.candidates.map((candidate) => candidate.linkedReports), [0, 0]);
assert.deepEqual(candidateAssessment.candidates.map((candidate) => candidate.movementKinds), [['apertura'], ['apertura']]);
assert.deepEqual(candidateAssessment.fortyEightSale, {
  transactionCount:1,
  movementCount:1,
  reportReferenceCount:2,
  referencesAreReportsNotTransactions:true
});

const extraStale = structuredClone(state);
extraStale.cashSessions.push({ id:'unexpected-open', businessId, date:'2026-09-01', status:'open' });
assert.equal(assessRepairState(extraStale, businessId, '2026-09-26', syntheticAuthorizedHashes).authorized, false,
  'any additional stale session must block the repair');

const source = fs.readFileSync('scripts/incidents/shary-cash-repair.mjs', 'utf8');
assert(source.includes("if (apply === dryRun) throw new Error('Choose exactly one mode: --dry-run or --apply.')"));
assert(source.includes("--confirm=APPLY_SHARY_P0_2026_09_25"), 'apply mode must require the explicit incident confirmation token');
assert(source.includes('Remote state changed after the verified backup. Generate a new backup and preview; repair aborted.'));
assert(source.includes("'payload.data.cashSessions': nextSessions"), 'the transaction must update only the cashSessions array plus explicit metadata');
assert(source.includes('transaction.create(auditRef'), 'the repair and audit entry must be created in one transaction');
assert(source.includes("firestoreWrites: 0"), 'dry-run must explicitly report zero writes');
assert(!source.includes('transaction.set(stateRef'), 'the repair must never replace state/main wholesale');

const patched = buildPatchedSessions(state.cashSessions, candidateIds, '2026-09-26T00:00:00.000Z');
assert.equal(patched.filter((session) => session.status === 'closed').length, 3);
assert(patched.filter((session) => candidateIds.includes(session.id)).every((session) => session.reconciliationIncident === INCIDENT_ID));
assert.deepEqual(state.cashSessions.map((session) => session.status), ['open', 'open', 'closed'], 'the pure repair builder must not mutate its input');
assert.throws(() => buildPatchedSessions(state.cashSessions, ['candidate-a'], '2026-09-26T00:00:00.000Z'), /exactly two/);

const before = { revision:1, payload:{ data:{ cashSessions:state.cashSessions } } };
const after = { revision:2, payload:{ data:{ cashSessions:patched } } };
const diffs = typeAwareDiff(before, after);
assert(diffs.includes('root.revision'));
assert(diffs.includes('root.payload.data.cashSessions.0.status'));
assert(diffs.includes('root.payload.data.cashSessions.1.reconciliationIncident'));

assert.equal(syntheticAuthorizedHashes.length, 2);
assert.equal(AUTHORIZED_SESSION_HASHES.length, 2);
console.log('PASS SHARY cash repair dry-run contract: pinned identity, strict snapshot comparison, two-session-only mutation, atomic audit and post-check guards');
