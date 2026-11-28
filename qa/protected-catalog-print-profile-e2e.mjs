import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { chromium, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
for (const script of [
  'extract-print-profile-merge.cjs',
  'extract-protected-catalog-print-ui.cjs'
]) execFileSync(process.execPath, [path.join(root, 'qa', script)], { stdio:'inherit' });

const port = Number(process.env.CLICK360_PROTECTED_CATALOG_PORT || 4926);
const url = `http://127.0.0.1:${port}/qa/fixtures/protected-catalog-print-profile.html`;
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('protected catalog fixture server did not start');
}

try {
  await waitForServer();
  for (const [name, browserType] of [['chromium',chromium],['webkit',webkit]]) {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      await page.goto(url, { waitUntil:'networkidle' });
      await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
      const result = await page.evaluate(async () => {
        const { host, accessChecks } = await window.__CLICK360_CATALOG_START__();
        const profile = host.querySelector('#c360-catalog-profile');
        if (!profile) throw new Error('protected catalog is missing the shared paper-profile selector');
        const initialProfileValues = [...profile.options].map(option => option.value);
        const initialSelectedProfileId = profile.value;
        const initialFallbackLabel = profile.options[0]?.textContent || '';
        const profileMarkupInjected = !!host.querySelector('img') || window.__CLICK360_XSS__ === true;
        const business = host.querySelector('#c360-catalog-business');
        business.value = 'biz-b';
        business.dispatchEvent(new Event('change', { bubbles:true }));
        for (let attempt = 0; attempt < 50 && ![...profile.options].some(option => option.value === 'profile-b'); attempt += 1)
          await new Promise(resolve => setTimeout(resolve, 10));
        const businessBProfileValues = [...profile.options].map(option => option.value);
        business.value = 'biz-c';
        business.dispatchEvent(new Event('change', { bubbles:true }));
        for (let attempt = 0; attempt < 50 && ![...profile.options].some(option => option.value === 'profile-c-sheet'); attempt += 1)
          await new Promise(resolve => setTimeout(resolve, 10));
        const businessCProfileValues = [...profile.options].map(option => option.value);
        const incompatibleInitiallySelected = profile.value;
        const product = host.querySelector('#c360-catalog-product');
        const template = host.querySelector('#c360-catalog-template');
        const quantity = host.querySelector('#c360-catalog-quantity');
        const form = host.querySelector('#c360-catalog-form');
        product.value = 'product-c';
        template.value = 'template-c';
        quantity.value = '1';
        window.__CLICK360_CATALOG_PRINT_HANDOFF__ = null;
        form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
        for (let attempt = 0; attempt < 50 && !window.__CLICK360_CATALOG_PRINT_HANDOFF__; attempt += 1)
          await new Promise(resolve => setTimeout(resolve, 10));
        const incompatibleAutomaticJob = window.__CLICK360_CATALOG_PRINT_HANDOFF__;
        window.__CLICK360_CATALOG_PRINT_HANDOFF__ = null;
        business.value = 'biz-a';
        business.dispatchEvent(new Event('change', { bubbles:true }));
        for (let attempt = 0; attempt < 50 && ![...profile.options].some(option => option.value === 'profile-a'); attempt += 1)
          await new Promise(resolve => setTimeout(resolve, 10));
        window.__CLICK360_TEST_DEVICE_STATE_READS__ = 0;
        product.value = 'product-a';
        template.value = 'template-a';
        profile.value = '';
        profile.dispatchEvent(new Event('change', { bubbles:true }));
        profile.value = 'profile-a';
        profile.dispatchEvent(new Event('change', { bubbles:true }));
        quantity.value = '2';
        form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
        for (let attempt = 0; attempt < 50 && !window.__CLICK360_CATALOG_PRINT_HANDOFF__; attempt += 1)
          await new Promise(resolve => setTimeout(resolve, 10));
        const handed = window.__CLICK360_CATALOG_PRINT_HANDOFF__;
        const selectedProfileId = profile.value;
        window.__CLICK360_CATALOG_PRINT_HANDOFF__ = null;
        profile.value = '';
        form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
        for (let attempt = 0; attempt < 50 && !window.__CLICK360_CATALOG_PRINT_HANDOFF__; attempt += 1)
          await new Promise(resolve => setTimeout(resolve, 10));
        const templateFallback = window.__CLICK360_CATALOG_PRINT_HANDOFF__;
        return {
          initialProfileValues,
          initialSelectedProfileId,
          initialFallbackLabel,
          profileMarkupInjected,
          businessBProfileValues,
          businessCProfileValues,
          incompatibleInitiallySelected,
          incompatibleAutomaticProfileId:incompatibleAutomaticJob?.prepared?.profile?.id || null,
          incompatibleAutomaticMedia:incompatibleAutomaticJob?.prepared?.media || null,
          selectedProfileId,
          resolvedProfileId:handed?.prepared?.profile?.id || null,
          preparedMedia:handed?.prepared?.media || null,
          templateFallbackProfileId:templateFallback?.prepared?.profile?.id || null,
          templateFallbackMedia:templateFallback?.prepared?.media || null,
          localDeviceReads:window.__CLICK360_TEST_DEVICE_STATE_READS__ || 0,
          accessChecks,
          status:host.querySelector('#c360-catalog-status')?.textContent || ''
        };
      });
      assert.deepEqual(result.initialProfileValues, ['', 'profile-a'], `${name}: only the active business profile and template fallback should be offered`);
      assert.equal(result.initialSelectedProfileId, '', `${name}: an unlinked profile must not be selected implicitly`);
      assert.equal(result.initialFallbackLabel, 'Automático (plantilla o perfil compatible)', `${name}: empty choice must describe resolver behavior`);
      assert.equal(result.profileMarkupInjected, false, `${name}: profile labels must render as text, never HTML`);
      assert.deepEqual(result.businessBProfileValues, ['', 'profile-b'], `${name}: changing business must replace the available profile scope`);
      assert.deepEqual(result.businessCProfileValues, ['', 'profile-c-sheet'], `${name}: only the selected business paper profiles should be offered`);
      assert.equal(result.incompatibleInitiallySelected, '', `${name}: a unique unlinked sheet profile must not override a roll template at open`);
      assert.equal(result.incompatibleAutomaticProfileId, 'template-paper', `${name}: incompatible saved media must leave the template resolver in control`);
      assert.deepEqual(result.incompatibleAutomaticMedia, { widthMm:84, heightMm:64 }, `${name}: incompatible sheet geometry must not replace roll geometry`);
      assert.equal(result.selectedProfileId, 'profile-a', `${name}: explicit profile selection must be preserved`);
      assert.equal(result.resolvedProfileId, 'profile-a', `${name}: catalog route must pass explicit shared profile into production resolver`);
      assert.deepEqual(result.preparedMedia, { widthMm:92, heightMm:64 }, `${name}: explicit profile carrier geometry must reach the print plan`);
      assert.equal(result.templateFallbackProfileId, 'template-paper', `${name}: blank selection must retain the template fallback`);
      assert.deepEqual(result.templateFallbackMedia, { widthMm:84, heightMm:64 }, `${name}: template fallback geometry must remain intact`);
      assert.equal(result.localDeviceReads, 0, `${name}: protected catalog must not read device-local print calibration`);
      assert.deepEqual(result.accessChecks, ['biz-c', 'biz-a', 'biz-a'], `${name}: confirm access must stay scoped to the selected business`);
      assert.deepEqual(errors, [], `${name}: browser runtime errors`);
      console.log(`PROTECTED_CATALOG_PRINT_PROFILE ${name}: PASS`);
    } finally { await browser.close(); }
  }
} finally {
  server.kill('SIGTERM');
}
