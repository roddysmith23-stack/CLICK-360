/**
 * r37 (Sections 17-20, 63): CLICK 360 needs real, public, no-login-required
 * /terms and /privacy pages, and permanent links to them from Login,
 * Settings, and Help -- not just a post-login-only #legal route or a
 * JS text-swap blurb.
 *
 * Firebase Hosting here has no cleanUrls/rewrites configured, so the
 * public pages are literal static files (terms.html/privacy.html),
 * matching the existing repair.html precedent exactly: self-contained,
 * no dependency on app.js/Firebase Auth/tenant state, always reachable
 * even if the SPA itself is broken.
 */
const assert = require('assert');
const fs = require('fs');

for (const file of ['terms.html', 'privacy.html']) {
  assert(fs.existsSync(file), `${file} must exist as a standalone public page (Firebase Hosting has no cleanUrls, so this is the real reachable URL)`);
  const content = fs.readFileSync(file, 'utf8');
  assert(content.includes('<!doctype html>'), `${file} must be a complete standalone HTML document`);
  assert(!content.includes('app.js'), `${file} must not depend on app.js -- it must work even if the SPA itself is broken`);
  assert(content.includes('v16-domain.js'), `${file} must load v16-domain.js to display the live TERMS_VERSION/PRIVACY_VERSION instead of a hardcoded string that can go stale`);
  assert(content.includes('href="/terms.html"') && content.includes('href="/privacy.html"'), `${file} must cross-link both public legal pages`);
  assert(content.includes('href="/"'), `${file} must link back to the main app`);
}

const buildScript = fs.readFileSync('scripts/build-static-release.mjs', 'utf8');
assert(buildScript.includes("'terms.html'") && buildScript.includes("'privacy.html'"), 'terms.html/privacy.html must be in the static release allowlist or they will not ship to production');

const hostingConfig = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
const sources = (hostingConfig.hosting?.headers || []).map((entry) => entry.source);
assert(sources.includes('/terms.html') && sources.includes('/privacy.html'), 'terms.html/privacy.html must have explicit no-cache headers (like repair.html) so a legal-content update is never served stale from a CDN cache');

const gate = fs.readFileSync('firebase-service.js', 'utf8');
assert(
  /href="\/terms\.html"[^>]*target="_blank"/.test(gate) && /href="\/privacy\.html"[^>]*target="_blank"/.test(gate),
  'the pre-login gate (Login/first-access) must link permanently to the public terms/privacy pages, opening in a new tab so the in-progress login flow is not disrupted'
);
assert(!gate.includes('showPublicLegal'), 'showPublicLegal() (the old in-place text-swap blurb with a hardcoded stale version) must be fully removed now that real permanent links exist');

const app = fs.readFileSync('app.js', 'utf8');
assert(app.includes("$('#showTerms').onclick"), 'Settings must keep its permanent link into the full #legal terms/privacy content');
assert(/Términos y Política de privacidad<\/a>/.test(app.slice(app.indexOf('function helpView'), app.indexOf('function helpTopicCards'))), 'Help Center must carry a permanent link to terms/privacy');

console.log('PASS r37 legal public-pages harness: terms.html/privacy.html exist as self-contained, always-reachable, always-fresh public pages; permanent links wired from Login, Settings, and Help');
