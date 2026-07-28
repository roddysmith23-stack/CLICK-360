#!/usr/bin/env sh
set -euo pipefail

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT=${CLICK360_P2_CLOUD_BROWSER_PORT:-4196}
URL="http://127.0.0.1:${PORT}/qa/fixtures/p2-cloud-multiuser.html"
RUN_TOKEN=${CLICK360_P2_BROWSER_RUN_TOKEN:-"$(date +%s)-$$"}
CODEX_HOME=${CODEX_HOME:-"$HOME/.codex"}
PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
OUT="$ROOT/output/playwright/p2/cloud"
FIXTURE="$ROOT/output/p2-cloud-browser-fixture.json"

mkdir -p "$OUT"
cleanup() {
  for session in p2-cloud-browser-chrome p2-cloud-browser-webkit p2-cloud-browser-kitchen p2-cloud-browser-refresh; do "$PWCLI" --session "$session" close >/dev/null 2>&1 || true; done
  rm -f "$FIXTURE"
  if [ "${SERVER_PID:-}" != "" ]; then kill "$SERVER_PID" >/dev/null 2>&1 || true; wait "$SERVER_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

test -x "$PWCLI"
cd "$ROOT"
node qa/p2-cloud-static-server.cjs "$PORT" >"$OUT/server.log" 2>&1 &
SERVER_PID=$!
attempt=0
until curl -fsS "$URL" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 30 ]; then echo "P2 browser fixture failed to start." >&2; exit 1; fi
  sleep 1
done

run_code() {
  target_session=$1
  code=$2
  result=$("$PWCLI" --session "$target_session" run-code "$code" 2>&1) || { printf '%s\n' "$result"; return 1; }
  printf '%s\n' "$result"
  if printf '%s\n' "$result" | grep -q '^### Error'; then return 1; fi
}

run_browser() {
  browser=$1
  session=$2
  mobile=$3
  P2_BROWSER_RUN="$browser-$RUN_TOKEN" node functions/qa/p2-cloud-browser-fixture-seed.cjs
  "$PWCLI" --session "$session" close >/dev/null 2>&1 || true
  "$PWCLI" --session "$session" open "$URL" --browser="$browser" $mobile >/dev/null
  run_code "$session" "async page => {
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.signIn('server'));
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.watchOrder('order-browser-001'));
    const created = await page.evaluate(async () => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('createRestaurantOrder', { businessId:fixture.businessId, orderId:'order-browser-001', tableId:'table-browser-001', send:true, items:[{ id:'line-browser-001', productId:'product-browser', name:'Producto QA', qty:2, unitPrice:10, area:'kitchen' }] }, 'browser_order_001'); });
    if (created.status !== 200) throw new Error('server order creation failed:' + JSON.stringify(created));
    const received = await page.waitForFunction(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.state().listenerEvents.some((event) => event.startsWith('sent:')), null, { timeout: 8000 }).then(() => true).catch(() => false);
    if (!received) throw new Error('Firestore listener did not receive server order:' + JSON.stringify(await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.state().listenerEvents)));
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource: The network connection was lost/.test(message));
    if (unexpectedConsoleErrors.length) throw new Error('unexpected console errors:' + unexpectedConsoleErrors.join('|'));
    return { browser:'$browser', syncTransport:'listener' };
  }"
  "$PWCLI" --session p2-cloud-browser-kitchen close >/dev/null 2>&1 || true
  "$PWCLI" --session p2-cloud-browser-kitchen open "$URL" --browser="$browser" $mobile >/dev/null
  run_code p2-cloud-browser-kitchen "async page => {
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.signIn('kitchen'));
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.watchOrder('order-browser-001'));
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.disableFirestoreNetwork());
    for (const status of ['accepted']) {
      const response = await page.evaluate(async (status) => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('transitionRestaurantOrder', { businessId:fixture.businessId, orderId:'order-browser-001', area:'kitchen', status }, 'browser_kitchen_' + status + '_001'); }, status);
      if (response.status !== 200) throw new Error('kitchen transition failed:' + JSON.stringify(response));
      if (status === 'accepted') await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.enableFirestoreNetwork());
    }
    const reconnected = await page.waitForFunction(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.state().listenerEvents.some((event) => event.startsWith('accepted:')), null, { timeout: 8000 }).then(() => true).catch(() => false);
    if (!reconnected) throw new Error('Firestore listener did not recover after reconnect:' + JSON.stringify(await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.state().listenerEvents)));
    for (const status of ['preparing','ready']) {
      const response = await page.evaluate(async (status) => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('transitionRestaurantOrder', { businessId:fixture.businessId, orderId:'order-browser-001', area:'kitchen', status }, 'browser_kitchen_' + status + '_001'); }, status);
      if (response.status !== 200) throw new Error('kitchen transition failed:' + JSON.stringify(response));
    }
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/Failed to load resource: The network connection was lost/.test(message));
    if (unexpectedConsoleErrors.length) throw new Error('unexpected console errors:' + unexpectedConsoleErrors.join('|'));
  }"
  run_code "$session" "async page => {
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.clearWatches());
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.signIn('cashier'));
    const partial = await page.evaluate(async () => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('recordRestaurantPayment', { businessId:fixture.businessId, orderId:'order-browser-001', amount:5, method:'Efectivo' }, 'browser_payment_part_001'); });
    if (partial.status !== 200) throw new Error('partial payment failed');
    const final = await page.evaluate(async () => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('recordRestaurantPayment', { businessId:fixture.businessId, orderId:'order-browser-001', amount:15, method:'Tarjeta' }, 'browser_payment_final_001'); });
    const duplicate = await page.evaluate(async () => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('recordRestaurantPayment', { businessId:fixture.businessId, orderId:'order-browser-001', amount:15, method:'Tarjeta' }, 'browser_payment_final_001'); });
    if (final.status !== 200 || duplicate.status !== 200 || duplicate.body.result.noop !== true) throw new Error('idempotent payment failed');
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/status of 403 \(Forbidden\)|Failed to load resource: The network connection was lost/.test(message));
    if (unexpectedConsoleErrors.length) throw new Error('unexpected console errors:' + unexpectedConsoleErrors.join('|'));
  }"
  "$PWCLI" --session p2-cloud-browser-refresh close >/dev/null 2>&1 || true
  "$PWCLI" --session p2-cloud-browser-refresh open "$URL" --browser="$browser" $mobile >/dev/null
  run_code p2-cloud-browser-refresh "async page => {
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.signIn('cashier'));
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.watchOrder('order-browser-001'));
    let order = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      order = await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.readOrder('order-browser-001'));
      if (order && order.status === 'paid' && order.paidAmount === 20) break;
      await page.waitForTimeout(150);
    }
    if (!order || order.status !== 'paid' || order.paidAmount !== 20) throw new Error('fresh browser session lost persisted order:' + JSON.stringify(await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.state().listenerEvents)));
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.signIn('beta'));
    const cross = await page.evaluate(async () => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('createRestaurantOrder', { businessId:fixture.businessId, orderId:'order-cross-browser', tableId:'table-cross-browser', items:[{ id:'line-cross-browser', qty:1, price:1 }] }, 'browser_cross_001'); });
    if (cross.status !== 403 || cross.body.code !== 'membership_not_active') throw new Error('cross-business request was not denied');
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.signIn('owner'));
    const revoked = await page.evaluate(async () => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('revokeWorker', { businessId:fixture.businessId, targetUid:'server-browser' }, 'browser_revoke_001'); });
    if (revoked.status !== 200) throw new Error('owner revocation failed');
    await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.signIn('server'));
    const denied = await page.evaluate(async () => { const fixture = await window.__CLICK360_P2_CLOUD_BROWSER_QA__.fixture(); return window.__CLICK360_P2_CLOUD_BROWSER_QA__.call('createRestaurantOrder', { businessId:fixture.businessId, orderId:'order-revoked-browser', tableId:'table-revoked-browser', items:[{ id:'line-revoked-browser', qty:1, price:1 }] }, 'browser_revoked_001'); });
    if (denied.status !== 403 || denied.body.code !== 'membership_not_active') throw new Error('revoked user retained access');
    for (const width of [320,360,390,430,768,1024,1366,1440]) {
      await page.setViewportSize({ width, height: width < 720 ? 900 : 850 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) throw new Error('overflow at ' + width);
    }
    const errors = await page.evaluate(() => window.__CLICK360_P2_CLOUD_BROWSER_QA__.state().errors);
    if (errors.length) throw new Error('unexpected browser errors:' + errors.join('|'));
    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/status of 403 \(Forbidden\)|Failed to load resource: The network connection was lost/.test(message));
    if (unexpectedConsoleErrors.length) throw new Error('unexpected console errors:' + unexpectedConsoleErrors.join('|'));
    await page.screenshot({ path:'output/playwright/p2/cloud/' + '$browser' + '.png', fullPage:true });
  }"
  "$PWCLI" --session "$session" close >/dev/null 2>&1 || true
  "$PWCLI" --session p2-cloud-browser-refresh close >/dev/null 2>&1 || true
}

if [ "${CLICK360_P2_BROWSER_ONLY:-}" = "" ] || [ "${CLICK360_P2_BROWSER_ONLY:-}" = "chrome" ]; then
  run_browser chrome p2-cloud-browser-chrome ""
fi
if [ "${CLICK360_P2_BROWSER_ONLY:-}" = "" ] || [ "${CLICK360_P2_BROWSER_ONLY:-}" = "webkit" ]; then
  run_browser webkit p2-cloud-browser-webkit "--mobile"
fi
echo "P2 cloud browser multiuser E2E PASS"
