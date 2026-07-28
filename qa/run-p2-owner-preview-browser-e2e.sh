#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${CLICK360_OWNER_PREVIEW_PORT:-4204}
URL="http://127.0.0.1:${PORT}/owner-preview.html"
CODEX_HOME=${CODEX_HOME:-"$HOME/.codex"}
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
OUT="$ROOT/output/playwright/p2/owner-preview"
SERVER_LOG="$OUT/server.log"

mkdir -p "$OUT"

cleanup() {
  "$PWCLI" --session click360-owner-preview-chromium close >/dev/null 2>&1 || true
  "$PWCLI" --session click360-owner-preview-webkit close >/dev/null 2>&1 || true
  if [ "${SERVER_PID:-}" != "" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

command -v npx >/dev/null 2>&1
test -x "$PWCLI"

cd "$ROOT"
npm run build:static >/dev/null
CLICK360_OWNER_PREVIEW_PORT="$PORT" node scripts/serve-owner-preview.mjs >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

attempt=0
until curl -fsS "$URL" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 30 ]; then
    cat "$SERVER_LOG" >&2 || true
    echo "The P2 owner preview did not start." >&2
    exit 1
  fi
  sleep 1
done

exercise() {
  browser=$1
  session=$2
  mobile=${3:-}
  "$PWCLI" --session "$session" close >/dev/null 2>&1 || true
  "$PWCLI" --session "$session" open "$URL" --browser="$browser" $mobile >/dev/null
  "$PWCLI" --session "$session" run-code "async page => {
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.waitForFunction(() => !!window.__CLICK360_OWNER_PREVIEW__);
    const contract = await page.evaluate(() => ({ preview:window.__CLICK360_OWNER_PREVIEW__, firebase:typeof window.firebase, db:typeof window.click360Db }));
    if (contract.firebase !== 'undefined' || contract.db !== 'undefined') throw new Error('preview exposed Firebase globals');
    if (contract.preview.firebaseCalls !== 0 || contract.preview.functionsCalls !== 0 || contract.preview.serviceWorkerRegistered !== false) throw new Error('preview isolation contract failed');
    for (const route of ['home','sell','inventory','cash','reports','workers','restaurant','kitchen','logistics','routes','settlements','admin']) {
      await page.locator('[data-preview-route=\"' + route + '\"]:visible').first().click();
      await page.waitForTimeout(30);
      const title = await page.locator('.ownerPreviewTop h1').textContent();
      if (!title) throw new Error('route did not render: ' + route);
    }
    await page.locator('[data-preview-route=\"workers\"]:visible').first().click();
    await page.locator('[data-preview-action=\"invite-worker\"]').click();
    await page.locator('[data-preview-route=\"restaurant\"]:visible').first().click();
    await page.locator('[data-preview-action=\"table\"]').first().click();
    await page.locator('[data-preview-route=\"kitchen\"]:visible').first().click();
    await page.locator('[data-preview-action=\"ticket\"]').first().click();
    await page.locator('[data-preview-route=\"logistics\"]:visible').first().click();
    await page.locator('[data-preview-action=\"route\"]').first().click();
    await page.locator('[data-preview-route=\"labels\"]:visible').first().click();
    await page.waitForSelector('#ulcStage');
    const first = page.locator('[data-ulc-object]').first();
    const box = await first.boundingBox();
    if (!box) throw new Error('universal canvas object not visible');
    await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down(); await page.mouse.move(box.x + 28, box.y + 22, { steps:3 }); await page.mouse.up();
    await page.locator('#ulcUndo').click();
    await page.locator('[data-ulc-add=\"text\"]').click();
    await page.locator('#ulcDuplicate').click();
    await page.locator('#ulcUndo').click();
    await page.locator('#ulcRedo').click();
    await page.locator('#ulcDelete').click();
    await page.locator('[data-ulc-object]').nth(4).click();
    await page.locator('#ulcDelete').click();
    await page.locator('#ulcQuantity').fill('2');
    await page.locator('#ulcStartSlot').fill('1');
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width < 720 ? 900 : 860 });
      await page.waitForTimeout(40);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error('overflow at ' + width + 'px');
    }
    await page.setViewportSize({ width:1440, height:900 });
    await page.screenshot({ path:'output/playwright/p2/owner-preview/' + '$browser' + '-desktop.png' });
    await page.setViewportSize({ width:390, height:844 });
    await page.screenshot({ path:'output/playwright/p2/owner-preview/' + '$browser' + '-mobile.png' });
    const external = requests.filter(url => !url.startsWith('http://127.0.0.1:${PORT}/'));
    if (external.length) throw new Error('unexpected external request: ' + external.join(', '));
    if (errors.length) throw new Error('unexpected page errors: ' + errors.join(' | '));
  }"
}

exercise chrome click360-owner-preview-chromium
exercise webkit click360-owner-preview-webkit --mobile
echo "P2 owner preview browser E2E PASS"
