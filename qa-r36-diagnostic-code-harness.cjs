/**
 * P0-2 (SHARY, Section 11): the support diagnostic message (WhatsApp,
 * reused from the existing runtime-guard error-report channel) must carry
 * enough non-PII context for AIIA to diagnose stale-bundle vs sync-stuck vs
 * cash-close-blocked without asking the customer to describe what they saw
 * -- but must never carry product/customer/sale content.
 */
const assert = require('assert');
const fs = require('fs');

const guard = fs.readFileSync('runtime-guard.js', 'utf8');

const requiredFields = ['reportId', 'appVersion', 'assetVersion', 'swControllerVersion', 'displayMode', 'route', 'effectiveAccess', 'activeBusinessId', 'syncMode', 'reliability', 'cashClose', 'browser'];
for (const field of requiredFields) {
  assert(guard.includes(field), `reportLink()/record() must surface ${field} in the diagnostic message`);
}

assert(guard.includes('swControllerVersion'), 'the SW controller version (distinct from this page\'s own assetVersion) must be captured -- a mismatch between the two is itself a diagnostic signal');
assert(/activeBusinessId:\s*shortHash\(activeBusinessId\)/.test(guard), 'activeBusinessId must stay hashed (shortHash), never the raw tenant id, in the stored/sent report');

// The explicit non-PII contract: none of these substrings should appear
// anywhere near the message-building logic as literal field references.
const forbiddenPatterns = [/report\.products/, /report\.customer/, /report\.sale/, /report\.email/, /report\.token/];
const reportLinkBody = guard.slice(guard.indexOf('function reportLink'), guard.indexOf('function sourceKind'));
for (const pattern of forbiddenPatterns) {
  assert(!pattern.test(reportLinkBody), `reportLink() must never reference ${pattern} -- PII/business-content leak risk`);
}

console.log('PASS r36 diagnostic code harness: support message carries release/SW/sync/reliability/cash-close context, stays hashed for tenant id, never references product/customer/sale content');
