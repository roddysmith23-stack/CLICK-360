#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectAdmin } from '../lib/firebase-admin-connect.mjs';
import '../../cash-session-reconciliation.js';

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, ...rest] = entry.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
if (args['read-only'] !== true) throw new Error('Pass --read-only. This tool never writes to Firestore.');
if (args.project !== 'click-360') throw new Error('This preview is pinned to project click-360.');
if (!args['backup-dir'] || !args.out) throw new Error('Usage: --read-only --project=click-360 --backup-dir=<private backup> --out=<private preview file>');

const backupDirectory = path.resolve(String(args['backup-dir']));
const backupPath = path.join(backupDirectory, 'firestore-native-backup.private.json');
const manifestPath = path.join(backupDirectory, 'manifest.private.json');
const outputPath = path.resolve(String(args.out));
const backupBytes = await readFile(backupPath);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('timestampValue' in value) {
    const timestamp = value.timestampValue;
    if (typeof timestamp === 'string') return timestamp;
    const seconds = Number(timestamp?.seconds ?? timestamp?._seconds ?? 0);
    const nanos = Number(timestamp?.nanos ?? timestamp?.nanoseconds ?? timestamp?._nanoseconds ?? 0);
    return new Date((seconds * 1000) + (nanos / 1e6)).toISOString();
  }
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([key, nested]) => [key, decodeValue(nested)]));
  throw new Error(`Unsupported Firestore Value: ${Object.keys(value).join(',')}`);
}
function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}
function localDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Guayaquil', year:'numeric', month:'2-digit', day:'2-digit' }).format(date);
}
function duplicates(values) {
  const seen = new Set();
  return [...new Set(values.filter(Boolean).filter((value) => seen.has(value) || !seen.add(value)))];
}

const actualBackupHash = sha256(backupBytes);
if (actualBackupHash !== manifest.backupSha256) throw new Error('Backup hash does not match its manifest.');
const backup = JSON.parse(backupBytes);
const root = decodeFields(backup.documents.stateMain.fields);
const state = root.payload?.data || {};
const businessId = backup.tenant?.matchedBusinessIds?.[0];
if (!businessId) throw new Error('Backup does not identify the matched SHARY business.');

const db = await connectAdmin(args.project, 'shary-repair-preview-readonly');
const currentSnapshot = await db.doc(manifest.sourcePath).get();
if (!currentSnapshot.exists || !currentSnapshot._fieldsProto) throw new Error('Current production source document is unavailable.');
const currentRoot = currentSnapshot.data();
const currentFieldsHash = sha256(canonicalJson(currentSnapshot._fieldsProto));
const expectedFieldsHash = manifest.documentHashes.stateMainFieldsSha256;
const currentRevision = currentRoot?.revision ?? currentRoot?.payload?.revision ?? null;
const sourceUnchanged = currentRevision === manifest.sourceRevision && currentFieldsHash === expectedFieldsHash;

const reports = (state.dailyReports || []).filter((item) => item.businessId === businessId);
const sessions = (state.cashSessions || []).filter((item) => item.businessId === businessId);
const sales = (state.sales || []).filter((item) => item.businessId === businessId);
const movements = (state.movements || []).filter((item) => item.businessId === businessId);
const products = (state.products || []).filter((item) => item.businessId === businessId);
const deletedProducts = (state.deletedProducts || []).filter((item) => item.businessId === businessId);
const unresolved = globalThis.CLICK360_CASH_RECONCILIATION.unresolvedOpenCashSessions(sessions, reports, businessId);

const repairCandidates = unresolved.map((session) => {
  const sessionSales = sales.filter((sale) => sale.cashSessionId === session.id);
  const sessionMovements = movements.filter((movement) => movement.cashSessionId === session.id);
  const sessionReports = reports.filter((report) => report.cashSessionId === session.id);
  const closedReportsSameDate = reports.filter((report) => report.date === session.date && report.status === 'closed');
  const safeToReconcile = sessionSales.length === 0
    && sessionReports.length === 0
    && sessionMovements.every((movement) => movement.kind === 'apertura')
    && closedReportsSameDate.length > 0;
  const stateIndex = (state.cashSessions || []).findIndex((item) => item.id === session.id && item.businessId === businessId);
  return {
    sessionId: session.id,
    businessDate: session.date,
    stateIndex,
    currentStatus: session.status,
    openedAt: session.openedAt || null,
    linkedCounts: { sales:sessionSales.length, movements:sessionMovements.length, reports:sessionReports.length, closedReportsSameDate:closedReportsSameDate.length },
    safeToReconcile,
    exactPatch: safeToReconcile ? {
      path: `/payload/data/cashSessions/${stateIndex}`,
      set: {
        status: 'closed',
        closedAt: '<serverTimestamp-at-approved-execution>',
        reconciledAt: '<same-serverTimestamp>',
        reconciliationReason: 'orphan_open_session_with_no_sales_or_report',
        reconciliationIncident: 'SHARY-P0-2026-09-25'
      },
      preserveAllOtherFields: true
    } : null
  };
});

const today = '2026-09-25';
const todaySales = sales.filter((sale) => localDate(sale.createdAtMs || sale.createdAt) === today);
const todayMovements = movements.filter((movement) => localDate(movement.createdAtMs || movement.createdAt) === today);
const todayProducts = products.filter((product) => localDate(product.updatedAtMs || product.updatedAt) === today);
const todayDeletedProducts = deletedProducts.filter((product) => localDate(product.deletedAtMs || product.deletedAt) === today);
const todaySessions = sessions.filter((session) => [session.openedAt, session.closedAt].some((value) => localDate(value) === today));
const todayReports = reports.filter((report) => localDate(report.closedAt) === today);
const recentDates = [...new Set([...sales, ...movements, ...sessions, ...reports].map((item) => item.date).filter((date) => date >= '2026-08-30' && date <= today))].sort();
const collectionHashesBefore = Object.fromEntries(['products', 'sales', 'movements', 'dailyReports'].map((key) => [key, sha256(canonicalJson(state[key] || []))]));

const preview = {
  format: 'click360-shary-cash-repair-preview-v1',
  generatedAt: new Date().toISOString(),
  mode: 'read-only-preview',
  productionComparison: {
    sourcePath: manifest.sourcePath,
    capturedRevision: manifest.sourceRevision,
    currentRevision,
    capturedFieldsSha256: expectedFieldsHash,
    currentFieldsSha256: currentFieldsHash,
    sourceUnchanged,
    repairBlocked: !sourceUnchanged
  },
  verifiedBackup: { path:backupPath, sha256:actualBackupHash, bytes:backupBytes.length, matchesManifest:true },
  inventoryAndSales: {
    authoritativeCounts: { products:products.length, sales:sales.length, movements:movements.length, cashSessions:sessions.length, dailyReports:reports.length },
    today: {
      productsUpdated: todayProducts.length,
      productsCreatedAndStillActive: todayProducts.filter((product) => localDate(product.createdAtMs || product.createdAt) === today).length,
      deletedProducts: todayDeletedProducts.length,
      sales: todaySales.map((sale) => ({ id:sale.id, operationId:sale.operationId || '', businessDate:sale.date, createdAtMs:sale.createdAtMs || null, total:sale.total, method:sale.method, status:sale.status, cashSessionId:sale.cashSessionId, itemCount:(sale.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0) })),
      movementCount: todayMovements.length,
      sessions: todaySessions.map((session) => ({ id:session.id, date:session.date, status:session.status, reportId:session.reportId || '', openedAt:session.openedAt || null, closedAt:session.closedAt || null })),
      reports: todayReports.map((report) => ({ id:report.id, date:report.date, status:report.status, cashSessionId:report.cashSessionId || '', saleIds:report.saleIds || [], paymentTotals:report.paymentTotals || {} }))
    },
    integrity: {
      duplicateProductIds: duplicates(products.map((item) => item.id)),
      duplicateSaleIds: duplicates(sales.map((item) => item.id)),
      duplicateSaleOperationIds: duplicates(sales.map((item) => item.operationId)),
      duplicateMovementIds: duplicates(movements.map((item) => item.id)),
      stockQtyMismatches: products.filter((product) => Number(product.stock) !== Number(product.qty)).map((product) => product.id),
      missingSoldProductReferencesToday: todaySales.flatMap((sale) => sale.items || []).map((item) => item.productId || item.id).filter((id) => id && !products.some((product) => product.id === id) && !deletedProducts.some((product) => product.id === id))
    },
    recentByBusinessDate: Object.fromEntries(recentDates.map((date) => [date, {
      sales:sales.filter((item) => item.date === date).length,
      movements:movements.filter((item) => item.date === date).length,
      cashSessions:sessions.filter((item) => item.date === date).length,
      dailyReports:reports.filter((item) => item.date === date).length
    }]))
  },
  repairPlan: {
    authorizationRequired: true,
    candidates: repairCandidates,
    exactMutationScope: repairCandidates.filter((candidate) => candidate.safeToReconcile).map((candidate) => candidate.exactPatch),
    topLevelMetadataPatch: {
      revision: manifest.sourceRevision + 1,
      baseRevision: manifest.sourceRevision,
      updatedAt: '<serverTimestamp-at-approved-execution>',
      updatedAtMs: '<same-server-time-in-ms>',
      reason: 'shary_cash_session_reconciliation'
    },
    mustRemainByteEquivalentAfter: ['payload.data.products', 'payload.data.sales', 'payload.data.movements', 'payload.data.dailyReports', 'payload.data.deletedProducts'],
    collectionHashesBefore,
    concurrencyControl: {
      transactionReadPath: manifest.sourcePath,
      requireRevision: manifest.sourceRevision,
      requireFieldsSha256: expectedFieldsHash,
      abortOnMismatch: true
    },
    postCheck: ['revision incremented exactly once', 'only listed cashSessions changed', 'no unresolved open session remains for 2026-09-02', 'collection hashes remain identical', 'independent server reread matches transaction result']
  }
};

await writeFile(outputPath, `${JSON.stringify(preview, null, 2)}\n`, { mode:0o600 });
await chmod(outputPath, 0o600);
console.log(JSON.stringify({
  generatedAt:preview.generatedAt,
  sourceUnchanged,
  currentRevision,
  today:{ productsUpdated:todayProducts.length, deletedProducts:todayDeletedProducts.length, sales:todaySales.length, movements:todayMovements.length, sessions:todaySessions.length, reports:todayReports.length },
  integrity:{ duplicateSaleIds:preview.inventoryAndSales.integrity.duplicateSaleIds.length, stockQtyMismatches:preview.inventoryAndSales.integrity.stockQtyMismatches.length, missingSoldProductReferencesToday:preview.inventoryAndSales.integrity.missingSoldProductReferencesToday.length },
  repairCandidates:repairCandidates.map((candidate) => ({ sessionIdSha256:sha256(candidate.sessionId), businessDate:candidate.businessDate, linkedCounts:candidate.linkedCounts, safeToReconcile:candidate.safeToReconcile })),
  outputPath
}, null, 2));
