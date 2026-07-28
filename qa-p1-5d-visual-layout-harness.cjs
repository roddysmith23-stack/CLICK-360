'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const styles = fs.readFileSync('styles.css', 'utf8');
const fixture = fs.readFileSync('qa/fixtures/p1-5d-visual-layout.html', 'utf8');

for (const selector of [
  '.topbar,.pageHead,.pageHead>div,.toolbar,.actions,.modalHeader,.movement,.bigRow,.businessSwitchButton',
  '.btn,.bigRow,.businessSwitchButton,.businessSwitchOption,.printerStatusRow,.notificationItem',
  '.navBtn>span:last-child',
  '.modalHeader h2',
  '.c360-gate-actions>*:last-child'
]) {
  assert.ok(styles.includes(selector), `layout integrity selector is present: ${selector}`);
}

assert.match(styles, /overflow-wrap:break-word/, 'long labels wrap without aggressively splitting normal words');
assert.match(styles, /@media\(max-width:600px\)/, 'small-screen reflow is present');
assert.match(styles, /flex-wrap:wrap/, 'action rows can reflow instead of overflowing');
assert.match(styles, /flex:0 0 auto/, 'chevrons and icons keep a stable width');
assert.match(styles, /overscroll-behavior:contain/, 'modal scrolling stays contained');
assert.match(styles, /\.closeBtn\{min-width:44px;min-height:44px\}/, 'modal close actions meet the minimum touch target');
assert.doesNotMatch(styles, /\.navBtn\{font-size:9px/, 'mobile navigation remains legible');
assert.match(fixture, /__CLICK360_105_VISUAL_QA__ = \{ evaluate:evaluateLayout \}/, 'browser visual fixture exposes a live viewport evaluator');

console.log('CLICK 360 1.0.5 visual layout harness PASS');
