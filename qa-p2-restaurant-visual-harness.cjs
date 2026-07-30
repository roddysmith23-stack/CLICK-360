#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const fixture = readFileSync('qa/fixtures/p2-restaurant-advanced-visual.html', 'utf8');
const styles = readFileSync('styles.css', 'utf8');
const app = readFileSync('app.js', 'utf8');

for (const marker of ['restaurantSummary', 'restaurantTableGrid', 'kdsGrid', 'restaurantOrderModal', 'restaurantHistory']) assert.match(fixture, new RegExp(marker));
for (const selector of ['\\.restaurantSummary', '\\.restaurantTableGrid', '\\.kdsGrid', '\\.restaurantOrderModal']) assert.match(styles, new RegExp(selector));
assert.match(styles, /@media\(max-width:900px\)/);
assert.match(styles, /@media\(max-width:560px\)/);
assert.match(app, /restaurantAdvancedEnabled\(\)/, 'advanced restaurant UI is flag-gated');
assert.match(app, /handoffPrint\(/, 'restaurant output uses the shared printing service');
assert.match(app, /commitCriticalMutation\(snapshot, 'restaurant_payment_recorded'/, 'restaurant payments use the critical commit flow');
assert.match(app, /openRestaurantActionModal/, 'move, merge, split, assignment and cancellation use the application UI');
assert.match(app, /restaurantActionTable|restaurantActionSource|restaurantActionSplitMode/, 'restaurant actions use readable selections rather than opaque identifiers');
assert.doesNotMatch(app, /firebase-admin|accountAccess\s*\.set|setDoc\([^\n]*accountAccess/, 'restaurant candidate does not mutate platform access');

console.log('P2 restaurant visual contract: PASS');
