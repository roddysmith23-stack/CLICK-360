import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { chromium, firefox, webkit } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_R30_SIMPLE_PORT || 4197);
const url = `http://127.0.0.1:${port}/qa/fixtures/r30-label-simple.html`;
const widths = [320, 360, 375, 390, 430, 768, 1366];
const server = spawn(process.execPath, [path.join(root, 'node_modules/http-server/bin/http-server'), '.', '-p', String(port), '-c-1'], { cwd:root, stdio:'ignore' });

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('r30 simple label fixture did not start');
}

async function run(name, type) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url, { waitUntil:'networkidle' });
    for (const width of widths) {
      await page.setViewportSize({ width, height:width < 768 ? 844 : 820 });
      const result = await page.evaluate(() => {
        const root = document.documentElement;
        const simple = document.querySelector('[data-r30-simple-label="true"]');
        const modal = document.querySelector('.modal');
        const buttons = [...document.querySelectorAll('.quickLabelHome button')].map((node) => {
          const r = node.getBoundingClientRect();
          return { text:node.textContent.trim(), left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
        });
        const inputs = [...document.querySelectorAll('.quickLabelHome input,.quickLabelHome select')].map((node) => {
          const r = node.getBoundingClientRect();
          return { left:r.left, right:r.right, width:r.width };
        });
        const rect = simple?.getBoundingClientRect();
        const modalRect = modal?.getBoundingClientRect();
        return {
          scrollWidth:root.scrollWidth,
          clientWidth:root.clientWidth,
          simple:rect && { left:rect.left, right:rect.right, width:rect.width },
          modal:modalRect && { left:modalRect.left, right:modalRect.right, width:modalRect.width },
          buttons, inputs,
          hasStepper:!!document.querySelector('.smartPrintProgress,.smartPrintSteps,.labelWizardRail'),
          labels:[...document.querySelectorAll('.quickLabelHome button')].map((node) => node.textContent.trim())
        };
      });
      if (result.scrollWidth > result.clientWidth + 1) throw new Error(`${name} horizontal page overflow at ${width}`);
      if (!result.simple || result.simple.left < -1 || result.simple.right > width + 1) throw new Error(`${name} simple panel outside viewport at ${width}`);
      if (!result.modal || result.modal.left < -1 || result.modal.right > width + 1) throw new Error(`${name} modal outside viewport at ${width}`);
      for (const box of [...result.buttons, ...result.inputs]) {
        if (box.left < -1 || box.right > width + 1 || box.width <= 0) throw new Error(`${name} control outside viewport at ${width}`);
      }
      if (result.hasStepper) throw new Error(`${name} simple screen exposes the 9-step wizard at ${width}`);
      for (const required of ['Imprimir','PDF','Editar plantilla','Configuración avanzada']) {
        if (!result.labels.some((label) => label.includes(required))) throw new Error(`${name} missing ${required}`);
      }
    }
    if (errors.length) throw new Error(`${name} console errors: ${JSON.stringify(errors)}`);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await run('chromium', chromium);
  await run('webkit', webkit);
  await run('firefox', firefox);
  console.log('CLICK360_R30_LABEL_SIMPLE_E2E: PASS');
} finally {
  server.kill('SIGTERM');
}
