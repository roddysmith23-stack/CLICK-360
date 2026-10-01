import { createHash } from 'node:crypto';

export const INCIDENT_ID = 'SHARY-P0-2026-09-25';
export const PROJECT_ID = 'click-360';
export const BUSINESS_DATE = '2026-09-02';
export const EXPECTED_SOURCE_PATH_SHA256 = 'd3e9302df80dc57b2c4dc1ec50e02bc9dc7124b941469ab0e47dd11ea40cf04f';
export const EXPECTED_OWNER_ID_SHA256 = 'a31a01331fb8eaa8462c071b6c9c844ab3d4f6001a1181b032a1a1c153170c6f';
export const EXPECTED_BUSINESS_ID_SHA256 = '3308a553482f0981fd1019f1ace5032a448f9456bddd301572063d03d5fa21e9';
export const AUTHORIZED_SESSION_HASHES = Object.freeze([
  '51862bf965d5a1d513d9cfe5616b60c3dcbba29664dcfe7a42c7acf444ca73a0',
  '6b56ec9c45a604696c476fa877f30074facaaa11970f755ecc2737f42bb26ea3'
].sort());

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') return { __firestoreTimestampMillis: value.toMillis() };
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function collectionHashes(state = {}) {
  return Object.fromEntries(['products', 'sales', 'movements', 'dailyReports', 'deletedProducts']
    .map((key) => [key, sha256(canonicalJson(state[key] || []))]));
}

function reportsForSession(reports, session) {
  return reports.filter((report) => report.businessId === session.businessId
    && report.date === session.date
    && report.cashSessionId === session.id);
}

function sessionIsClosed(session, reports) {
  return session.status === 'closed' || reportsForSession(reports, session).some((report) => report.status === 'closed');
}

export function assessRepairState(state = {}, businessId = '', currentBusinessDate = '', authorizedSessionHashes = AUTHORIZED_SESSION_HASHES) {
  const sessions = (state.cashSessions || []).filter((item) => item.businessId === businessId);
  const reports = (state.dailyReports || []).filter((item) => item.businessId === businessId);
  const sales = (state.sales || []).filter((item) => item.businessId === businessId);
  const movements = (state.movements || []).filter((item) => item.businessId === businessId);
  const unresolved = sessions.filter((session) => session.status === 'open' && !sessionIsClosed(session, reports));
  const staleUnresolved = unresolved.filter((session) => !currentBusinessDate || session.date < currentBusinessDate);
  const staleHashes = staleUnresolved.map((session) => sha256(String(session.id || ''))).sort();
  const expectedHashes = [...authorizedSessionHashes].sort();
  const exactAuthorizedSet = JSON.stringify(staleHashes) === JSON.stringify(expectedHashes);

  const candidates = staleUnresolved.map((session) => {
    const linkedSales = sales.filter((sale) => sale.cashSessionId === session.id);
    const linkedMovements = movements.filter((movement) => movement.cashSessionId === session.id);
    const linkedReports = reportsForSession(reports, session);
    const safe = session.date === BUSINESS_DATE
      && linkedSales.length === 0
      && linkedReports.length === 0
      && linkedMovements.length === 1
      && linkedMovements[0]?.kind === 'apertura';
    return {
      id: session.id,
      idSha256: sha256(String(session.id || '')),
      date: session.date,
      linkedSales: linkedSales.length,
      linkedMovements: linkedMovements.length,
      movementKinds: linkedMovements.map((movement) => movement.kind),
      linkedReports: linkedReports.length,
      safe
    };
  });

  const saleIds = sales.map((sale) => sale.id).filter(Boolean);
  const uniqueSaleIds = new Set(saleIds);
  const fortyEightSales = sales.filter((sale) => sale.date === BUSINESS_DATE
    && sale.status !== 'cancelled'
    && Number(sale.total) === 48);
  const fortyEightSale = fortyEightSales[0] || null;
  const linkedFortyEightMovements = fortyEightSale
    ? movements.filter((movement) => movement.saleId === fortyEightSale.id
      || (fortyEightSale.operationId && movement.operationId === fortyEightSale.operationId))
    : [];
  const reportReferences = fortyEightSale
    ? reports.filter((report) => Array.isArray(report.saleIds) && report.saleIds.includes(fortyEightSale.id))
    : [];
  const saleReferenceSafe = fortyEightSales.length === 1
    && uniqueSaleIds.size === saleIds.length
    && linkedFortyEightMovements.length === 1
    && linkedFortyEightMovements[0]?.kind === 'ingreso'
    && Number(linkedFortyEightMovements[0]?.amount) === 48;

  return {
    authorized: exactAuthorizedSet && candidates.length === 2 && candidates.every((candidate) => candidate.safe) && saleReferenceSafe,
    unresolvedCount: unresolved.length,
    currentOrFutureUnresolvedCount: unresolved.length - staleUnresolved.length,
    staleUnresolvedCount: staleUnresolved.length,
    staleHashes,
    candidates,
    fortyEightSale: {
      transactionCount: fortyEightSales.length,
      movementCount: linkedFortyEightMovements.length,
      reportReferenceCount: reportReferences.length,
      referencesAreReportsNotTransactions: saleReferenceSafe
    },
    collectionHashes: collectionHashes(state)
  };
}

export function buildPatchedSessions(sessions = [], candidateIds = [], timestampIso = '') {
  const targets = new Set(candidateIds);
  let changed = 0;
  const next = sessions.map((session) => {
    if (!targets.has(session.id)) return session;
    changed += 1;
    return {
      ...session,
      status: 'closed',
      closedAt: timestampIso,
      reconciledAt: timestampIso,
      reconciliationReason: 'orphan_open_session_with_no_sales_or_report',
      reconciliationIncident: INCIDENT_ID
    };
  });
  if (changed !== candidateIds.length || changed !== 2) throw new Error(`Expected to patch exactly two authorized sessions, found ${changed}.`);
  return next;
}

export function typeAwareDiff(a, b, path = 'root', diffs = []) {
  const aIsTimestamp = Boolean(a && typeof a === 'object' && typeof a.toMillis === 'function');
  const bIsTimestamp = Boolean(b && typeof b === 'object' && typeof b.toMillis === 'function');
  if (aIsTimestamp !== bIsTimestamp) { diffs.push(path); return diffs; }
  if (aIsTimestamp && bIsTimestamp) {
    if (a.toMillis() !== b.toMillis()) diffs.push(path);
    return diffs;
  }
  const aIsObject = Boolean(a && typeof a === 'object');
  const bIsObject = Boolean(b && typeof b === 'object');
  if (!aIsObject || !bIsObject) {
    if (a !== b) diffs.push(path);
    return diffs;
  }
  const keys = new Set([
    ...(Array.isArray(a) ? a.map((_, index) => index) : Object.keys(a)),
    ...(Array.isArray(b) ? b.map((_, index) => index) : Object.keys(b))
  ]);
  for (const key of keys) typeAwareDiff(a[key], b[key], `${path}.${key}`, diffs);
  return diffs;
}
