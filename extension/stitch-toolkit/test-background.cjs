/**
 * Background Smoke Test — runs the merged service worker in a mock browser.
 * Verifies: top-level boot, message routing (tk:* / stitch:*), WS bridge
 * hello/handshake, health ping/pong, and bridge-driven record session start.
 * Run: node extension/stitch-toolkit/test-background.cjs
 */

const fs = require('fs');
const path = require('path');

const EXT_DIR = path.dirname(__filename);
const errors = [];
const passes = [];

function fail(msg) { errors.push(msg); console.log('  ✗ ' + msg); }
function pass(msg) { passes.push(msg); console.log('  ✓ ' + msg); }

// ════════════════════════════════════════════════════════════════════════
// MOCK CHROME + WEBSOCKET
// ════════════════════════════════════════════════════════════════════════

const storageArea = () => {
  const data = {};
  return {
    async get(keys) {
      if (keys == null) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    },
    async set(obj) { Object.assign(data, obj); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; },
  };
};

const listeners = { onMessage: [], onInstalled: [], onStartup: [], onAlarm: [], onRemoved: [] };
const sentTabMessages = [];
const tabsUpdateCalls = [];
const wsInstances = [];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    wsInstances.push(this);
  }
  send(text) {
    if (this.readyState !== MockWebSocket.OPEN) throw new Error('WS not open');
    this.sent.push(JSON.parse(text));
  }
  close() { this.readyState = MockWebSocket.CLOSED; }
  // test helpers
  _open() { this.readyState = MockWebSocket.OPEN; if (this.onopen) this.onopen({}); }
  _message(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
}

global.WebSocket = MockWebSocket;
global.chrome = {
  storage: {
    session: storageArea(),
    local: storageArea(),
  },
  tabs: {
    async query() { return [{ id: 1, url: 'https://example.com/', status: 'complete' }]; },
    async get(tabId) { return { id: tabId, url: 'https://example.com/', status: 'complete' }; },
    async create(opts) { return { id: 2, url: opts?.url || 'about:blank' }; },
    async update(tabId, opts) { tabsUpdateCalls.push({ tabId, opts }); return {}; },
    async sendMessage(tabId, message) { sentTabMessages.push({ tabId, message }); return { ok: true }; },
    onRemoved: { addListener: fn => listeners.onRemoved.push(fn) },
    onUpdated: { addListener: () => {}, removeListener: () => {} },
  },
  runtime: {
    onMessage: { addListener: fn => listeners.onMessage.push(fn) },
    onInstalled: { addListener: fn => listeners.onInstalled.push(fn) },
    onStartup: { addListener: fn => listeners.onStartup.push(fn) },
    sendMessage: async () => ({ ok: true }),
  },
  alarms: {
    create: () => {},
    onAlarm: { addListener: fn => listeners.onAlarm.push(fn) },
  },
  scripting: {
    async executeScript() { return [{ result: { ok: true } }]; },
  },
  webNavigation: {
    async getAllFrames() { return [{ frameId: 0, url: 'https://example.com/' }]; },
  },
};

// ════════════════════════════════════════════════════════════════════════
// LOAD BACKGROUND (strip ESM syntax — same approach as test.cjs)
// ════════════════════════════════════════════════════════════════════════

function stripEsm(code) {
  return code
    .replace(/import\s+.*?\s+from\s+['"].*?['"];?/g, '')
    .replace(/export\s+const\s+/g, 'const ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s*\{[^}]*\}\s*;?/g, '');
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Stitch Toolkit — Background Smoke Test');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// shared.js + session-manager.js + background.js must share ONE eval scope
// (const/let declarations do not leak across separate eval calls).
let bootError = null;
let sessionManager = null;
try {
  const bundle =
    stripEsm(fs.readFileSync(path.join(EXT_DIR, 'shared.js'), 'utf-8')) + '\n;\n' +
    stripEsm(fs.readFileSync(path.join(EXT_DIR, 'session-manager.js'), 'utf-8')) + '\n;\n' +
    stripEsm(fs.readFileSync(path.join(EXT_DIR, 'background.js'), 'utf-8')) +
    '\n;globalThis.__bgTest = { sessionManager };\n';
  eval(bundle);
  sessionManager = globalThis.__bgTest.sessionManager;
  pass('background.js booted without exceptions');
} catch (e) {
  bootError = e;
  fail('background.js boot error: ' + e.message);
  console.log(e.stack);
}

function sendRuntimeMessage(message) {
  return sendRuntimeMessageFrom(1, message);
}

function sendRuntimeMessageFrom(tabId, message) {
  return new Promise(resolve => {
    for (const fn of listeners.onMessage) {
      let responded = false;
      const sendResponse = resp => { if (!responded) { responded = true; resolve(resp); } };
      const async = fn(message, { tab: { id: tabId } }, sendResponse);
      if (!async && !responded) continue; // handler declined; try next
      if (!async) return;
      // async handler: wait a beat for sendResponse
      setTimeout(() => { if (!responded) resolve(undefined); }, 250);
      return;
    }
    resolve(undefined);
  });
}

async function run() {
  if (bootError) return finish();

  // Allow top-level async armBridges(false) to settle
  await new Promise(r => setTimeout(r, 50));

  console.log('');
  console.log('1. Listener registration');
  if (listeners.onMessage.length === 1) pass('single chrome.runtime.onMessage listener');
  else fail('onMessage listeners: ' + listeners.onMessage.length);
  if (listeners.onAlarm.length === 1) pass('bridge re-arm alarm registered');
  else fail('onAlarm listeners: ' + listeners.onAlarm.length);

  const bridges = { record: null, replay: null, health: null };
  for (const ws of wsInstances) {
    const m = ws.url.match(/127\.0\.0\.1:(\d+)/);
    if (!m) continue;
    const port = Number(m[1]);
    if (port === 18731) bridges.record = ws;
    if (port === 18732) bridges.replay = ws;
    if (port === 18733) bridges.health = ws;
  }
  console.log('');
  console.log('2. Bridge ports (must match Python runners)');
  for (const [kind, ws] of Object.entries(bridges)) {
    if (ws) pass(kind + ' bridge connects to canonical port');
    else fail(kind + ' bridge never attempted connection');
  }

  console.log('');
  console.log('3. Health ping/pong');
  if (bridges.health) {
    bridges.health._open();
    const hello = bridges.health.sent.find(p => p.type === 'hello');
    if (hello) pass('hello sent on health connect');
    else fail('no hello on health connect');
    bridges.health._message({ type: 'ping', payload: { nonce: 'probe-123' } });
    await new Promise(r => setTimeout(r, 80)); // handler is async (trace checkpoint first)
    const pong = bridges.health.sent.find(p => p.type === 'pong');
    if (pong && pong.payload && pong.payload.nonce === 'probe-123') pass('pong echoes nonce');
    else fail('pong missing or nonce mismatch: ' + JSON.stringify(pong || null));
  }

  console.log('');
  console.log('4. Bridge-driven record session (Python protocol)');
  if (bridges.record) {
    bridges.record._open();
    bridges.record._message({
      type: 'start_record',
      payload: { runId: 'ext_rec_test', alias: 'test@local', scenarioName: 'smoke', startUrl: 'https://example.com/' },
    });
    await new Promise(r => setTimeout(r, 120));
    const recording = sessionManager.isRecording();
    if (recording) pass('start_record opens recording session');
    else fail('sessionManager not recording after start_record');

    // Content script reports a click → background must forward as record_event
    await sendRuntimeMessage({
      type: 'stitch:record-event',
      payload: { kind: 'click', ts: '2026-01-01T00:00:00.000Z', url: 'https://example.com/', selector: '#go', value: null, meta: {} },
    });
    await new Promise(r => setTimeout(r, 50));
    const forwarded = bridges.record.sent.find(p => p.type === 'record_event');
    if (forwarded && forwarded.payload && forwarded.payload.selector === '#go') pass('record_event forwarded to WS bridge');
    else fail('record_event not forwarded: ' + JSON.stringify(forwarded || null));
    if (sessionManager.getStepCount() === 1) pass('step stored in sessionManager');
    else fail('stepCount=' + sessionManager.getStepCount());
    const progress = sentTabMessages.find(x => x.message && x.message.type === 'tk:recorder-progress');
    if (progress) pass('tk:recorder-progress pushed to tab');
    else fail('no tk:recorder-progress push');

    // Python control command (pause) — the gap that killed the toolkit fork
    bridges.record._message({ type: 'control', payload: { command: 'pause' } });
    await new Promise(r => setTimeout(r, 50));
    if (sessionManager.isPaused()) pass('WS control pause applied to recording');
    else fail('WS control pause NOT applied');

    bridges.record._message({ type: 'stop_record', payload: { runId: 'ext_rec_test' } });
    await new Promise(r => setTimeout(r, 80));
    if (!sessionManager.isRecording()) pass('stop_record closes session');
    else fail('still recording after stop_record');
  }

  console.log('');
  console.log('5. Panel message handlers (tk:*)');
  const status = await sendRuntimeMessage({ type: 'tk:status' });
  if (status && status.ok && status.version) pass('tk:status responds (v' + status.version + ')');
  else fail('tk:status broken: ' + JSON.stringify(status || null));
  const recStatus = await sendRuntimeMessage({ type: 'tk:recorder-status' });
  if (recStatus && recStatus.ok && recStatus.mode === null) pass('tk:recorder-status idle after stop');
  else fail('tk:recorder-status broken: ' + JSON.stringify(recStatus || null));
  const overlaySync = await sendRuntimeMessage({ type: 'stitch:overlay-sync' });
  if (overlaySync && overlaySync.ok && overlaySync.payload && overlaySync.payload.mode === 'idle') pass('stitch:overlay-sync responds idle');
  else fail('stitch:overlay-sync broken: ' + JSON.stringify(overlaySync || null));

  console.log('');
  console.log('6. Native-hosted record session (Python native recorder bridge)');
  if (bridges.record) {
    sentTabMessages.length = 0;
    tabsUpdateCalls.length = 0;
    chrome.tabs.query = async () => [
      { id: 1, url: 'https://example.com/', status: 'complete' },
      { id: 2, url: 'https://example.com/2', status: 'complete' },
    ];
    // Race coverage: the tab is still about:blank when start_record arrives
    // (Python navigates it right after); the session must wait, not fail.
    let tabGetCalls = 0;
    chrome.tabs.get = async (tabId) => {
      tabGetCalls += 1;
      if (tabGetCalls === 1) return { id: tabId, url: 'about:blank', status: 'loading' };
      return { id: tabId, url: 'https://example.com/', status: 'complete' };
    };
    bridges.record._message({
      type: 'start_record',
      payload: { runId: 'native_rec_test', alias: 'test@local', scenarioName: 'native', startUrl: 'https://example.com/', nativeHosted: true },
    });
    await new Promise(r => setTimeout(r, 700));

    const rec = sessionManager.getState().record;
    if (sessionManager.isRecording() && rec && rec.nativeHosted === true) pass('nativeHosted session started');
    else fail('nativeHosted session not started: ' + JSON.stringify(rec || null));
    if (tabGetCalls >= 2) pass('waited for the tab to leave about:blank');
    else fail('no wait for http tab (get calls: ' + tabGetCalls + ')');

    if (tabsUpdateCalls.length === 0) pass('no tab re-navigation on nativeHosted start');
    else fail('unexpected tabs.update calls: ' + JSON.stringify(tabsUpdateCalls));

    const broadcasts = sentTabMessages.filter(x => x.message && x.message.type === 'stitch:overlay-state' && x.message.payload && x.message.payload.mode === 'record');
    const tabIds = new Set(broadcasts.map(x => x.tabId));
    if (tabIds.has(1) && tabIds.has(2)) pass('record state broadcast to all tabs');
    else fail('broadcast missing tabs: ' + JSON.stringify([...tabIds]));
    if (broadcasts.length > 0 && broadcasts.every(x => x.message.payload.suppressOverlay === true)) pass('broadcast payload carries suppressOverlay');
    else fail('suppressOverlay missing in broadcast payload');

    const sync = await sendRuntimeMessageFrom(2, { type: 'stitch:overlay-sync' });
    if (sync && sync.ok && sync.payload && sync.payload.mode === 'record' && sync.payload.suppressOverlay === true) pass('overlay-sync from non-session tab returns record payload');
    else fail('overlay-sync for non-session tab broken: ' + JSON.stringify(sync || null));

    bridges.record._message({ type: 'stop_record', payload: { runId: 'native_rec_test' } });
    await new Promise(r => setTimeout(r, 100));
    const idleBroadcasts = sentTabMessages.filter(x => x.message && x.message.type === 'stitch:overlay-state' && x.message.payload && x.message.payload.mode === 'idle');
    const idleTabIds = new Set(idleBroadcasts.map(x => x.tabId));
    if (idleTabIds.has(1) && idleTabIds.has(2)) pass('stop broadcasts idle to all tabs');
    else fail('idle broadcast missing tabs: ' + JSON.stringify([...idleTabIds]));
    if (!sessionManager.isRecording()) pass('nativeHosted session stopped');
    else fail('still recording after nativeHosted stop');
  }

  console.log('');
  console.log('7. record_stopped reaches the bridge on stop (Shard HUD stop path)');
  if (bridges.record) {
    bridges.record.sent.length = 0;
    bridges.record._message({
      type: 'start_record',
      payload: { runId: 'stop_notify_test', alias: 'test@local', scenarioName: 's', startUrl: 'https://example.com/', nativeHosted: true, suppressOverlay: false },
    });
    await new Promise(r => setTimeout(r, 120));
    if (sessionManager.isRecording()) pass('bridge session started for stop-notify test');
    else fail('bridge session not started');

    // suppressOverlay decoupled from nativeHosted (Shard shows the HUD).
    const recState = sessionManager.getState().record;
    if (recState && recState.nativeHosted === true && recState.suppressOverlay === false) pass('suppressOverlay decoupled from nativeHosted');
    else fail('suppressOverlay not decoupled: ' + JSON.stringify(recState || null));

    // Stop via the same path the extension HUD uses (overlay-control stop).
    await sendRuntimeMessage({ type: 'stitch:overlay-control', payload: { command: 'stop' } });
    await new Promise(r => setTimeout(r, 120));
    const stoppedMsg = bridges.record.sent.find(p => p.type === 'record_stopped');
    if (stoppedMsg) pass('record_stopped sent to bridge on HUD stop');
    else fail('record_stopped NOT sent to bridge on HUD stop');
    if (!sessionManager.isRecording()) pass('session closed after HUD stop');
    else fail('session still recording after HUD stop');
  }

  console.log('');
  console.log('8. Native-hosted replay reuses the active tab (no re-navigation)');
  if (bridges.replay) {
    tabsUpdateCalls.length = 0;
    chrome.tabs.query = async () => [{ id: 7, url: 'https://example.com/', status: 'complete', active: true }];
    chrome.tabs.get = async (tabId) => ({ id: tabId, url: 'https://example.com/', status: 'complete' });
    bridges.replay._open();
    bridges.replay._message({
      type: 'start_replay',
      payload: {
        runId: 'native_replay_test',
        alias: 'test@local',
        scenarioPath: '/tmp/s.json',
        startUrl: 'https://example.com/',
        fromStep: 1,
        // Empty steps: isolates session start (no nav step execution), so any
        // tabs.update here would come from ensureTabForUrl, not a step.
        steps: [],
        nativeHosted: true,
      },
    });
    await new Promise(r => setTimeout(r, 120));
    if (tabsUpdateCalls.length === 0) pass('nativeHosted replay does not re-navigate the tab');
    else fail('nativeHosted replay re-navigated: ' + JSON.stringify(tabsUpdateCalls));
    // Stop the replay session to clean up state.
    bridges.replay._message({ type: 'control', payload: { command: 'stop' } });
    await new Promise(r => setTimeout(r, 80));
  }

  console.log('');
  console.log('9. Replay goto/navigate steps drive tab navigation (runDomStep)');
  if (bridges.replay) {
    tabsUpdateCalls.length = 0;
    chrome.tabs.query = async () => [{ id: 9, url: 'about:blank', status: 'complete', active: true }];
    chrome.tabs.get = async (tabId) => ({ id: tabId, url: 'https://example.com/', status: 'complete' });
    bridges.replay._message({
      type: 'start_replay',
      payload: {
        runId: 'goto_exec_test',
        alias: 'test@local',
        scenarioPath: '/tmp/s.json',
        startUrl: 'https://example.com/',
        fromStep: 1,
        // goto (sanitized nav) + legacy navigate alias must both navigate.
        steps: [
          { kind: 'goto', url: 'https://example.com/' },
          { kind: 'navigate', url: 'https://www.iana.org/' },
        ],
        nativeHosted: true,
      },
    });
    await new Promise(r => setTimeout(r, 300));
    const navUrls = tabsUpdateCalls.map(c => c.opts && c.opts.url);
    if (navUrls.includes('https://example.com/') && navUrls.includes('https://www.iana.org/')) pass('goto + navigate steps drive tab navigation');
    else fail('goto/navigate did not navigate: ' + JSON.stringify(navUrls));
    const doneMsgs = bridges.replay.sent.filter(p => p.type === 'replay_step_done');
    if (doneMsgs.length >= 2) pass('replay_step_done emitted for nav steps');
    else fail('replay_step_done count: ' + doneMsgs.length);
    bridges.replay._message({ type: 'control', payload: { command: 'stop' } });
    await new Promise(r => setTimeout(r, 80));
  }

  finish();
}

function finish() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Results: ' + passes.length + ' passed, ' + errors.length + ' failed');
  console.log('═══════════════════════════════════════════════════════════════');
  if (errors.length > 0) {
    console.log('\n❌ FAILURES:');
    errors.forEach(e => console.log('  - ' + e));
    process.exit(1);
  }
  console.log('\n✅ BACKGROUND SMOKE TEST PASSED');
  process.exit(0);
}

run().catch(e => {
  fail('unhandled test error: ' + e.message);
  finish();
});
