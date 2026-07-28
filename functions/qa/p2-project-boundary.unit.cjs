'use strict';

const assert = require('node:assert/strict');
const { allowedStagingProjects, stagingProjectAllowed } = require('../src/p2-project-boundary.cjs');

assert.equal(stagingProjectAllowed('demo-click360-p2-staging'), true);
assert.equal(stagingProjectAllowed('click360-staging-7620168025', 'click360-staging-7620168025'), true);
assert.equal(stagingProjectAllowed('click-360', 'click-360'), false);
assert.equal(stagingProjectAllowed('', 'click360-staging-7620168025'), false);
assert.equal(stagingProjectAllowed('another-project', 'click360-staging-7620168025'), false);
assert.deepEqual([...allowedStagingProjects('staging-a, staging-b')].sort(), ['demo-click360-p2-staging', 'staging-a', 'staging-b']);
console.log('P2 staging project boundary unit: PASS');
