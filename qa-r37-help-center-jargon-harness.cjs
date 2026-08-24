/**
 * r37 (Section 34-35): the customer must never need to understand Firebase,
 * caché, Service Workers, or internal architecture. "Limpiar estado local
 * de esta app" (a raw technical action name) showed "No borra Firebase,
 * negocios ni productos" in its description AND in its confirm() dialog --
 * a customer-facing button and browser-native confirm prompt both naming
 * the backend vendor directly. Technical detail belongs only inside a
 * "Diagnóstico avanzado" disclosure, never in the primary label/description.
 */
const assert = require('assert');
const fs = require('fs');

const app = fs.readFileSync('app.js', 'utf8');

assert(app.includes('id="clearLocalAppStateBtn">Reparar sincronización</button>'), 'the recovery button must use human language ("Reparar sincronización"), not the raw technical action name');
assert(!app.includes('Limpiar estado local de esta app'), 'the old raw-technical button label must not remain anywhere in app.js');

const backupViewBody = app.slice(app.indexOf('id="clearLocalAppStateBtn"'), app.indexOf('id="clearLocalAppStateBtn"') + 900);
assert(!/Firebase/.test(backupViewBody), 'the primary (non-collapsed) recovery description must never name Firebase directly');
assert(backupViewBody.includes('Diagnóstico avanzado'), 'technical detail (including any vendor-specific wording) must live behind a collapsed "Diagnóstico avanzado" disclosure, not in the primary description');

const clearHandlerBody = app.slice(app.indexOf('async function clearLocalAppStateRecovery('), app.indexOf('async function clearLocalAppStateRecovery(') + 1200);
assert(!/Firebase/.test(clearHandlerBody), 'the confirm() dialog and toasts for this action must never name Firebase directly');
assert(clearHandlerBody.includes('Reparando sincronización'), 'the in-progress toast must use human language matching the button label');

const helpTopicEntry = app.slice(app.indexOf("id:'local-state'"), app.indexOf("id:'local-state'") + 500);
const helpTopicTitleAndSteps = helpTopicEntry.slice(0, helpTopicEntry.indexOf('keywords:')) + helpTopicEntry.slice(helpTopicEntry.indexOf('steps:'));
assert(!/Firebase/.test(helpTopicTitleAndSteps), 'the DISPLAYED Help Center article title/steps must never show "Firebase" (the hidden search-keywords field may still include it for discoverability)');
assert(helpTopicEntry.includes('Reparar sincronización'), 'the Help Center article must reference the current button name, not the old one');

console.log('PASS r37 help-center jargon harness: the sync-recovery action uses human language everywhere it is primarily shown (button, description, confirm dialog, toasts, Help article), with Firebase-specific detail only reachable via keyword search or the collapsed Diagnóstico avanzado disclosure');
