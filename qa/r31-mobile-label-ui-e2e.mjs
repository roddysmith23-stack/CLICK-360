import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_R31_MOBILE_PORT || 4199);
const output = path.join(root, 'output/playwright/release-1.0.5');
// Cases required by the r31 QA mandate: iPhone SE, common Android/iOS widths, iPhone 14 Pro Max.
const viewports = [
  { width: 320, height: 568, label: '320' },
  { width: 360, height: 800, label: '360' },
  { width: 375, height: 812, label: '375' },
  { width: 390, height: 844, label: '390' },
  { width: 430, height: 932, label: '430' }
];
const fixtures = [
  { name: 'simple-label', path: '/qa/fixtures/r30-label-simple.html', root: '.quickLabelHome', interactive: '.quickLabelHome button,.quickLabelHome input,.quickLabelHome select' },
  { name: 'advanced-wizard', path: '/qa/fixtures/p1-5c-smart-print-visual.html', root: '.labelEditorModal', interactive: '.labelEditorModal button,.labelEditorModal input,.labelEditorModal select' },
  { name: 'universal-canvas', path: '/qa/fixtures/p2-universal-label-canvas.html', root: '.universalLabelCanvasModal', interactive: '.universalLabelCanvasModal button' }
];

const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd: root, stdio: 'ignore' });

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`fixture did not start: ${url}`);
}

async function checkFixture(browserName, browserType, fixture) {
  const url = `http://127.0.0.1:${port}${fixture.path}`;
  await waitForServer(url);
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil: 'networkidle' });
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(60);
      const result = await page.evaluate(({ rootSelector, interactiveSelector }) => {
        const root = document.documentElement;
        const modal = document.querySelector(rootSelector);
        const modalRect = modal?.getBoundingClientRect();
        const controls = [...document.querySelectorAll(interactiveSelector)].map((node) => {
          const r = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, visible: style.display !== 'none' && style.visibility !== 'hidden' };
        }).filter((box) => box.visible && box.width > 0 && box.height > 0);
        return {
          scrollWidth: root.scrollWidth,
          clientWidth: root.clientWidth,
          modal: modalRect && { left: modalRect.left, right: modalRect.right, width: modalRect.width },
          controls
        };
      }, { rootSelector: fixture.root, interactiveSelector: fixture.interactive });

      if (result.scrollWidth > result.clientWidth + 1) {
        throw new Error(`${fixture.name}/${browserName} horizontal page overflow at ${viewport.label}px (scrollWidth=${result.scrollWidth} > clientWidth=${result.clientWidth})`);
      }
      if (!result.modal || result.modal.left < -1 || result.modal.right > viewport.width + 1) {
        throw new Error(`${fixture.name}/${browserName} modal leaves the viewport at ${viewport.label}px`);
      }
      if (!result.controls.length) {
        throw new Error(`${fixture.name}/${browserName} no visible interactive controls found at ${viewport.label}px`);
      }
      for (const box of result.controls) {
        if (box.left < -1 || box.right > viewport.width + 1) {
          throw new Error(`${fixture.name}/${browserName} a control is clipped outside the viewport at ${viewport.label}px (left=${box.left} right=${box.right})`);
        }
      }
      if (browserName === 'chromium') {
        await mkdir(output, { recursive: true });
        await page.screenshot({ path: path.join(output, `r31-${fixture.name}-${viewport.label}.png`) });
      }
    }
    if (errors.length) throw new Error(`${fixture.name}/${browserName} console errors: ${JSON.stringify(errors)}`);
  } finally {
    await browser.close();
  }
}

try {
  for (const fixture of fixtures) {
    await checkFixture('chromium', chromium, fixture);
    await checkFixture('webkit', webkit, fixture);
    await checkFixture('firefox', firefox, fixture);
  }
  console.log('CLICK360_R31_MOBILE_LABEL_UI_E2E: PASS');
} finally {
  server.kill('SIGTERM');
}
