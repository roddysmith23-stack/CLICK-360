#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const fixture = readFileSync('qa/fixtures/p2-platform-workers-visual.html', 'utf8');
const styles = readFileSync('styles.css', 'utf8');
const app = readFileSync('app.js', 'utf8');

assert.match(fixture, /id="workerToggle"/, 'fixture keeps a distinct module toggle');
assert.match(fixture, /id="inviteButton"/, 'fixture includes the invite action');
assert.match(fixture, /p2PermissionGrid/, 'fixture exercises the permission grid');
assert.match(styles, /\.p2SummaryGrid/);
assert.match(styles, /min-width:0/);
assert.match(styles, /overflow-wrap:anywhere/);
assert.match(styles, /@media\(max-width:680px\)/);
assert.match(app, /p2ModuleEnabled\('workers'\)/, 'the actual app gates the team view');
assert.match(app, /pending_backend/, 'access-changing actions remain local requests');
assert.doesNotMatch(app, /setDoc\([^\n]*accountAccess|accountAccess[^\n]*\.set\(/, 'P2 local admin UI does not write accountAccess');

console.log('P2 platform/workers visual contract: PASS');
