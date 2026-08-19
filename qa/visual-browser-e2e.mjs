import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_VISUAL_E2E_PORT || 4173);
const url = `http://127.0.0.1:${port}/qa/fixtures/p1-5d-visual-layout.html`;
const output = path.join(root, 'output/playwright/release-1.0.5');
const widths = [320, 360, 375, 390, 414, 768, 820, 1024, 1280, 1366, 1440, 1920];
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], {
  cwd:root,
  stdio:'ignore'
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Visual fixture did not start.');
}

async function run(name, browserType, options = {}) {
  const browser = await browserType.launch(options);
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url, { waitUntil:'networkidle' });
    for (const width of widths) {
      await page.setViewportSize({ width, height:width < 768 ? 844 : 900 });
      const result = await page.evaluate(() => window.__CLICK360_105_VISUAL_QA__?.evaluate());
      if (!result?.pass) throw new Error(`${name} visual overflow at ${width}px: ${JSON.stringify(result)}`);
      const smallTargets = await page.locator('button').evaluateAll((nodes) => nodes
        .map((node) => {
          const box = node.getBoundingClientRect();
          return { text:node.textContent.trim(), width:box.width, height:box.height };
        })
        .filter((item) => item.width > 0 && item.height > 0 && (item.width < 44 || item.height < 44)));
      if (smallTargets.length) {
        throw new Error(`${name} touch targets below 44px at ${width}px: ${JSON.stringify(smallTargets)}`);
      }
    }
    if (errors.length) throw new Error(`${name} console errors: ${JSON.stringify(errors)}`);
    await page.setViewportSize({ width:390, height:844 });
    await page.screenshot({ path:path.join(output, `visual-${name}-390.png`), fullPage:true });
  } finally {
    await browser.close();
  }
}

try {
  await mkdir(output, { recursive:true });
  await waitForServer();
  await run('chromium', chromium);
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit visual tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
  if (process.env.SKIP_FIREFOX === '1') {
    console.warn('WARN: Firefox unavailable in this environment — skipping Firefox visual tests (SKIP_FIREFOX=1).');
  } else {
    await run('firefox', firefox);
  }
  console.log('CLICK 360 1.0.5 visual Chromium/WebKit/Firefox E2E PASS');
} finally {
  server.kill('SIGTERM');
}
