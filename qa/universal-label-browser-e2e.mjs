import { execFileSync, spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_LABEL_E2E_PORT || 4188);
const url = `http://127.0.0.1:${port}/qa/fixtures/p2-universal-label-canvas.html`;
const output = path.join(root, 'output/playwright/p2');
const widths = [320, 360, 375, 390, 414, 430, 768, 820, 1024, 1280, 1366, 1440, 1920];
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
  throw new Error('The local label fixture did not start.');
}

function collectUnexpectedErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function assertResponsiveLayout(page, browserName) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 720 ? 900 : 850 });
    await page.waitForTimeout(40);
    const layout = await page.evaluate(() => {
      const footerBox = document.querySelector('.ulcFooter')?.getBoundingClientRect();
      const actionBox = document.querySelector('#ulcPrint')?.getBoundingClientRect();
      const simpleBox = document.querySelector('#ulcSimpleMode')?.getBoundingClientRect();
      const advancedBox = document.querySelector('#ulcAdvanced')?.getBoundingClientRect();
      const previewBox = document.querySelector('.ulcCanvasRegion, .labelPreviewDisclosure')?.getBoundingClientRect();
      return {
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        footerVisible: !!footerBox && footerBox.top >= 0 && footerBox.bottom <= innerHeight + 1,
        actionVisible: !!actionBox
          && actionBox.top >= 0
          && actionBox.bottom <= innerHeight + 1
          && actionBox.left >= 0
          && actionBox.right <= innerWidth + 1,
        simpleVisible: !!simpleBox
          && simpleBox.width > 0
          && simpleBox.height > 0
          && simpleBox.left >= 0
          && simpleBox.right <= innerWidth + 1,
        advancedVisible: !!advancedBox
          && advancedBox.width > 0
          && advancedBox.height > 0
          && advancedBox.left >= 0
          && advancedBox.right <= innerWidth + 1,
        previewVisible: !!previewBox
          && previewBox.width > 0
          && previewBox.height > 0
          && previewBox.left >= 0
          && previewBox.right <= innerWidth + 1
      };
    });
    if (layout.hasOverflow) throw new Error(`${browserName} overflow at ${width}px`);
    if (!layout.previewVisible) throw new Error(`${browserName} label preview is not visible at ${width}px`);
    if (width <= 720 && !layout.simpleVisible) throw new Error(`${browserName} simple mode button is hidden at ${width}px`);
    if (width <= 720 && !layout.advancedVisible) throw new Error(`${browserName} advanced mode button is hidden at ${width}px`);
    if (!layout.footerVisible || !layout.actionVisible) {
      throw new Error(`${browserName} primary print action is not visible at ${width}px`);
    }
  }
}

async function runChromium() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = collectUnexpectedErrors(page);
    await page.goto(url, { waitUntil: 'networkidle' });

    const first = page.locator('[data-ulc-object]').first();
    const box = await first.boundingBox();
    if (!box) throw new Error('Canvas object is not visible.');
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 38, { steps: 4 });
    await page.mouse.up();

    const resize = page.locator('[data-ulc-handle="resize"]');
    const resizeBox = await resize.boundingBox();
    if (!resizeBox) throw new Error('Resize handle is not visible.');
    await page.mouse.move(resizeBox.x + 5, resizeBox.y + 5);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + 20, resizeBox.y + 16, { steps: 3 });
    await page.mouse.up();

    const rotate = page.locator('[data-ulc-handle="rotate"]');
    const rotateBox = await rotate.boundingBox();
    if (!rotateBox) throw new Error('Rotate handle is not visible.');
    await page.mouse.move(rotateBox.x + 5, rotateBox.y + 5);
    await page.mouse.down();
    await page.mouse.move(rotateBox.x + 24, rotateBox.y + 18, { steps: 3 });
    await page.mouse.up();

    const objectCount = await page.locator('[data-ulc-object]').count();
    await page.locator('#ulcImageInput').setInputFiles(path.join(root, 'assets/logo.png'));
    await page.waitForFunction((count) => document.querySelectorAll('[data-ulc-object]').length === count + 1, objectCount);
    await page.locator('#ulcDelete').click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-ulc-object]').length === count, objectCount);

    await page.locator('#ulcSaveTemplate').click();
    await page.waitForSelector('.ulcTemplateCard');
    const savedTemplate = await page.evaluate(() => window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state().templates[0]);
    if (!savedTemplate?.universalDocument?.objects?.some((object) => object.type === 'qr')) {
      throw new Error(`Saved template did not preserve its universal QR document: ${JSON.stringify(savedTemplate)}`);
    }
    await page.locator('[data-ulc-tpl-edit]').first().click();
    await page.locator('.ulcMeasurement summary').click();
    await page.locator('#ulcProfileName').fill('Perfil QA 40x60');
    await page.locator('#ulcSaveProfile').click();
    await page.waitForFunction(() => document.querySelector('#ulcProfiles').options.length > 1);
    await page.evaluate(() => {
      const scaleX = document.querySelector('#ulcScaleX');
      const scaleY = document.querySelector('#ulcScaleY');
      scaleX.value = '1.1';
      scaleX.dispatchEvent(new Event('change', { bubbles: true }));
      scaleY.value = '0.95';
      scaleY.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const calibrated = await page.evaluate(() => {
      const object = document.querySelector('[data-ulc-object].selected');
      return {
        left: parseFloat(object.style.left),
        top: parseFloat(object.style.top),
        xMm: Number(document.querySelector('#ulcX').value),
        yMm: Number(document.querySelector('#ulcY').value),
        scaleX: Number(document.querySelector('#ulcScaleX').value),
        scaleY: Number(document.querySelector('#ulcScaleY').value)
      };
    });
    if (Math.abs(calibrated.left - calibrated.xMm * 3.779527559 * calibrated.scaleX) > 0.5
      || Math.abs(calibrated.top - calibrated.yMm * 3.779527559 * calibrated.scaleY) > 0.5) {
      throw new Error('Calibrated overlay diverged from the physical renderer.');
    }

    await page.locator('#ulcDuplicate').click();
    await page.locator('#ulcUndo').click();
    await page.locator('#ulcRedo').click();
    await page.locator('#ulcQuantity').fill('3');
    await page.locator('#ulcStartSlot').fill('2');
    await page.locator('#ulcPrint').click();
    await page.waitForSelector('#click360PrintPortal[data-ready="true"]');

    const state = await page.evaluate(() => window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state());
    if (state.print?.provider !== 'pdf' || state.print?.exactQuantity !== 3 || state.print?.pages !== 2) {
      throw new Error(`Chromium physical plan mismatch: ${JSON.stringify(state.print)}`);
    }
    if (state.print.realPdfBytes < 2000 || state.print.nonWhitePixels < 1 || state.print.qrPixels < 1) {
      throw new Error(`Chromium PDF/QR output is blank: ${JSON.stringify(state.print)}`);
    }
    if (state.errors.length || errors.length) {
      throw new Error(`Chromium unexpected errors: ${JSON.stringify([...errors, ...state.errors])}`);
    }

    await page.locator('#ulcSystemPrint').click();
    await page.waitForFunction(() => window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state().print?.provider === 'system');
    await page.locator('[data-ulc-tpl-delete]').first().click();
    await page.waitForFunction(() => {
      const state = window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state();
      return state.templates.length === 0 && state.deletedTemplates === 1;
    });

    await mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'universal-label-e2e-chromium.png'), fullPage: true });
    const pdfPath = path.join(output, 'universal-label-e2e.pdf');
    await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true });
    const pdf = await stat(pdfPath);
    if (pdf.size < 2000) throw new Error(`Generated PDF is too small: ${pdf.size} bytes.`);

    await assertResponsiveLayout(page, 'Chromium');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'universal-label-e2e-mobile-390.png'), fullPage: true });

    const pagePng = path.join(output, 'universal-label-e2e-page-1.png');
    if (process.platform === 'darwin') {
      execFileSync('sips', ['-s', 'format', 'png', pdfPath, '--out', pagePng], { stdio: 'ignore' });
      execFileSync(process.execPath, [path.join(root, 'qa/check-png-nonblank.cjs'), pagePng, '500'], { stdio: 'inherit' });
    }
  } finally {
    await browser.close();
  }
}

async function runWebKit() {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = collectUnexpectedErrors(page);
    await page.goto(url, { waitUntil: 'networkidle' });
    if (!(await page.locator('#ulcSimpleMode').isVisible())) throw new Error('WebKit mobile simple mode button is hidden.');
    if (!(await page.locator('#ulcAdvanced').isVisible())) throw new Error('WebKit mobile advanced mode button is hidden.');
    const box = await page.locator('[data-ulc-object]').first().boundingBox();
    if (!box) throw new Error('Touch object is not visible.');
    const before = Number(await page.locator('#ulcX').inputValue());
    await page.evaluate(({ startX, startY, endX, endY }) => {
      const target = document.querySelector('[data-ulc-object]');
      const stage = document.querySelector('#ulcStage');
      target.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 77, pointerType: 'touch', clientX: startX, clientY: startY
      }));
      stage.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 77, pointerType: 'touch', clientX: endX, clientY: endY
      }));
      stage.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: 77, pointerType: 'touch', clientX: endX, clientY: endY
      }));
    }, { startX: box.x + 10, startY: box.y + 10, endX: box.x + 42, endY: box.y + 36 });
    const after = Number(await page.locator('#ulcX').inputValue());
    if (after === before) throw new Error('WebKit touch drag did not change the physical X coordinate.');

    await page.locator('#ulcQuantity').fill('2');
    await page.locator('#ulcStartSlot').fill('1');
    await page.locator('#ulcPrint').click();
    await page.waitForSelector('#click360PrintPortal[data-ready="true"]');
    const state = await page.evaluate(() => window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state());
    if (state.print?.provider !== 'pdf' || state.print?.exactQuantity !== 2 || state.print?.pages !== 1
      || state.print?.nonWhitePixels < 1 || state.print?.qrPixels < 1) {
      throw new Error(`WebKit physical plan mismatch: ${JSON.stringify(state.print)}`);
    }
    if (state.errors.length || errors.length) {
      throw new Error(`WebKit unexpected errors: ${JSON.stringify([...errors, ...state.errors])}`);
    }

    await assertResponsiveLayout(page, 'WebKit');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'universal-label-e2e-webkit.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}

try {
  await mkdir(output, { recursive: true });
  await waitForServer();
  await runChromium();
  await runWebKit();
  console.log('P2 Universal Label Canvas browser E2E PASS');
} finally {
  server.kill('SIGTERM');
}
