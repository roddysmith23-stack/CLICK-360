#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${CLICK360_P2_MODULE_VISUAL_PORT:-4192}
BASE_URL="http://127.0.0.1:${PORT}/qa/fixtures"
CODEX_HOME=${CODEX_HOME:-"$HOME/.codex"}
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
OUT="$ROOT/output/playwright/p2/modules"
SERVER_LOG="$OUT/browser-e2e-server.log"

mkdir -p "$OUT"

cleanup() {
  for session in p2-module-chrome p2-module-webkit; do
    "$PWCLI" --session "$session" close >/dev/null 2>&1 || true
  done
  if [ "${SERVER_PID:-}" != "" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

test -x "$PWCLI"
cd "$ROOT"
npx --yes http-server . -p "$PORT" -c-1 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

attempt=0
until curl -fsS "$BASE_URL/p2-platform-workers-visual.html" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 30 ]; then
    echo "The P2 visual fixtures did not start." >&2
    exit 1
  fi
  sleep 1
done

exercise_fixture() {
  browser=$1
  session=$2
  fixture=$3
  interaction=$4
  url="$BASE_URL/$fixture"
  "$PWCLI" --session "$session" close >/dev/null 2>&1 || true
  "$PWCLI" --session "$session" open "$url" --browser="$browser" ${5:-} >/dev/null
  "$PWCLI" --session "$session" run-code "async page => {
    await page.evaluate(() => {
      window.__click360QaErrors = [];
      window.addEventListener('error', (event) => window.__click360QaErrors.push(String(event.message || 'window_error')));
      window.addEventListener('unhandledrejection', (event) => window.__click360QaErrors.push(String(event.reason?.message || event.reason || 'unhandled_rejection')));
    });
    $interaction
    for (const width of [320, 360, 390, 430, 768, 1024, 1366, 1440]) {
      await page.setViewportSize({ width, height: width < 720 ? 900 : 850 });
      await page.waitForTimeout(45);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (overflow) throw new Error('$fixture overflow at ' + width + 'px');
    }
    const errors = await page.evaluate(() => window.__click360QaErrors || []);
    if (errors.length) throw new Error('$fixture unexpected errors: ' + errors.join(' | '));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'output/playwright/p2/modules/$browser-$fixture-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'output/playwright/p2/modules/$browser-$fixture-desktop.png', fullPage: true });
  }"
}

platform_interaction="await page.locator('#workerToggle').click(); await page.locator('#inviteButton').click(); await page.waitForSelector('#inviteStatus:not([hidden])');"
restaurant_interaction="await page.locator('#kdsButton').click(); await page.locator('#openOrder').click(); await page.locator('#acceptButton').click(); await page.locator('#paymentButton').click();"
logistics_interaction="await page.locator('#newRoute').click(); await page.locator('#openRoute').click(); await page.locator('#saleButton').click(); await page.locator('#settlementButton').click();"

for browser in chrome webkit; do
  session="p2-module-$browser"
  mobile=""
  if [ "$browser" = "webkit" ]; then mobile="--mobile"; fi
  exercise_fixture "$browser" "$session" "p2-platform-workers-visual.html" "$platform_interaction" "$mobile"
  exercise_fixture "$browser" "$session" "p2-restaurant-advanced-visual.html" "$restaurant_interaction" "$mobile"
  exercise_fixture "$browser" "$session" "p2-logistics-routes-settlement-visual.html" "$logistics_interaction" "$mobile"
done

echo "P2 module visual browser E2E PASS"
