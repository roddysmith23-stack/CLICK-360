#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${CLICK360_LABEL_E2E_PORT:-4188}
URL="http://127.0.0.1:${PORT}/qa/fixtures/p2-universal-label-canvas.html"
CODEX_HOME=${CODEX_HOME:-"$HOME/.codex"}
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
OUT="$ROOT/output/playwright/p2"
SERVER_LOG="$OUT/browser-e2e-server.log"
CHROMIUM_SESSION="click360-label-e2e-chromium"
WEBKIT_SESSION="click360-label-e2e-webkit"

mkdir -p "$OUT"

cleanup() {
  "$PWCLI" --session "$CHROMIUM_SESSION" close >/dev/null 2>&1 || true
  "$PWCLI" --session "$WEBKIT_SESSION" close >/dev/null 2>&1 || true
  if [ "${SERVER_PID:-}" != "" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

command -v npx >/dev/null 2>&1
test -x "$PWCLI"

cd "$ROOT"
npx --yes http-server . -p "$PORT" -c-1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

attempt=0
until curl -fsS "$URL" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 30 ]; then
    echo "The local label fixture did not start." >&2
    exit 1
  fi
  sleep 1
done

run_chromium() {
  "$PWCLI" --session "$CHROMIUM_SESSION" close >/dev/null 2>&1 || true
  "$PWCLI" --session "$CHROMIUM_SESSION" open "$URL" --browser=chrome >/dev/null
  "$PWCLI" --session "$CHROMIUM_SESSION" snapshot >/dev/null
  "$PWCLI" --session "$CHROMIUM_SESSION" run-code "async page => {
    const first = page.locator('[data-ulc-object]').first();
    const box = await first.boundingBox();
    if (!box) throw new Error('canvas object is not visible');
    await page.mouse.move(box.x + 8, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 38, { steps: 4 });
    await page.mouse.up();
  }"
  "$PWCLI" --session "$CHROMIUM_SESSION" run-code "async page => {
    const resize = page.locator('[data-ulc-handle=\"resize\"]');
    const resizeBox = await resize.boundingBox();
    if (!resizeBox) throw new Error('resize handle is not visible');
    await page.mouse.move(resizeBox.x + 5, resizeBox.y + 5); await page.mouse.down();
    await page.mouse.move(resizeBox.x + 20, resizeBox.y + 16, { steps: 3 }); await page.mouse.up();
    const rotate = page.locator('[data-ulc-handle=\"rotate\"]');
    const rotateBox = await rotate.boundingBox();
    if (!rotateBox) throw new Error('rotate handle is not visible');
    await page.mouse.move(rotateBox.x + 5, rotateBox.y + 5); await page.mouse.down();
    await page.mouse.move(rotateBox.x + 24, rotateBox.y + 18, { steps: 3 }); await page.mouse.up();
    const objectCount = await page.locator('[data-ulc-object]').count();
    await page.locator('#ulcImageInput').setInputFiles('assets/logo.png');
    await page.waitForFunction((count) => document.querySelectorAll('[data-ulc-object]').length === count + 1, objectCount);
    await page.locator('#ulcDelete').click();
    await page.waitForFunction((count) => document.querySelectorAll('[data-ulc-object]').length === count, objectCount);
    await page.locator('#ulcSaveTemplate').click();
    await page.waitForFunction(() => document.querySelector('#ulcTemplates').options.length > 1);
    await page.locator('#ulcTemplates').selectOption({ index: 1 });
    await page.locator('.ulcMeasurement summary').click();
    await page.locator('#ulcProfileName').fill('Perfil QA 40x60');
    await page.locator('#ulcSaveProfile').click();
    await page.waitForFunction(() => document.querySelector('#ulcProfiles').options.length > 1);
    await page.evaluate(() => {
      const scaleX = document.querySelector('#ulcScaleX');
      const scaleY = document.querySelector('#ulcScaleY');
      scaleX.value = '1.1'; scaleX.dispatchEvent(new Event('change', { bubbles:true }));
      scaleY.value = '0.95'; scaleY.dispatchEvent(new Event('change', { bubbles:true }));
    });
    const calibrated = await page.evaluate(() => {
      const object = document.querySelector('[data-ulc-object].selected');
      const xMm = Number(document.querySelector('#ulcX').value);
      const yMm = Number(document.querySelector('#ulcY').value);
      const scaleX = Number(document.querySelector('#ulcScaleX').value);
      const scaleY = Number(document.querySelector('#ulcScaleY').value);
      return { left:parseFloat(object.style.left), top:parseFloat(object.style.top), xMm, yMm, scaleX, scaleY };
    });
    if (Math.abs(calibrated.left - calibrated.xMm * 3.779527559 * calibrated.scaleX) > 0.5 || Math.abs(calibrated.top - calibrated.yMm * 3.779527559 * calibrated.scaleY) > 0.5) throw new Error('calibrated overlay diverged from the physical renderer');
  }"
  "$PWCLI" --session "$CHROMIUM_SESSION" run-code "async page => {
    await page.locator('#ulcDuplicate').click();
    await page.locator('#ulcUndo').click();
    await page.locator('#ulcRedo').click();
    await page.locator('#ulcQuantity').fill('3');
    await page.locator('#ulcStartSlot').fill('2');
    await page.locator('#ulcOutput').selectOption('pdf');
    await page.locator('#ulcPrint').click();
    await page.waitForSelector('#click360PrintPortal[data-ready=\"true\"]');
  }"
  "$PWCLI" --session "$CHROMIUM_SESSION" run-code "async page => {
    await page.screenshot({ path: 'output/playwright/p2/universal-label-e2e-chromium.png', fullPage: true });
    await page.pdf({ path: 'output/playwright/p2/universal-label-e2e.pdf', printBackground: true, preferCSSPageSize: true });
  }"
  chromium_state=$("$PWCLI" --session "$CHROMIUM_SESSION" eval "() => JSON.stringify(window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state())")
  printf '%s\n' "$chromium_state"
  printf '%s' "$chromium_state" | grep -q '\\"exactQuantity\\":3'
  printf '%s' "$chromium_state" | grep -q '\\"pages\\":2'
  printf '%s' "$chromium_state" | grep -q '\\"nonWhitePixels\\":[1-9]'
  printf '%s' "$chromium_state" | grep -q '\\"qrPixels\\":[1-9]'
  printf '%s' "$chromium_state" | grep -q '\\"errors\\":\[\]'
  "$PWCLI" --session "$CHROMIUM_SESSION" run-code "async page => {
    const state = await page.evaluate(() => window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error('Chromium overflow detected');
    for (const width of [320, 360, 390, 430, 768, 1024, 1366, 1440]) {
      await page.setViewportSize({ width, height: width < 720 ? 900 : 850 });
      await page.waitForTimeout(40);
      const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (hasOverflow) throw new Error('Chromium overflow at ' + width + 'px');
    }
    await page.setViewportSize({ width:390, height:844 });
    await page.screenshot({ path: 'output/playwright/p2/universal-label-e2e-mobile-390.png', fullPage: true });
  }"
  test -s "$OUT/universal-label-e2e.pdf"
  test "$(wc -c < "$OUT/universal-label-e2e.pdf")" -gt 2000
  node - "$OUT/universal-label-e2e.pdf" <<'NODE'
const assert = require('node:assert');
const fs = require('node:fs');
const pdf = fs.readFileSync(process.argv[2]);
assert(pdf.subarray(0, 4).toString('ascii') === '%PDF', 'generated artifact is a PDF');
assert(pdf.length > 2000, 'generated PDF has meaningful content');
const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
assert(pages === 2, `expected two physical PDF pages, found ${pages}`);
NODE
  if command -v sips >/dev/null 2>&1; then
    sips -s format png "$OUT/universal-label-e2e.pdf" --out "$OUT/universal-label-e2e-page-1.png" >/dev/null
  elif command -v pdftoppm >/dev/null 2>&1; then
    pdftoppm -f 1 -l 1 -singlefile -png "$OUT/universal-label-e2e.pdf" "$OUT/universal-label-e2e-page-1"
  else
    echo "No supported local PDF rasterizer is available." >&2
    exit 1
  fi
  node qa/check-png-nonblank.cjs "$OUT/universal-label-e2e-page-1.png" 500
}

run_webkit() {
  "$PWCLI" --session "$WEBKIT_SESSION" close >/dev/null 2>&1 || true
  "$PWCLI" --session "$WEBKIT_SESSION" open "$URL" --browser=webkit --mobile >/dev/null
  "$PWCLI" --session "$WEBKIT_SESSION" snapshot >/dev/null
  "$PWCLI" --session "$WEBKIT_SESSION" run-code "async page => {
    const box = await page.locator('[data-ulc-object]').first().boundingBox();
    if (!box) throw new Error('touch object is not visible');
    await page.evaluate(({ startX, startY, endX, endY }) => {
      const target = document.querySelector('[data-ulc-object]');
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerId:77, pointerType:'touch', clientX:startX, clientY:startY }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, pointerId:77, pointerType:'touch', clientX:endX, clientY:endY }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:77, pointerType:'touch', clientX:endX, clientY:endY }));
    }, { startX:box.x + 10, startY:box.y + 10, endX:box.x + 42, endY:box.y + 36 });
  }"
  "$PWCLI" --session "$WEBKIT_SESSION" run-code "async page => {
    await page.locator('#ulcQuantity').fill('2');
    await page.locator('#ulcStartSlot').fill('1');
    await page.locator('#ulcPrint').click();
    await page.waitForSelector('#click360PrintPortal[data-ready=\"true\"]');
  }"
  "$PWCLI" --session "$WEBKIT_SESSION" run-code "async page => {
    await page.screenshot({ path: 'output/playwright/p2/universal-label-e2e-webkit.png', fullPage: true });
  }"
  webkit_state=$("$PWCLI" --session "$WEBKIT_SESSION" eval "() => JSON.stringify(window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state())")
  printf '%s\n' "$webkit_state"
  printf '%s' "$webkit_state" | grep -q '\\"exactQuantity\\":2'
  printf '%s' "$webkit_state" | grep -q '\\"pages\\":1'
  printf '%s' "$webkit_state" | grep -q '\\"nonWhitePixels\\":[1-9]'
  printf '%s' "$webkit_state" | grep -q '\\"qrPixels\\":[1-9]'
  printf '%s' "$webkit_state" | grep -q '\\"errors\\":\[\]'
  "$PWCLI" --session "$WEBKIT_SESSION" run-code "async page => {
    const state = await page.evaluate(() => window.__CLICK360_P2_UNIVERSAL_LABEL_QA__.state());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error('WebKit overflow detected');
  }"
}

run_chromium
run_webkit
echo "P2 Universal Label Canvas browser E2E PASS"
