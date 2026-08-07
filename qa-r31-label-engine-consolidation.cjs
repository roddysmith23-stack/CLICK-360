'use strict';

const fs = require('fs');
const assert = require('node:assert/strict');

const app = fs.readFileSync('app.js', 'utf8');
const firebase = fs.readFileSync('firebase-service.js', 'utf8');
const canvas = fs.readFileSync('universal-label-canvas.js', 'utf8');
const rules = fs.readFileSync('firestore.rules', 'utf8');

// --- Single label engine: advanced wizard print/PDF must route through the canonical
// buildUniversalLabelPrintNode()+handoffPrint pipeline, not the legacy printLabels() DOM builder.
assert(app.includes('const canonicalDoc = universalDocumentFromAdvancedState(product, options, preflight.quantity.count);'),
  'advanced wizard printOne/savePdfBtn must build a canonical Universal document');
assert(app.includes('const job = await buildUniversalLabelPrintNode([{ product, copies:preflight.quantity.count }], canonicalDoc);'),
  'advanced wizard single-print must call the canonical node builder, not printLabels()');
assert(app.includes('const job = await buildUniversalLabelPrintNode(products.map((candidate) => ({ product:candidate, copies:1 })), canonicalDoc);'),
  'advanced wizard catalog print must call the canonical node builder, not printLabels()');
assert(!/runPrintJob = async[\s\S]{0,1400}return printLabels\(/.test(app),
  'advanced wizard single-print regressed to the legacy printLabels() engine');

// --- Single price formatter: no independent duplicate of the dual cash/card switch.
assert(app.includes("price: labelFmt(product, options.priceFormat || 'full'),"),
  'drawLabelOnCanvas must delegate price formatting to labelFmt(), not a local duplicate switch');
assert(!/if \(pf === 'abbr'\) return `Ef\. \$\{cash\}/.test(app),
  'drawLabelOnCanvas must not keep its own inline dual-price switch');
assert(app.includes("formatPrice:() => labelFmt(product, initialTemplate?.priceFormat || 'full'),"),
  'Universal Label Canvas editor preview must use the same formatter as print/PDF (labelFmt)');

// --- priceFormat/renderOptions must survive normalizeDocument() round-trips (the exact bug
// class from the r30 report: normalization silently drops non-schema metadata).
assert(app.includes("const documentModel = { ...canvasApi.normalizeDocument(sourceDocument), priceFormat:sourceDocument?.priceFormat || 'full', renderOptions:sourceDocument?.renderOptions || null };"),
  'printUniversalLabels must preserve priceFormat/renderOptions across its own normalizeDocument() call');

// --- Universal renderer additive geometry (shape/contentRotation/QR margin) — backward
// compatible defaults so every existing document without these fields renders unchanged.
assert(canvas.includes("shape: ['square', 'circle'].includes(input.shape) ? input.shape : 'rounded'"),
  'universal paper schema must accept shape without changing the default');
assert(canvas.includes('contentRotation: [90, 180, 270].includes(Number(input.contentRotation)) ? Number(input.contentRotation) : 0'),
  'universal paper schema must accept contentRotation without changing the default');
assert(canvas.includes("paper.shape === 'circle'"), 'renderLabelToCanvas must honor circular label shape');
assert(canvas.includes('if (paper.contentRotation)'), 'renderLabelToCanvas must honor content rotation');
assert(canvas.includes("key === 'logo' ? 'image' : key"), 'legacy layout logo field must map to a real image object, not a blank text field');

// --- appVersion: every Firestore write gated by the V16.x contract enum must send an accepted
// value. A previous audit found 3 broken sites beyond the already-fixed worker invitation.
const contractGate = '(request.resource.data.appVersion == "16.0.0" || request.resource.data.appVersion == "16.2.0")';
assert(rules.includes(contractGate), 'firestore.rules V16.x appVersion contract must still exist');
// The ONE legitimate '1.0.5' left is settings.appVersion inside the free-form tenant state blob
// (not gated by firestore.rules' V16.x contract enum — it's informational, not enforced).
// Any other occurrence means a Rules-gated write regressed back to the wrong value.
const commercialVersionWrites = [...firebase.matchAll(/appVersion:\s*'1\.0\.5'/g)];
const unexpectedCommercialVersionWrites = commercialVersionWrites.filter((match) => {
  const before = firebase.slice(Math.max(0, match.index - 80), match.index);
  return !before.includes('legacyDataBusinessId');
});
assert.equal(unexpectedCommercialVersionWrites.length, 0,
  `firebase-service.js must not send the commercial version string where Rules require the V16.x contract (found ${unexpectedCommercialVersionWrites.length} unexpected at offsets ${unexpectedCommercialVersionWrites.map((m) => m.index).join(',')})`);
assert(/db\.collection\('telemetryEvents'\)\.doc\(\);[\s\S]{0,800}appVersion: '16\.2\.0'/.test(firebase),
  'recordTelemetry must send the accepted V16.x contract version');
assert(/db\.collection\('activationRequests'\)\.doc\(\);[\s\S]{0,900}appVersion: '16\.2\.0'/.test(firebase),
  'click360CreateActivationRequest must send the accepted V16.x contract version');
assert(/db\.collection\('legalAcceptances'\)\.doc\(acceptanceId\);[\s\S]{0,1200}appVersion: '16\.2\.0'/.test(firebase),
  'click360SaveLegalAcceptance must send the accepted V16.x contract version');

// --- No silent fallback: if the Universal engine fails to load, "Editar plantilla" must tell
// the user before silently downgrading to the legacy wizard.
assert(/if \(!editor \|\| !canvasApi\) \{\s*\n\s*toast\(/.test(app),
  'Universal engine load failure must surface a visible toast, not a silent fallback');

console.log('CLICK360_R31_LABEL_ENGINE_CONSOLIDATION: PASS');
