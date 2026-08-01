import { execFileSync, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.CLICK360_PRINTING_PDF_E2E_PORT || 4192);
const url = `http://127.0.0.1:${port}/qa/fixtures/printing-service-pdf-provider.html`;
const output = path.join(root, 'output/playwright/release-1.0.5');
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
  throw new Error('Printing PDF fixture did not start.');
}

function firstExisting(paths) {
  return paths.find((candidate) => {
    try {
      execFileSync('test', ['-f', candidate], { stdio:'ignore' });
      return true;
    } catch {
      return false;
    }
  }) || '';
}

async function verifyPdfPixels(pdfPath, basename) {
  const pngPrefix = path.join(output, basename);
  const pngSingle = `${pngPrefix}.png`;
  const pngFirst = `${pngPrefix}-1.png`;
  try {
    execFileSync('pdftoppm', ['-png', '-singlefile', pdfPath, pngPrefix], { stdio:'ignore' });
    await access(pngSingle);
    execFileSync(process.execPath, [path.join(root, 'qa/check-png-nonblank.cjs'), pngSingle, '500'], { stdio:'inherit' });
    return pngSingle;
  } catch (error) {
    execFileSync('pdftoppm', ['-png', pdfPath, pngPrefix], { stdio:'ignore' });
    const pngPath = firstExisting([pngFirst, pngSingle]);
    if (!pngPath) throw error;
    execFileSync(process.execPath, [path.join(root, 'qa/check-png-nonblank.cjs'), pngPath, '500'], { stdio:'inherit' });
    return pngPath;
  }
}

try {
  await mkdir(output, { recursive:true });
  await waitForServer();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ acceptDownloads:true, viewport:{ width:1024, height:768 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url, { waitUntil:'networkidle' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
    async function verifyPdf(buttonSelector, basename, minimumBytes) {
      const downloadPromise = page.waitForEvent('download', { timeout:15000 });
      await page.locator(buttonSelector).click();
      const download = await downloadPromise;
      const pdfPath = path.join(output, `${basename}.pdf`);
      await download.saveAs(pdfPath);
      const pdf = await stat(pdfPath);
      if (pdf.size < minimumBytes) throw new Error(`${basename} output is too small or blank: ${pdf.size} bytes.`);
      await verifyPdfPixels(pdfPath, basename);
      return pdf.size;
    }
    const labelSize = await verifyPdf('#runPdf', 'printing-service-pdf-provider', 2500);
    const receiptSize = await verifyPdf('#runReceiptPdf', 'printing-service-receipt-pdf-provider', 2200);
    const downloads = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await page.evaluate(() => {
      window.__click360PrintCalls = 0;
      window.print = () => {
        window.__click360PrintCalls += 1;
        window.dispatchEvent(new Event('afterprint'));
      };
    });
    await page.locator('#runReceiptSystemPrint').click();
    await page.waitForFunction(() => window.__click360PrintCalls === 1);
    await page.waitForTimeout(350);
    if (downloads.length) throw new Error(`Receipt system print unexpectedly downloaded a file: ${downloads.join(', ')}`);
    const portalState = await page.evaluate(() => {
      const portal = document.getElementById('click360PrintPortal');
      return {
        printCalls: window.__click360PrintCalls,
        childCount: portal?.childElementCount || 0,
        inlineStyle: portal?.getAttribute('style') || '',
        media: portal?.dataset.printMedia || ''
      };
    });
    if (portalState.childCount !== 0 || portalState.inlineStyle || portalState.media) {
      throw new Error(`Receipt system print did not clean the print portal: ${JSON.stringify(portalState)}`);
    }
    if (errors.length) throw new Error(`Printing PDF unexpected browser errors: ${JSON.stringify(errors)}`);
    console.log(`CLICK 360 printing-service PDF/system provider E2E PASS: label=${labelSize} bytes receipt=${receiptSize} bytes systemPrintCalls=${portalState.printCalls}`);
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
