#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const fixture = readFileSync('qa/fixtures/p2-logistics-routes-settlement-visual.html', 'utf8');
const styles = readFileSync('styles.css', 'utf8');
const app = readFileSync('app.js', 'utf8');
const domain = readFileSync('p2-logistics-domain.js', 'utf8');

for (const marker of ['logisticsSummary', 'logisticsRouteGrid', 'logisticsWorkspace', 'logisticsSettlementBreakdown', 'logisticsRows']) assert.match(fixture, new RegExp(marker));
for (const selector of ['\\.logisticsSummary', '\\.logisticsRouteGrid', '\\.logisticsWorkspaceSection', '\\.logisticsSettlementBreakdown']) assert.match(styles, new RegExp(selector));
assert.match(styles, /@media\(max-width:900px\)/);
assert.match(styles, /@media\(max-width:560px\)/);
assert.match(app, /logisticsAdvancedEnabled\(\)/, 'logistics UI is feature-flag gated');
assert.match(app, /logisticsVisibleRoutes\(\)/, 'visible routes are assignment-scoped');
assert.match(app, /handoffPrint\(/, 'logistics output uses the shared printing service');
assert.match(app, /logisticsCriticalCommit\(snapshot, 'logistics_load_dispatched'/, 'inventory reservation uses the critical commit flow');
assert.match(app, /recordCollection\(\{[\s\S]{0,500}route, sale/, 'collections pass an explicit route scope');
assert.match(domain, /routeSales\.discount/, 'route discounts are explicit permissions');
assert.match(domain, /route_assignment_denied/, 'route seller and collector assignment is enforced in the domain');
assert.doesNotMatch(`${app}\n${domain}`, /firebase-admin|accountAccess\s*\.set|setDoc\([^\n]*accountAccess/, 'candidate does not mutate platform access');

console.log('P2 logistics visual contract: PASS');
