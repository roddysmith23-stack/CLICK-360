'use strict';

const fs=require('fs');
const assert=require('node:assert/strict');
const app=fs.readFileSync('app.js','utf8');
const css=fs.readFileSync('styles.css','utf8');

assert(app.includes("state.reportsFrom = e.target.value; renderApp('reports');"),'report from filter must not persist tenant state');
assert(app.includes("state.reportsTo = e.target.value; renderApp('reports');"),'report to filter must not persist tenant state');
assert(!app.includes("state.reportsFrom = e.target.value; if(!save()) return; renderApp('reports');"),'report from filter cloud write removed');
assert(!app.includes("state.reportsTo = e.target.value; if(!save()) return; renderApp('reports');"),'report to filter cloud write removed');
assert(app.includes('card sectionCard reportRangeCard'),'reports range wrapper is responsive');
assert(app.includes('class="formGrid financeEntryForm"'),'finance modal gets explicit responsive hook');
assert(app.includes("localStorage.getItem('calcWindowSize')"),'calculator restores size');
assert(app.includes("localStorage.setItem('calcWindowSize'"),'calculator persists size');
assert(app.includes('pinchStart.w * scale'),'pinch changes full calculator width');
assert(app.includes('pinchStart.h * scale'),'pinch changes full calculator height');
assert(app.includes('window.innerWidth - calcSheet.offsetWidth - 8'),'calculator drag is bounded horizontally');
assert(app.includes('window.innerHeight - calcSheet.offsetHeight - 8'),'calculator drag is bounded vertically');
assert(css.includes('CLICK 360 stability recovery r29: mobile containment'),'mobile containment CSS exists');
assert(css.includes('.reportRangeCard'),'responsive report range CSS exists');
assert(css.includes('input[type="date"]'),'date controls have explicit mobile containment');
assert(css.includes('max-width:calc(100vw - 16px)!important'),'calculator max width is viewport-bounded');
assert(!css.includes('commercial-1-0-5-r20'),'stale r20 asset URLs removed from CSS');

console.log('PHASE3_MOBILE_REPORTS_CALCULATOR_CONTRACT: PASS');
