/**
 * r37 (Section 5): CLICK 360 must self-heal automatically -- a customer
 * should never need to manually clear cache, reinstall, restart, or visit
 * /repair.html just because a new release shipped. Previously, once a new
 * Service Worker took control (fresh assets already cached and ready),
 * the client only showed a PASSIVE toast ("will apply next time you open
 * CLICK 360") -- it never proactively reloaded, and it never even
 * re-checked for updates after the initial boot-time check, so a device
 * left open for a long time (a POS terminal, a shared tablet) could sit
 * on a stale release indefinitely.
 *
 * The fix adds (1) periodic registration.update() polling so long-open
 * tabs actually notice new releases, and (2) an automatic, SAFE reload
 * when a new Service Worker activates -- gated on no modal being open and
 * the route being neutral (#home), capped at exactly one auto-heal per
 * session via sessionStorage (never localStorage, so it can't loop across
 * sessions), falling back to the original passive toast whenever it is
 * not safe to reload right now.
 */
const assert = require('assert');
const fs = require('fs');

const index = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

const controllerChangeBlock = index.slice(index.indexOf("addEventListener('controllerchange'"), index.indexOf("addEventListener('controllerchange'") + 1800);
assert(controllerChangeBlock.includes('AUTO_HEAL_SESSION_KEY'), 'the controllerchange handler must track auto-heal state to cap it at one attempt');
assert(/sessionStorage\.(get|set)Item\(AUTO_HEAL_SESSION_KEY/.test(controllerChangeBlock), 'the auto-heal cap must use sessionStorage (resets per real session), never localStorage (which would leave it stuck forever after one use, or never reset)');
assert(controllerChangeBlock.includes("document.body.classList.contains('has-modal')"), 'auto-heal must never reload while a modal is open (risk of an unsaved draft/dialog in progress)');
assert(controllerChangeBlock.includes("location.hash === '' || location.hash === '#home'"), 'auto-heal must only reload from the neutral #home route, never mid-sale/mid-form on another route');
assert(controllerChangeBlock.includes('window.location.reload()'), 'a safe, first-time controllerchange must actually trigger the reload (the whole point of self-heal)');
assert(
  /if \(!toast\) return;\s*toast\.textContent = 'Actualización lista\. Se aplicará al volver a abrir CLICK 360\.';/.test(controllerChangeBlock),
  'when it is not safe to auto-reload (modal open, wrong route, or already healed this session), the original passive toast must still be shown as a fallback -- never silently do nothing'
);

const registerBlock = app.slice(app.indexOf("navigator.serviceWorker.register("), app.indexOf("navigator.serviceWorker.register(") + 1200);
assert(/setInterval\(\(\) => registration\?\.update\?\.\(\)\.catch\(\(\) => \{\}\), 30 \* 60 \* 1000\)/.test(registerBlock), 'the app must periodically re-check for updates (every 30 minutes) so a long-open tab is not stuck relying only on the one-shot boot-time check');

console.log('PASS r37 SW auto-heal harness: periodic update polling closes the long-open-tab gap, and a new Service Worker triggers exactly one safe auto-reload per session (never mid-modal, never off #home, never more than once), falling back to the passive toast otherwise');
