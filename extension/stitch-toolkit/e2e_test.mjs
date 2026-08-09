/**
 * E2E test for the unified Stitch Toolkit extension.
 * Uses playwright-core + system Chrome (headful) with the unpacked extension.
 *
 * Flow:
 *   1. Local HTTP page + WS record bridge (18731) like run_extension_record.py
 *   2. Extension connects (hello) → start_record → overlay appears
 *   3. Click/input on the page → record_event streamed over WS
 *   4. WS control pause/resume → overlay reacts
 *   5. stop_record → session ends, steps verified
 *   6. Panel UI: float button, tabs, bridge status + screenshots for UI review
 *
 * Run: node extension/stitch-toolkit/e2e_test.mjs
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { WebSocketServer } = require('ws');
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = __dirname;
const USER_DATA_DIR = path.join(__dirname, '.e2e-user-data');
const SHOTS_DIR = path.join(__dirname, '.e2e-shots');

// Branded Chrome (>=127) dropped --load-extension, so we use Playwright's
// open-source Chromium (npx playwright-core install chromium).
const EXECUTABLE = null; // let playwright-core use its installed Chromium

const RECORD_PORT = 18731;
const results = [];
function check(name, ok, extra) {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
}

const TEST_PAGE = `<!DOCTYPE html><html><head><title>E2E Test Page</title></head>
<body style="font-family:sans-serif;padding:40px">
  <h1 id="headline">Stitch Toolkit E2E</h1>
  <button id="btn-one" style="padding:10px 20px">Click Me</button>
  <input id="inp-one" style="padding:8px;margin-left:10px" placeholder="type here" />
  <p>Test paragraph content.</p>
</body></html>`;

async function startHttpServer() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(TEST_PAGE);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function startRecordBridge() {
  const state = { ws: null, messages: [], hello: null };
  const wss = new WebSocketServer({ host: '127.0.0.1', port: RECORD_PORT });
  wss.on('connection', ws => {
    state.ws = ws;
    ws.on('message', raw => {
      let obj;
      try { obj = JSON.parse(raw.toString()); } catch { return; }
      state.messages.push(obj);
      if (obj.type === 'hello') state.hello = obj;
    });
  });
  state.send = obj => { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj)); };
  state.waitFor = (pred, timeoutMs) => new Promise(resolve => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = state.messages.find(pred);
      if (found) { clearInterval(timer); resolve(found); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(null); }
    }, 100);
  });
  return { wss, state };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  fs.rmSync(SHOTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  console.log('[E2E] Starting local HTTP page...');
  const { srv: httpSrv, port: httpPort } = await startHttpServer();
  const pageUrl = `http://127.0.0.1:${httpPort}/`;
  console.log('[E2E] Test page:', pageUrl);

  console.log('[E2E] Starting WS record bridge on', RECORD_PORT);
  const { wss, state: bridge } = startRecordBridge();

  console.log('[E2E] Launching Chrome with extension...');
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1400, height: 900 },
  });

  console.log('[E2E] Waiting for extension bridge connection (hello)...');
  const hello = await bridge.waitFor(m => m.type === 'hello', 30000);
  check('extension connected to record bridge (hello)', !!hello, hello ? JSON.stringify(hello.payload || {}) : 'timeout');
  if (!hello) { await cleanup(); process.exit(1); }

  // ── Start recording via the bridge (production flow) ──────────────────
  console.log('[E2E] Sending start_record...');
  bridge.send({
    type: 'start_record',
    payload: { runId: 'e2e_run_1', alias: 'e2e@local', scenarioName: 'e2e-scenario', startUrl: pageUrl },
  });

  // Find the tab that navigated to our page
  let testPage = null;
  for (let i = 0; i < 40 && !testPage; i++) {
    await sleep(500);
    for (const p of context.pages()) {
      if ((p.url() || '').startsWith(`http://127.0.0.1:${httpPort}`)) { testPage = p; break; }
    }
  }
  check('extension opened/navigated test tab', !!testPage);
  if (!testPage) {
    console.log('[E2E] bridge messages so far:', JSON.stringify(bridge.messages.slice(0, 10), null, 2));
    await cleanup(); process.exit(1);
  }
  // Dump record_error / session_active if start failed
  const earlyErrors = bridge.messages.filter(m => m.type === 'record_error' || m.type === 'session_active');
  if (earlyErrors.length) console.log('[E2E] early bridge messages:', JSON.stringify(earlyErrors, null, 2));
  await testPage.bringToFront();
  await testPage.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(1500);

  // Overlay should be visible (record mode)
  const overlayVisible = await testPage.evaluate(() => {
    const host = document.getElementById('stitch-overlay-host');
    return Boolean(host && host.style.display !== 'none');
  });
  if (!overlayVisible) {
    const sws = context.serviceWorkers();
    if (sws.length) {
      const dbg = await sws[0].evaluate(() => chrome.storage.session.get(null)).catch(e => ({ err: e.message }));
      console.log('[E2E] SW storage.session dump:', JSON.stringify(dbg, null, 2));
    }
  }
  check('overlay visible after start_record', overlayVisible);
  await testPage.screenshot({ path: path.join(SHOTS_DIR, '01-overlay-recording.png') });

  // ── Record interactions ────────────────────────────────────────────────
  console.log('[E2E] Clicking button + typing...');
  await testPage.click('#btn-one');
  await sleep(600);
  await testPage.click('#inp-one');
  await testPage.type('#inp-one', 'hello stitch', { delay: 30 });
  await sleep(900);

  const clickEvents = bridge.messages.filter(m => m.type === 'record_event' && m.payload?.kind === 'click');
  const inputEvents = bridge.messages.filter(m => m.type === 'record_event' && (m.payload?.kind === 'input' || m.payload?.kind === 'change'));
  check('record_event: click streamed', clickEvents.length >= 1, `count=${clickEvents.length}`);
  check('record_event: input streamed', inputEvents.length >= 1, `count=${inputEvents.length}`);
  const hasSelector = clickEvents.some(m => m.payload?.selector);
  check('click events carry selectors', hasSelector, clickEvents[0]?.payload?.selector || 'none');

  // ── WS control: pause / resume ────────────────────────────────────────
  bridge.send({ type: 'control', payload: { command: 'pause' } });
  await sleep(1200);
  const pausedOverlay = await testPage.evaluate(() => {
    const host = document.getElementById('stitch-overlay-host');
    if (!host || !host.shadowRoot) return { found: false };
    const status = host.shadowRoot.querySelector('[id$="-status"], #stitch-status')?.textContent || '';
    const main = host.shadowRoot.querySelector('[id$="-main"], #stitch-main')?.textContent || '';
    return { found: true, status, main };
  });
  check('WS control pause reflected in overlay', /paus|пауз/i.test(pausedOverlay.status + ' ' + pausedOverlay.main), JSON.stringify(pausedOverlay));
  await testPage.screenshot({ path: path.join(SHOTS_DIR, '02-overlay-paused.png') });

  bridge.send({ type: 'control', payload: { command: 'resume' } });
  await sleep(1000);

  // ── Stop recording ────────────────────────────────────────────────────
  bridge.send({ type: 'stop_record', payload: { runId: 'e2e_run_1' } });
  await sleep(1500);
  const overlayGone = await testPage.evaluate(() => {
    const host = document.getElementById('stitch-overlay-host');
    return !host || host.style.display === 'none';
  });
  check('overlay hidden after stop_record', overlayGone);

  // ── Panel UI ───────────────────────────────────────────────────────────
  console.log('[E2E] Checking panel UI...');
  await testPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(2000);

  const floatBtn = await testPage.evaluate(() => {
    const host = document.getElementById('tk-shadow-host');
    if (!host || !host.shadowRoot) return { found: false };
    const btn = host.shadowRoot.querySelector('.tk-float-btn');
    return { found: !!btn };
  });
  check('panel float button injected', floatBtn.found);

  // Open panel
  await testPage.evaluate(() => {
    const host = document.getElementById('tk-shadow-host');
    const btn = host && host.shadowRoot && host.shadowRoot.querySelector('.tk-float-btn');
    if (btn) btn.click();
  });
  await sleep(800);
  const panelOpen = await testPage.evaluate(() => {
    const host = document.getElementById('tk-shadow-host');
    const panel = host && host.shadowRoot && host.shadowRoot.querySelector('.tk-panel');
    return Boolean(panel && panel.classList.contains('tk-open'));
  });
  check('panel opens on float button click', panelOpen);
  await testPage.screenshot({ path: path.join(SHOTS_DIR, '03-panel-stripe.png') });

  // Switch to recorder tab
  await testPage.evaluate(() => {
    const host = document.getElementById('tk-shadow-host');
    const tab = host && host.shadowRoot && host.shadowRoot.querySelector('.tk-tab[data-id="recorder"]');
    if (tab) tab.click();
  });
  await sleep(700);
  await testPage.screenshot({ path: path.join(SHOTS_DIR, '04-panel-recorder.png') });
  const recorderTab = await testPage.evaluate(() => {
    const host = document.getElementById('tk-shadow-host');
    const active = host && host.shadowRoot && host.shadowRoot.querySelector('.tk-tab.tk-active');
    return active ? active.dataset.id : null;
  });
  check('recorder tab activates', recorderTab === 'recorder', `active=${recorderTab}`);

  // Switch to settings tab (bridge indicator)
  await testPage.evaluate(() => {
    const host = document.getElementById('tk-shadow-host');
    const tab = host && host.shadowRoot && host.shadowRoot.querySelector('.tk-tab[data-id="settings"]');
    if (tab) tab.click();
  });
  await sleep(900);
  await testPage.screenshot({ path: path.join(SHOTS_DIR, '05-panel-settings.png') });
  const bridgeRows = await testPage.evaluate(() => {
    const host = document.getElementById('tk-shadow-host');
    if (!host || !host.shadowRoot) return { found: false };
    const rows = host.shadowRoot.querySelectorAll('.tk-bridge-row');
    return { found: rows.length > 0, count: rows.length, on: host.shadowRoot.querySelectorAll('.tk-bridge-row.tk-on').length };
  });
  check('settings shows bridge indicator rows', bridgeRows.found, `rows=${bridgeRows.count}, online=${bridgeRows.on}`);

  // ── Summary ────────────────────────────────────────────────────────────
  const kinds = {};
  for (const m of bridge.messages) kinds[m.type] = (kinds[m.type] || 0) + 1;
  console.log('[E2E] bridge message counts:', JSON.stringify(kinds));
  console.log('\n[E2E] ===== SUMMARY =====');
  const passed = results.filter(r => r.ok).length;
  console.log(`[E2E] ${passed}/${results.length} checks passed`);
  console.log(`[E2E] Screenshots: ${SHOTS_DIR}`);
  results.filter(r => !r.ok).forEach(r => console.log('[E2E] FAILED:', r.name));

  await cleanup();
  process.exit(results.every(r => r.ok) ? 0 : 1);

  async function cleanup() {
    try { await context.close(); } catch {}
    try { wss.close(); } catch {}
    try { httpSrv.close(); } catch {}
    try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch {}
  }
}

main().catch(err => {
  console.error('[E2E] FATAL:', err);
  process.exit(1);
});
