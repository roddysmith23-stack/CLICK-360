import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_LABEL_WIZARD_E2E_PORT || 4194);
const url = `http://127.0.0.1:${port}/qa/fixtures/p1-5c-smart-print-visual.html`;
const output = path.join(root, 'output/playwright/release-1.0.5');
const widths = [320, 360, 390, 430, 768, 1024, 1366];

const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], {
  cwd: root,
  stdio: 'ignore'
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The label wizard fixture did not start.');
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

function assertBox(name, box, viewportWidth) {
  if (!box || box.width <= 0 || box.height <= 0) throw new Error(`${name} is not visible`);
  if (box.left < -1 || box.right > viewportWidth + 1) throw new Error(`${name} leaves viewport horizontally`);
}

async function evaluateLayout(page, width, browserName) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 820 });
  await page.waitForTimeout(40);
  const result = await page.evaluate(() => {
    const box = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top:rect.top, right:rect.right, bottom:rect.bottom, left:rect.left, width:rect.width, height:rect.height };
    };
    const modal = box('.labelEditorModal');
    const rail = box('.labelWizardRail');
    const layout = box('.labelCustomizerLayout');
    const preview = box('.labelPreviewDisclosure');
    const controls = box('.labelControls');
    const footer = box('.smartWizardFooter');
    const next = box('#smartPrintNext');
    const back = box('#smartPrintBack');
    const help = box('#smartPrintHelp');
    const simple = box('.labelModeSwitch button:first-child');
    const expert = box('.labelModeSwitch button:last-child');
    const step = box('.smartPrintSteps .active');
    const beforePreviewTop = preview?.top || 0;
    const controlsNode = document.querySelector('.labelControls');
    if (controlsNode) controlsNode.scrollTop = controlsNode.scrollHeight;
    const afterPreviewTop = document.querySelector('.labelPreviewDisclosure')?.getBoundingClientRect().top || 0;
    return {
      scrollWidth:document.documentElement.scrollWidth,
      clientWidth:document.documentElement.clientWidth,
      viewportHeight:window.innerHeight,
      modal,
      rail,
      layout,
      preview,
      controls,
      footer,
      next,
      back,
      help,
      simple,
      expert,
      step,
      previewStable:Math.abs(beforePreviewTop - afterPreviewTop) < 2,
      controlsScrollable:!!controlsNode && controlsNode.scrollHeight >= controlsNode.clientHeight,
      corePass:document.documentElement.dataset.corePass === 'true',
      canvasPixels:Array.from(document.querySelector('#fixtureLabelCanvas').getContext('2d').getImageData(0, 0, 8, 8).data).some((value) => value !== 0)
    };
  });

  if (result.scrollWidth > result.clientWidth + 1) throw new Error(`${browserName} horizontal overflow at ${width}px`);
  for (const [name, value] of Object.entries({
    modal:result.modal,
    rail:result.rail,
    layout:result.layout,
    preview:result.preview,
    controls:result.controls,
    footer:result.footer,
    next:result.next,
    back:result.back,
    help:result.help,
    simple:result.simple,
    expert:result.expert,
    step:result.step
  })) {
    assertBox(name, value, width);
  }
  if (result.rail.bottom > result.layout.top + 1) throw new Error(`${browserName} rail overlaps editor body at ${width}px`);
  if (result.layout.bottom > result.footer.top + 1) throw new Error(`${browserName} editor body overlaps footer at ${width}px`);
  for (const [name, button] of [['next', result.next], ['back', result.back], ['help', result.help]]) {
    if (button.top < result.footer.top - 1 || button.bottom > result.footer.bottom + 1) throw new Error(`${browserName} ${name} button leaves footer at ${width}px`);
    if (button.bottom > result.viewportHeight + 1) throw new Error(`${browserName} ${name} button leaves viewport at ${width}px`);
  }
  if (width < 900 && result.preview.bottom > result.controls.top + 1) {
    throw new Error(`${browserName} mobile preview overlaps controls at ${width}px`);
  }
  if (width >= 900 && result.preview.right > result.controls.left + 1) {
    throw new Error(`${browserName} desktop preview overlaps controls at ${width}px`);
  }
  if (!result.previewStable) throw new Error(`${browserName} preview does not stay visible while controls scroll at ${width}px`);
  if (!result.controlsScrollable) throw new Error(`${browserName} controls are not independently scrollable at ${width}px`);
  if (!result.corePass || !result.canvasPixels) throw new Error(`${browserName} fixture content did not render at ${width}px`);
}

async function run(browserName, browserType) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    const errors = collectErrors(page);
    await page.goto(url, { waitUntil:'networkidle' });
    for (const width of widths) await evaluateLayout(page, width, browserName);
    if (errors.length) throw new Error(`${browserName} console errors: ${JSON.stringify(errors)}`);
    await page.setViewportSize({ width:390, height:844 });
    await mkdir(output, { recursive:true });
    await page.screenshot({ path:path.join(output, `label-wizard-${browserName}-390.png`), fullPage:true });
    await page.setViewportSize({ width:1366, height:820 });
    await page.screenshot({ path:path.join(output, `label-wizard-${browserName}-1366.png`), fullPage:true });
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium);
  if (process.env.SKIP_WEBKIT === '1') {
    console.warn('WARN: WebKit unavailable in this environment — skipping WebKit label wizard tests (SKIP_WEBKIT=1).');
  } else {
    await run('webkit', webkit);
  }
  if (process.env.SKIP_FIREFOX === '1') {
    console.warn('WARN: Firefox unavailable in this environment — skipping Firefox label wizard tests (SKIP_FIREFOX=1).');
  } else {
    await run('firefox', firefox);
  }
  console.log('CLICK 360 label wizard layout E2E PASS');
} finally {
  server.kill('SIGTERM');
}
