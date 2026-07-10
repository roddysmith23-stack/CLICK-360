import crypto from 'node:crypto';

export const SCHEMA_VERSION = 10;
export const CATEGORIES = Object.freeze(['CLEAN_V10', 'LEGACY_CLEAR_OWNER', 'LEGACY_AMBIGUOUS', 'CROSS_TENANT_SUSPECT', 'ORPHANED']);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) ;
  return value;
}

export function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function domainCounts(state = {}) {
  const settings = state.settings || {};
  return {
    businesses: Array.isArray(state.businesses) ? state.businesses.length : 0,
    products: Array.isArray(state.products) ? state.products.length : 0,
    sales: Array.isArray(state.sales) ? state.sales.length : 0,
    movements: Array.isArray(state.movements) ? state.movements.length : 0,
    invoices: Array.isArray(state.invoices) ? state.invoices.length : 0,
    dailyReports: Array.isArray(state.dailyReports) ? state.dailyReports.length : 0,
    workers: Array.isArray(settings.workers) ? settings.workers.length : 0,
    labelTemplates: Array.isArray(settings.labelTemplates) ? settings.labelTemplates.length : 0,
    deletedProducts: Array.isArray(state.deletedProducts) ? state.deletedProducts.length : 0,
    auditLogs: Array.isArray(state.auditLogs) ? state.auditLogs.length : 0
  };
}

export function equalCounts(before, after) {
  return Object.keys(before).every((key) => before[key] === after[key]);
}

export function legacyStateFromDocument(document) {
  const raw = document?.localStorage?.click360_mvp_qa_final_state_v1;
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function summarizeState(state = {}) {
  const settings = state.settings || {};
  return {
    counts: domainCounts(state),
    businessIds: (state.businesses || []).map((business) => business.id || null),
    businessNames: (state.businesses || []).map((business) => business.name || null),
    productCodes: (state.products || []).map((product) => product.code || product.name || null).slice(0, 20),
    workerEmails: (settings.workers || []).map((worker) => worker.email || null).filter(Boolean),
    labelTemplateIds: (settings.labelTemplates || []).map((template) => template.id || template.name || null).slice(0, 20)
  };
}

export function classifyTenant(document, approvedUsers = []) {
  const ownerId = document.ownerId || document.businessId || null;
  const owner = approvedUsers.find((user) => user.uid === ownerId) || null;
  const isV10 = document.schemaVersion === SCHEMA_VERSION;
  const state = isV10 ? document.payload?.data : legacyStateFromDocument(document);
  const summary = summarizeState(state || {});
  const reasons = [];
  const internalIds = summary.businessIds.filter(Boolean);
  const writerMatchesOwner = !document.updatedBy || document.updatedBy === ownerId;
  const emailMatchesOwner = !document.updatedByEmail || !owner?.email || document.updatedByEmail.toLowerCase() === owner.email.toLowerCase();
  const identityMatches = isV10
    && document.ownerId === ownerId
    && document.businessId === document.pathBusinessId
    && document.payload?.identity?.ownerId === ownerId
    && document.payload?.identity?.businessId === document.pathBusinessId;

  if (!owner) reasons.push('owner_not_found');
  if (document.updatedBy && !writerMatchesOwner) reasons.push('foreign_writer');
  if (document.updatedByEmail && !emailMatchesOwner) reasons.push('foreign_writer_email');
  if (isV10 && !identityMatches) reasons.push('v10_identity_mismatch');
  if (internalIds.includes(document.pathBusinessId) === false && internalIds.length === 1 && isV10) reasons.push('path_internal_business_mismatch');

  let category;
  if (reasons.some((reason) => ['foreign_writer', 'foreign_writer_email', 'v10_identity_mismatch', 'path_internal_business_mismatch'].includes(reason))) category = 'CROSS_TENANT_SUSPECT';
  else if (!owner) category = 'ORPHANED';
  else if (isV10) category = 'CLEAN_V10';
  else if (writerMatchesOwner && emailMatchesOwner && document.businessId === document.pathBusinessId && state) category = 'LEGACY_CLEAR_OWNER';
  else category = 'LEGACY_AMBIGUOUS';

  return { category, reasons, ownerId, owner, state, summary };
}

export function toV10Document(legacyDocument, context) {
  const state = legacyStateFromDocument(legacyDocument);
  if (!state) throw new Error('Legacy state is missing or invalid.');
  const beforeCounts = domainCounts(state);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    identity: {
      ownerUid: context.ownerId,
      ownerId: context.ownerId,
      businessId: context.businessId,
      tenantKey: `owner:${context.ownerId}:business:${context.businessId}`,
      schemaVersion: SCHEMA_VERSION
    },
    data: {
      businesses: state.businesses || [], activeBusinessId: state.activeBusinessId || null,
      products: state.products || [], sales: state.sales || [], movements: state.movements || [],
      invoices: state.invoices || [], dailyReports: state.dailyReports || [], deletedProducts: state.deletedProducts || [],
      auditLogs: state.auditLogs || [],
      settings: { workers: state.settings?.workers || [], labelTemplates: state.settings?.labelTemplates || [] },
      // Do not invent a clock value during dry-run: the logical migration hash
      // must remain stable until the administrative transaction writes it.
      updatedAtMs: Number(state.updatedAtMs || 0), updatedAt: state.updatedAt || null
    }
  };
  const afterCounts = domainCounts(payload.data);
  if (!equalCounts(beforeCounts, afterCounts)) throw new Error('Migration count mismatch.');
  return { payload, beforeCounts, afterCounts, logicalHash: stableHash(payload.data) };
}
