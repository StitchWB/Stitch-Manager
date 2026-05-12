// Stitch Toolkit — Background Service Worker
// Unified background for Stripe Filler + Scenario Recorder + Replay.
// Imports session-manager for atomic state management.

import { BRIDGE_PORTS, STORAGE_KEYS, syncApiUrl } from './shared.js';
import { sessionManager } from './session-manager.js';

// ── WebSocket Bridge State ─────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS = 3;
const MAX_RECONNECT_DELAY = 15000;
const MAX_QUEUE_SIZE = 200;

const bridgeState = {
  record: { ws: null, connecting: false, outboundQueue: [], reconnectAttempt: 0, status: 'offline', errorLogged: false },
  replay: { ws: null, connecting: false, outboundQueue: [], reconnectAttempt: 0, status: 'offline', errorLogged: false },
  health: { ws: null, connecting: false, outboundQueue: [], reconnectAttempt: 0, status: 'offline', errorLogged: false },
};

let _replayTask = null;

// ── Helpers ────────────────────────────────────────────────────────────────
function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function stableId(prefix = 'tk') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toIso(ts = Date.now()) {
  try { return new Date(ts).toISOString(); } catch { return new Date().toISOString(); }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function normalizeStep(payload) {
  const s = payload && typeof payload === 'object' ? payload : {};
  return {
    kind: String(s.kind || 'unknown').trim() || 'unknown',
    ts: String(s.ts || toIso()).trim() || toIso(),
    url: typeof s.url === 'string' ? s.url : null,
    selector: typeof s.selector === 'string' ? s.selector : null,
    value: typeof s.value === 'string' ? s.value : null,
    meta: s.meta && typeof s.meta === 'object' ? s.meta : {},
    frameSrc: typeof s.frameSrc === 'string' ? s.frameSrc : null,
  };
}

function buildScenario(record) {
  if (!record || typeof record !== 'object') return null;
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const sanitized = steps.map(normalizeStep).filter(step => Boolean(step?.kind));
  if (!sanitized.length) return null;
  const firstNav = sanitized.find(s => String(s?.kind || '').toLowerCase() === 'nav');
  const startUrl =
    (isHttpUrl(record.startUrl) ? String(record.startUrl).trim() : '') ||
    (isHttpUrl(firstNav?.url) ? String(firstNav.url).trim() : '') ||
    'https://google.com';
  return {
    id: String(record.runId || '').trim() || stableId('scenario'),
    name: String(record.scenarioName || '').trim() || `Recorded ${toIso().slice(0, 19).replace('T', ' ')}`,
    startUrl,
    steps: sanitized,
    importedAt: toIso(),
    source: 'toolkit-record',
  };
}

// ── Tab Helpers ────────────────────────────────────────────────────────────
async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

async function waitTabLoaded(tabId, timeoutMs = 20000) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && tab.status === 'complete') return true;
  return new Promise(resolve => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(false); }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function ensureTabForUrl(url) {
  let tabId = await getActiveTabId();
  if (!tabId) {
    const created = await chrome.tabs.create({ url: url || 'about:blank', active: true });
    tabId = created.id ?? null;
    if (!tabId) throw new Error('Failed to create browser tab');
    await waitTabLoaded(tabId);
    return tabId;
  }
  if (url && isHttpUrl(url)) { await chrome.tabs.update(tabId, { url }); await waitTabLoaded(tabId); }
  return tabId;
}

async function sendToTab(tabId, message) {
  try { await chrome.tabs.sendMessage(tabId, message); return true; }
  catch (e) { console.warn('[bg] sendToTab failed:', e instanceof Error ? e.message : String(e)); return false; }
}

// ── WebSocket Bridge ───────────────────────────────────────────────────────
function sendWs(kind, payload) {
  const state = bridgeState[kind];
  if (!state) return 'error';
  const ws = state.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (state.outboundQueue.length < MAX_QUEUE_SIZE) state.outboundQueue.push(payload);
    // Lazy connect: try to establish connection if not already failed/connecting
    if (state.status !== 'failed' && state.status !== 'connecting' && !state.connecting) {
      const port = BRIDGE_PORTS[kind];
      if (port) connectBridge(kind, port);
    }
    return 'queued';
  }
  try { ws.send(JSON.stringify(payload)); return 'sent'; }
  catch {
    if (state.outboundQueue.length < MAX_QUEUE_SIZE) state.outboundQueue.push(payload);
    return 'queued';
  }
}

function flushOutboundQueue(kind) {
  const state = bridgeState[kind];
  if (!state || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
  const queue = state.outboundQueue; state.outboundQueue = [];
  for (const payload of queue) {
    try { state.ws.send(JSON.stringify(payload)); }
    catch { state.outboundQueue.push(payload); }
  }
}

function closeBridge(kind) {
  const state = bridgeState[kind];
  if (!state) return;
  if (state.ws && state.ws.readyState !== WebSocket.CLOSED && state.ws.readyState !== WebSocket.CLOSING) {
    try { state.ws.close(1000, 'Session ended'); } catch {}
  }
  state.ws = null; state.connecting = false;
}

function connectBridge(kind, port) {
  const state = bridgeState[kind];
  if (!state || state.connecting) return;
  if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) return;
  if (state.ws && state.ws.readyState !== WebSocket.CLOSED && state.ws.readyState !== WebSocket.CLOSING) {
    try { state.ws.close(1000, 'Reconnecting'); } catch {}
  }
  state.ws = null;
  if (state.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) { state.status = 'failed'; return; }
  state.connecting = true; state.status = 'reconnecting';
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  state.ws = ws;
  ws.onopen = () => {
    state.connecting = false; state.reconnectAttempt = 0; state.status = 'online'; state.errorLogged = false;
    flushOutboundQueue(kind);
    sendWs(kind, { type: 'hello', payload: { client: 'stitch-toolkit', kind } });
    if (kind === 'record' && sessionManager.isRecording()) {
      const r = sessionManager.getState().record;
      sendWs('record', { type: 'session_active', payload: { mode: 'record', runId: r?.runId, scenarioName: r?.scenarioName, stepCount: r?.stepCount, paused: r?.paused } });
    } else if (kind === 'replay' && _replayTask) {
      sendWs('replay', { type: 'session_active', payload: { mode: 'replay', runId: _replayTask.runId, current: _replayTask.current, total: _replayTask.totalSteps, paused: _replayTask.paused } });
    }
  };
  ws.onclose = () => {
    state.connecting = false;
    if (bridgeState[kind]?.ws === ws) bridgeState[kind].ws = null;
    state.reconnectAttempt += 1;
    if (state.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) { state.status = 'failed'; return; }
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempt), MAX_RECONNECT_DELAY);
    state.status = `reconnecting (${state.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`;
    setTimeout(() => connectBridge(kind, port), delay);
  };
  ws.onerror = (evt) => {
    if (!state.errorLogged) {
      console.warn(`[bg] WS ${kind} connection failed (backend may be offline):`, evt.type || 'error');
      state.errorLogged = true;
    }
  };
  ws.onmessage = async (evt) => {
    const msg = safeJsonParse(evt.data);
    if (!msg || typeof msg !== 'object') return;
    const type = String(msg.type || '').toLowerCase();
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
    if (kind === 'record') {
      if (type === 'start_record') {
        const force = Boolean(payload?.force);
        const mode = sessionManager.getMode();
        if (mode !== null) { if (!force) { sendWs('record', { type: 'session_active', payload: { mode } }); return; } else { await stopCurrentSession(); } }
        try { await startRecordSession(payload); } catch (e) { sendWs('record', { type: 'record_error', payload: { error: e instanceof Error ? e.message : String(e) } }); }
      } else if (type === 'stop_record') { await stopRecordSession(); }
    } else if (kind === 'replay') {
      if (type === 'start_replay') {
        const force = Boolean(payload?.force);
        const mode = sessionManager.getMode();
        if (mode !== null) { if (!force) { sendWs('replay', { type: 'session_active', payload: { mode, runId: _replayTask?.runId, current: _replayTask?.current || 0, total: _replayTask?.totalSteps || 0, paused: _replayTask?.paused || false } }); return; } else { await stopCurrentSession(); } }
        try { await startReplaySession(payload); } catch (e) { sendWs('replay', { type: 'replay_error', payload: { runId: payload?.runId, error: e instanceof Error ? e.message : String(e) } }); }
      } else if (type === 'stop_replay') { await applyReplayControl('stop'); }
    } else if (kind === 'health' && type === 'ping') {
      sendWs('health', { type: 'pong', payload: { nonce: payload.nonce ?? null, ts: Date.now() } });
    }
  };
}

async function stopCurrentSession() {
  if (sessionManager.isRecording()) await stopRecordSession();
  else if (sessionManager.isReplaying()) await applyReplayControl('stop');
}

function reconnectAllBridges() {
  for (const kind of ['record', 'replay', 'health']) {
    const state = bridgeState[kind];
    if (state && state.status === 'failed') { state.reconnectAttempt = 0; state.status = 'offline'; }
  }
  connectBridge('record', BRIDGE_PORTS.record);
  connectBridge('replay', BRIDGE_PORTS.replay);
  connectBridge('health', BRIDGE_PORTS.health);
}

function bridgeIsOnline(kind) { const ws = bridgeState[kind]?.ws; return Boolean(ws && ws.readyState === WebSocket.OPEN); }
function bridgeIsConnecting(kind) { const s = bridgeState[kind]; return Boolean(s && (s.connecting || (s.ws && s.ws.readyState === WebSocket.CONNECTING))); }

// ── Recorder / Replay Core ─────────────────────────────────────────────────
async function startRecordSession(payload) {
  const origin = String(payload?.origin || 'bridge').toLowerCase() === 'popup' ? 'popup' : 'bridge';
  const requestedUrl = String(payload?.startUrl || '').trim();
  const tabId = payload?.tabId ? Number(payload.tabId) : await ensureTabForUrl(isHttpUrl(requestedUrl) ? requestedUrl : null);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const tabUrl = String(tab?.url || '').trim();
  if (!isHttpUrl(tabUrl)) throw new Error('Open a regular website tab (http/https) before starting recording');
  const runId = String(payload?.runId || '').trim() || stableId('record');
  const scenarioName = String(payload?.scenarioName || '').trim() || `Recorded ${toIso().slice(0, 19).replace('T', ' ')}`;
  await sessionManager.startRecordSession(runId, scenarioName, isHttpUrl(requestedUrl) ? requestedUrl : tabUrl, origin, tabId);
  _replayTask = null;
  await sendToTab(tabId, { type: 'tk:recorder-state', payload: { mode: 'record', runId, scenarioName, startUrl: isHttpUrl(requestedUrl) ? requestedUrl : tabUrl } });
}

async function stopRecordSession() {
  const state = sessionManager.getState();
  const record = state.mode === 'record' ? state.record : null;
  if (!record) return { ok: true, saved: false, scenario: null };
  if (record.finalizing) return { ok: true, saved: false, scenario: null };
  await sessionManager.setFinalizing(true);
  const tabId = state.tabId;
  if (tabId != null) {
    await sendToTab(tabId, { type: 'tk:recorder-state', payload: { mode: 'idle' } });
  }
  const scenario = buildScenario(sessionManager.getState().record);
  const shouldPersist = String(record.origin || '') === 'toolkit';
  if (shouldPersist && scenario) {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEYS.scenarios]);
      const existing = Array.isArray(data?.[STORAGE_KEYS.scenarios]) ? data[STORAGE_KEYS.scenarios] : [];
      const next = [...existing, scenario].slice(-50);
      await chrome.storage.local.set({ [STORAGE_KEYS.scenarios]: next });
    } catch (e) { console.warn('[bg] Failed to persist scenario:', e); }
  }
  await sessionManager.stopRecordSession();
  return { ok: true, saved: shouldPersist && Boolean(scenario), scenario };
}

async function startReplaySession(payload) {
  const startUrl = String(payload?.startUrl || 'https://google.com').trim();
  const tabId = await ensureTabForUrl(startUrl);
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  _replayTask = { runId: payload?.runId, tabId, steps, index: 0, current: 0, paused: false, stopped: false, totalSteps: steps.length };
  await sessionManager.update([{ type: 'SET_MODE', mode: 'replay' }, { type: 'SET_TAB_ID', tabId }]);
  void replayLoop();
}

async function runDomStep(tabId, step) {
  const kind = String(step?.kind || 'unknown').toLowerCase();
  if (kind === 'nav') {
    const target = String(step?.url || '').trim();
    if (!target) throw new Error('nav step has no url');
    if (!isHttpUrl(target)) throw new Error(`nav step has invalid url: ${target.slice(0, 80)}`);
    await chrome.tabs.update(tabId, { url: target });
    await waitTabLoaded(tabId);
    return;
  }
  const waitMs = Math.max(800, Number(step?.meta?.waitMs || 4200));
  const pollMs = 120;
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (s, options) => {
      const stepKind = String(s?.kind || 'unknown').toLowerCase();
      const selector = typeof s?.selector === 'string' ? s.selector.trim() : '';
      const value = typeof s?.value === 'string' ? s.value : '';
      const timeoutMs = Number(options?.timeoutMs || 4200);
      const pollIntervalMs = Number(options?.pollIntervalMs || 120);
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const querySelectorDeep = (selectorText) => {
        if (!selectorText) return null;
        const roots = [document]; const visited = new Set();
        while (roots.length) {
          const root = roots.shift();
          if (!root || visited.has(root)) continue; visited.add(root);
          try { const match = root.querySelector(selectorText); if (match) return match; } catch { return null; }
          let descendants = [];
          try { descendants = Array.from(root.querySelectorAll('*')); } catch { descendants = []; }
          for (const el of descendants) { if (el && el.shadowRoot && !visited.has(el.shadowRoot)) roots.push(el.shadowRoot); }
        }
        return null;
      };
      const findTargetWithWait = async () => {
        const started = Date.now();
        while (Date.now() - started <= timeoutMs) {
          const found = selector ? querySelectorDeep(selector) : null;
          if (found) return found;
          await sleep(pollIntervalMs);
        }
        return null;
      };
      const ensureTarget = async () => {
        const target = await findTargetWithWait();
        if (!target) throw new Error(`target not found: ${selector}`);
        try { target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' }); } catch {}
        return target;
      };
      const typeInto = (target, val) => {
        if (!target) throw new Error('input target not found');
        target.focus?.();
        if (target.isContentEditable) { target.textContent = val; target.dispatchEvent(new InputEvent('input', { bubbles: true, data: val })); target.dispatchEvent(new Event('change', { bubbles: true })); return; }
        if ('value' in target) {
          const descriptor = Object.getOwnPropertyDescriptor(target.__proto__ || HTMLInputElement.prototype, 'value');
          if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(target, val); else target.value = val;
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        throw new Error('input target is not editable');
      };
      if (stepKind === 'click') { const target = await ensureTarget(); target.click(); return { ok: true }; }
      if (stepKind === 'change' || stepKind === 'input') { const target = await ensureTarget(); typeInto(target, value); return { ok: true }; }
      if (stepKind === 'submit') {
        const target = (await findTargetWithWait()) || document.activeElement;
        if (!target) throw new Error('submit target not found');
        const form = target.tagName === 'FORM' ? target : target.closest?.('form');
        if (form) { if (typeof form.requestSubmit === 'function') form.requestSubmit(); else form.submit?.(); return { ok: true }; }
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        return { ok: true };
      }
      return { ok: true };
    },
    args: [step, { timeoutMs: waitMs, pollIntervalMs: pollMs }],
  });
  if (!result?.ok) throw new Error(result?.error || 'Step execution failed');
  await new Promise(r => setTimeout(r, 120));
}

async function replayLoop() {
  const task = _replayTask;
  if (!task) return;
  while (task.index < task.steps.length && !task.stopped) {
    if (task.paused) { await new Promise(resolve => { task._unpauseResolve = resolve; }); task._unpauseResolve = null; continue; }
    const step = task.steps[task.index] || {};
    task.current = task.index + 1;
    const idx = task.current;
    sendWs('replay', { type: 'replay_step_start', payload: { runId: task.runId, index: idx, kind: step.kind || 'unknown', selector: step.selector || null, url: step.url || null } });
    try {
      await runDomStep(task.tabId, step);
      sendWs('replay', { type: 'replay_step_done', payload: { runId: task.runId, index: idx, kind: step.kind || 'unknown', selector: step.selector || null, url: step.url || null } });
      task.index += 1;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      await sessionManager.setError(errorMsg);
      task.stopped = true;
      sendWs('replay', { type: 'replay_step_fail', payload: { runId: task.runId, index: idx, kind: step.kind || 'unknown', selector: step.selector || null, url: step.url || null, error: errorMsg } });
      sendWs('replay', { type: 'replay_error', payload: { runId: task.runId, error: errorMsg } });
      break;
    }
  }
  if (!task.stopped && task.index >= task.steps.length) {
    sendWs('replay', { type: 'replay_finished', payload: { runId: task.runId } });
  }
  await sendToTab(task.tabId, { type: 'tk:recorder-state', payload: { mode: 'idle' } });
  _replayTask = null;
  await sessionManager.update([{ type: 'SET_MODE', mode: null }, { type: 'SET_TAB_ID', tabId: null }, { type: 'SET_ERROR', error: null }]);
}

async function applyReplayControl(command) {
  const task = _replayTask;
  if (!task) return;
  if (command === 'pause') { task.paused = true; }
  else if (command === 'resume' || command === 'continue') {
    task.paused = false;
    if (task._unpauseResolve) { task._unpauseResolve(); task._unpauseResolve = null; }
  }
  else if (command === 'stop' || command === 'abort' || command === 'cancel') {
    task.stopped = true;
    if (task._unpauseResolve) { task._unpauseResolve(); task._unpauseResolve = null; }
  }
}

// ── Tab event cleanup ──────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((removedTabId) => {
  const state = sessionManager.getState();
  if (state.tabId === removedTabId) {
    console.log(`[bg] Tab ${removedTabId} closed during active session — cleaning up`);
    if (state.mode === 'record' && removedTabId === state.tabId) { void stopRecordSession(); }
    else if (state.mode === 'replay' && removedTabId === state.tabId) { void applyReplayControl('stop'); }
  }
});

// ── Message Routing ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || '');

  // ── Stripe Filler ───────────────────────────────────────────────────
  if (type === 'tk:stripe-fill') {
    const tabId = sender?.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'No tab context' }); return true; }
    const cardData = message?.payload?.cardData || {};
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: fillStripeFields, args: [cardData] })
      .then(results => {
        const anyOk = results.some(r => r.result?.ok);
        // Aggregate what was filled across all frames for diagnostics
        const perFrame = results.map(r => ({
          host: r.result?.frameHost || '?',
          filled: r.result?.filled || [],
          isStripe: !!r.result?.isStripe,
          errors: r.result?.errors || undefined,
        }));
        sendResponse({
          ok: anyOk,
          filledFrames: results.filter(r => r.result?.filled?.length).length,
          perFrame,
        });
      }).catch(err => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (type === 'tk:stripe-detect') {
    const tabId = sender?.tab?.id;
    if (!tabId) { sendResponse({ ok: false, error: 'No tab context' }); return true; }
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: detectStripeFields })
      .then(results => {
        const anyOk = results.some(r => r.result?.ok);
        const perFrame = results.map(r => ({
          host: r.result?.frameHost || '?',
          detected: r.result?.detected || {},
          isStripe: !!r.result?.isStripe,
        }));
        sendResponse({
          ok: anyOk,
          detectedFrames: results.filter(r => r.result?.ok).length,
          perFrame,
        });
      }).catch(err => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  // ── Recorder commands from panel ────────────────────────────────────
  if (type === 'tk:recorder-start') {
    const payload = message?.payload || {};
    void (async () => {
      try {
        const check = sessionManager.getMode();
        if (check !== null) { sendResponse({ ok: false, error: `Session already active: ${check}` }); return; }
        await startRecordSession({ ...payload, origin: 'toolkit' });
        sendResponse({ ok: true, runId: sessionManager.getState().record?.runId });
      } catch (e) { sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    })();
    return true;
  }

  if (type === 'tk:recorder-stop') {
    void (async () => {
      try {
        const result = await stopRecordSession();
        sendResponse({ ok: true, scenario: result.scenario });
      } catch (e) { sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    })();
    return true;
  }

  if (type === 'tk:recorder-status') {
    sendResponse({ ok: true, mode: sessionManager.getMode(), stepCount: sessionManager.getStepCount(), paused: sessionManager.isPaused() });
    return true;
  }

  if (type === 'tk:recorder-save') {
    void (async () => {
      try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.scenarios]);
        const scenarios = Array.isArray(data?.[STORAGE_KEYS.scenarios]) ? data[STORAGE_KEYS.scenarios] : [];
        sendResponse({ ok: true, scenarios });
      } catch (e) { sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    })();
    return true;
  }

  if (type === 'tk:replay-start') {
    void (async () => {
      try {
        const payload = message?.payload || {};
        await startReplaySession(payload);
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    })();
    return true;
  }

  if (type === 'tk:replay-control') {
    void (async () => {
      applyReplayControl(String(message?.payload?.command || '').toLowerCase());
      sendResponse({ ok: true });
    })();
    return true;
  }

  // ── Events from content script (clicks, inputs) during recording ──────
  if (type === 'tk:record-event') {
    const step = normalizeStep(message?.payload || {});
    sendWs('record', { type: 'record_event', payload: step });
    if (sessionManager.isRecording()) { void sessionManager.addStep(step); }
    sendResponse({ ok: true });
    return true;
  }

  if (type === 'tk:status') {
    const state = sessionManager.getState();
    sendResponse({
      ok: true,
      mode: state.mode,
      version: state.version,
      record: state.record ? { runId: state.record.runId, stepCount: state.record.stepCount, paused: state.record.paused } : null,
      replay: _replayTask ? { runId: _replayTask.runId, current: _replayTask.current, total: _replayTask.totalSteps, paused: _replayTask.paused } : null,
      bridges: { record: bridgeIsOnline('record'), replay: bridgeIsOnline('replay'), health: bridgeIsOnline('health') },
    });
    return true;
  }

  return false;
});

// ── Stripe Filler — runs inside every frame ────────────────────────────────
// Language-agnostic: relies on stable `id` and `autocomplete` attributes
// that Stripe does not localize.  Works on checkout.stripe.com and
// embedded Stripe Elements regardless of UI language.
function fillStripeFields(cardData) {
  const filled = [];
  const errors = [];

  // Priority order: id → name → autocomplete → aria-label → data-testid →
  // placeholder (partial) → inputmode → label text (fuzzy, last resort)
  function findField(priority) {
    for (const { by, val } of priority) {
      try {
        let el = null;
        if (by === 'id') {
          el = document.getElementById(val);
        } else if (by === 'name') {
          el = document.querySelector(`[name="${CSS.escape(val)}"]`);
        } else if (by === 'autocomplete') {
          el = document.querySelector(`[autocomplete="${CSS.escape(val)}"]`);
        } else if (by === 'inputmode') {
          el = document.querySelector(`input[inputmode="${CSS.escape(val)}"]`);
        } else if (by === 'aria-label') {
          // Case-insensitive partial match on aria-label
          const all = document.querySelectorAll('[aria-label]');
          const vLow = val.toLowerCase();
          for (const a of all) {
            if ((a.getAttribute('aria-label') || '').toLowerCase().includes(vLow)) { el = a; break; }
          }
        } else if (by === 'data-testid') {
          el = document.querySelector(`[data-testid="${CSS.escape(val)}"]`);
        } else if (by === 'placeholder') {
          // Case-insensitive partial match on placeholder
          const all = document.querySelectorAll('input, textarea, select');
          const vLow = val.toLowerCase();
          for (const a of all) {
            if ((a.placeholder || '').toLowerCase().includes(vLow)) { el = a; break; }
          }
        } else if (by === 'label') {
          // Find a <label> whose text contains val, then return its control
          const labels = document.querySelectorAll('label');
          const vLow = val.toLowerCase();
          for (const lab of labels) {
            if ((lab.textContent || '').toLowerCase().includes(vLow)) {
              const forId = lab.getAttribute('for');
              if (forId) { el = document.getElementById(forId); if (el) break; }
              const child = lab.querySelector('input, select, textarea');
              if (child) { el = child; break; }
            }
          }
        }
        if (el) return el;
      } catch { continue; }
    }
    return null;
  }

  function setValue(el, value) {
    if (!el) return false;
    try {
      el.focus();
      const tag = el.tagName?.toLowerCase();
      if (tag === 'select') {
        const v = String(value || '').trim();
        // 1) Try direct value match
        el.value = v;
        // 2) If not selected, search option by value or text (case-insensitive)
        if (el.value !== v && el.options) {
          const vLow = v.toLowerCase();
          for (const opt of el.options) {
            if ((opt.value || '').toLowerCase() === vLow ||
                (opt.text || '').toLowerCase() === vLow) {
              el.value = opt.value;
              break;
            }
          }
        }
        // 3) For country codes, also try common variations (US → United States)
        if (el.value !== v && el.options && v.length === 2) {
          const vLow = v.toLowerCase();
          for (const opt of el.options) {
            const optVal = (opt.value || '').toLowerCase();
            const optText = (opt.text || '').toLowerCase();
            if (optVal === vLow || optText.startsWith(vLow) || optText.includes(vLow)) {
              el.value = opt.value;
              break;
            }
          }
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      const descriptor = Object.getOwnPropertyDescriptor(el.__proto__ || HTMLInputElement.prototype, 'value');
      if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  const { number, month, year, cvc, expiry, name, country, address, city, state, postalCode } = cardData;

  // 1. Card number
  if (number) {
    const el = findField([
      { by: 'id', val: 'cardNumber' },
      { by: 'autocomplete', val: 'cc-number' },
      { by: 'name', val: 'cardNumber' },
    ]);
    if (el && setValue(el, number)) filled.push('number');
  }

  // 2. Expiry (single field)
  if (expiry || (month && year)) {
    const el = findField([
      { by: 'id', val: 'cardExpiry' },
      { by: 'autocomplete', val: 'cc-exp' },
      { by: 'name', val: 'cardExpiry' },
    ]);
    if (el) {
      const val = expiry || `${month}/${year.slice(-2)}`;
      if (setValue(el, val)) filled.push('expiry');
    } else {
      // Separate month / year fields (fallback)
      const mEl = findField([
        { by: 'id', val: 'cardExpiry-month' },
        { by: 'autocomplete', val: 'cc-exp-month' },
        { by: 'name', val: 'exp_month' },
      ]);
      const yEl = findField([
        { by: 'id', val: 'cardExpiry-year' },
        { by: 'autocomplete', val: 'cc-exp-year' },
        { by: 'name', val: 'exp_year' },
      ]);
      if (mEl && setValue(mEl, month)) filled.push('exp-month');
      if (yEl && setValue(yEl, year)) filled.push('exp-year');
    }
  }

  // 3. CVC
  if (cvc) {
    const el = findField([
      { by: 'id', val: 'cardCvc' },
      { by: 'autocomplete', val: 'cc-csc' },
      { by: 'name', val: 'cardCvc' },
    ]);
    if (el && setValue(el, cvc)) filled.push('cvc');
  }

  // 4. Billing name
  if (name) {
    const el = findField([
      { by: 'id', val: 'billingName' },
      { by: 'autocomplete', val: 'cc-name' },
      { by: 'autocomplete', val: 'name' },
      { by: 'name', val: 'billingName' },
      { by: 'name', val: 'name' },
      { by: 'aria-label', val: 'name' },
      { by: 'aria-label', val: 'full name' },
      { by: 'placeholder', val: 'name' },
      { by: 'data-testid', val: 'name' },
      { by: 'label', val: 'name' },
    ]);
    if (el && setValue(el, name)) filled.push('name');
  }

  // 5. Billing country
  if (country) {
    const el = findField([
      { by: 'id', val: 'billingCountry' },
      { by: 'id', val: 'country' },
      { by: 'autocomplete', val: 'billing country' },
      { by: 'autocomplete', val: 'country' },
      { by: 'autocomplete', val: 'country-name' },
      { by: 'name', val: 'billingCountry' },
      { by: 'name', val: 'country' },
      { by: 'name', val: 'country_code' },
      { by: 'aria-label', val: 'country' },
      { by: 'data-testid', val: 'country' },
      { by: 'label', val: 'country' },
    ]);
    if (el && setValue(el, country)) filled.push('country');
  }

  // 6. Billing address line 1
  if (address) {
    const el = findField([
      { by: 'id', val: 'billingAddressLine1' },
      { by: 'id', val: 'address' },
      { by: 'id', val: 'address_line1' },
      { by: 'autocomplete', val: 'billing address-line1' },
      { by: 'autocomplete', val: 'address-line1' },
      { by: 'autocomplete', val: 'street-address' },
      { by: 'autocomplete', val: 'address' },
      { by: 'name', val: 'billingAddressLine1' },
      { by: 'name', val: 'address' },
      { by: 'name', val: 'address_line1' },
      { by: 'aria-label', val: 'address' },
      { by: 'data-testid', val: 'address' },
      { by: 'placeholder', val: 'address' },
      { by: 'label', val: 'address' },
    ]);
    if (el && setValue(el, address)) filled.push('address');
  }

  // 7. Postal code
  if (postalCode) {
    const el = findField([
      { by: 'id', val: 'billingPostalCode' },
      { by: 'id', val: 'postalCode' },
      { by: 'id', val: 'postal_code' },
      { by: 'id', val: 'zip' },
      { by: 'autocomplete', val: 'billing postal-code' },
      { by: 'autocomplete', val: 'postal-code' },
      { by: 'autocomplete', val: 'zip' },
      { by: 'name', val: 'billingPostalCode' },
      { by: 'name', val: 'postal_code' },
      { by: 'name', val: 'postalCode' },
      { by: 'name', val: 'zip' },
      { by: 'name', val: 'zip_code' },
      { by: 'aria-label', val: 'zip' },
      { by: 'aria-label', val: 'postal' },
      { by: 'data-testid', val: 'postal' },
      { by: 'data-testid', val: 'zip' },
      { by: 'placeholder', val: 'zip' },
      { by: 'placeholder', val: 'postal' },
      { by: 'label', val: 'zip' },
      { by: 'label', val: 'postal' },
    ]);
if (el && setValue(el, postalCode)) filled.push('postalCode');
  }

  // 8. City
  if (city) {
    const el = findField([
      { by: 'id', val: 'billingLocality' },
      { by: 'id', val: 'billingCity' },
      { by: 'id', val: 'city' },
      { by: 'autocomplete', val: 'address-level2' },
      { by: 'name', val: 'billingLocality' },
      { by: 'name', val: 'billingCity' },
      { by: 'name', val: 'city' },
      { by: 'aria-label', val: 'city' },
      { by: 'data-testid', val: 'city' },
      { by: 'placeholder', val: 'city' },
      { by: 'label', val: 'city' },
    ]);
    if (el && setValue(el, city)) filled.push('city');
  }

  // 9. State / Region
  if (state) {
    const el = findField([
      { by: 'id', val: 'billingAdministrativeArea' },
      { by: 'id', val: 'billingState' },
      { by: 'id', val: 'state' },
      { by: 'autocomplete', val: 'address-level1' },
      { by: 'name', val: 'billingAdministrativeArea' },
      { by: 'name', val: 'billingState' },
      { by: 'name', val: 'state' },
      { by: 'name', val: 'address_state' },
      { by: 'aria-label', val: 'state' },
      { by: 'aria-label', val: 'region' },
      { by: 'data-testid', val: 'state' },
      { by: 'placeholder', val: 'state' },
      { by: 'label', val: 'state' },
      { by: 'label', val: 'region' },
    ]);
    if (el && setValue(el, state)) filled.push('state');
  }

  return {
    ok: filled.length > 0,
    filled,
    errors: errors.length ? errors : undefined,
    frameHost: location.hostname,
    isStripe: location.hostname.includes('stripe') || location.hostname.includes('js.stripe.com'),
  };
}

// ── Stripe Field Detector — diagnostics for VPN/locale changes ────────────
// Returns which fields are present on the page without filling them.
function detectStripeFields() {
  // Reuse the same findField logic from fillStripeFields (inlined for executeScript)
  function findField(priority) {
    for (const { by, val } of priority) {
      try {
        let el = null;
        if (by === 'id') {
          el = document.getElementById(val);
        } else if (by === 'name') {
          el = document.querySelector(`[name="${CSS.escape(val)}"]`);
        } else if (by === 'autocomplete') {
          el = document.querySelector(`[autocomplete="${CSS.escape(val)}"]`);
        } else if (by === 'inputmode') {
          el = document.querySelector(`input[inputmode="${CSS.escape(val)}"]`);
        } else if (by === 'aria-label') {
          const all = document.querySelectorAll('[aria-label]');
          const vLow = val.toLowerCase();
          for (const a of all) {
            if ((a.getAttribute('aria-label') || '').toLowerCase().includes(vLow)) { el = a; break; }
          }
        } else if (by === 'data-testid') {
          el = document.querySelector(`[data-testid="${CSS.escape(val)}"]`);
        } else if (by === 'placeholder') {
          const all = document.querySelectorAll('input, textarea, select');
          const vLow = val.toLowerCase();
          for (const a of all) {
            if ((a.placeholder || '').toLowerCase().includes(vLow)) { el = a; break; }
          }
        } else if (by === 'label') {
          const labels = document.querySelectorAll('label');
          const vLow = val.toLowerCase();
          for (const lab of labels) {
            if ((lab.textContent || '').toLowerCase().includes(vLow)) {
              const forId = lab.getAttribute('for');
              if (forId) { el = document.getElementById(forId); if (el) break; }
              const child = lab.querySelector('input, select, textarea');
              if (child) { el = child; break; }
            }
          }
        }
        if (el) return el;
      } catch { continue; }
    }
    return null;
  }

  const checks = {
    number: [
      { by: 'id', val: 'cardNumber' },
      { by: 'autocomplete', val: 'cc-number' },
      { by: 'name', val: 'cardNumber' },
    ],
    expiry: [
      { by: 'id', val: 'cardExpiry' },
      { by: 'autocomplete', val: 'cc-exp' },
      { by: 'name', val: 'cardExpiry' },
    ],
    cvc: [
      { by: 'id', val: 'cardCvc' },
      { by: 'autocomplete', val: 'cc-csc' },
      { by: 'name', val: 'cardCvc' },
    ],
    name: [
      { by: 'id', val: 'billingName' },
      { by: 'autocomplete', val: 'cc-name' },
      { by: 'autocomplete', val: 'name' },
      { by: 'name', val: 'billingName' },
      { by: 'name', val: 'name' },
      { by: 'aria-label', val: 'name' },
      { by: 'aria-label', val: 'full name' },
      { by: 'placeholder', val: 'name' },
      { by: 'data-testid', val: 'name' },
      { by: 'label', val: 'name' },
    ],
    country: [
      { by: 'id', val: 'billingCountry' },
      { by: 'id', val: 'country' },
      { by: 'autocomplete', val: 'billing country' },
      { by: 'autocomplete', val: 'country' },
      { by: 'autocomplete', val: 'country-name' },
      { by: 'name', val: 'billingCountry' },
      { by: 'name', val: 'country' },
      { by: 'name', val: 'country_code' },
      { by: 'aria-label', val: 'country' },
      { by: 'data-testid', val: 'country' },
      { by: 'label', val: 'country' },
    ],
    address: [
      { by: 'id', val: 'billingAddressLine1' },
      { by: 'id', val: 'address' },
      { by: 'id', val: 'address_line1' },
      { by: 'autocomplete', val: 'billing address-line1' },
      { by: 'autocomplete', val: 'address-line1' },
      { by: 'autocomplete', val: 'street-address' },
      { by: 'autocomplete', val: 'address' },
      { by: 'name', val: 'billingAddressLine1' },
      { by: 'name', val: 'address' },
      { by: 'name', val: 'address_line1' },
      { by: 'aria-label', val: 'address' },
      { by: 'data-testid', val: 'address' },
      { by: 'placeholder', val: 'address' },
      { by: 'label', val: 'address' },
    ],
    city: [
      { by: 'id', val: 'billingLocality' },
      { by: 'id', val: 'billingCity' },
      { by: 'id', val: 'city' },
      { by: 'autocomplete', val: 'address-level2' },
      { by: 'name', val: 'billingLocality' },
      { by: 'name', val: 'billingCity' },
      { by: 'name', val: 'city' },
      { by: 'aria-label', val: 'city' },
      { by: 'data-testid', val: 'city' },
      { by: 'placeholder', val: 'city' },
      { by: 'label', val: 'city' },
    ],
    state: [
      { by: 'id', val: 'billingAdministrativeArea' },
      { by: 'id', val: 'billingState' },
      { by: 'id', val: 'state' },
      { by: 'autocomplete', val: 'address-level1' },
      { by: 'name', val: 'billingAdministrativeArea' },
      { by: 'name', val: 'billingState' },
      { by: 'name', val: 'state' },
      { by: 'aria-label', val: 'state' },
      { by: 'aria-label', val: 'region' },
      { by: 'data-testid', val: 'state' },
      { by: 'placeholder', val: 'state' },
      { by: 'label', val: 'state' },
      { by: 'label', val: 'region' },
    ],
      { by: 'name', val: 'billingCity' },
      { by: 'name', val: 'city' },
      { by: 'name', val: 'address_city' },
      { by: 'aria-label', val: 'city' },
      { by: 'data-testid', val: 'city' },
      { by: 'placeholder', val: 'city' },
      { by: 'label', val: 'city' },
    ],
    state: [
      { by: 'id', val: 'billingState' },
      { by: 'id', val: 'state' },
      { by: 'autocomplete', val: 'address-level1' },
      { by: 'name', val: 'billingState' },
      { by: 'name', val: 'state' },
      { by: 'name', val: 'address_state' },
      { by: 'aria-label', val: 'state' },
      { by: 'aria-label', val: 'region' },
      { by: 'data-testid', val: 'state' },
      { by: 'placeholder', val: 'state' },
      { by: 'label', val: 'state' },
      { by: 'label', val: 'region' },
    ],
    postalCode: [
      { by: 'id', val: 'billingPostalCode' },
      { by: 'id', val: 'postalCode' },
      { by: 'id', val: 'postal_code' },
      { by: 'id', val: 'zip' },
      { by: 'autocomplete', val: 'billing postal-code' },
      { by: 'autocomplete', val: 'postal-code' },
      { by: 'autocomplete', val: 'zip' },
      { by: 'name', val: 'billingPostalCode' },
      { by: 'name', val: 'postal_code' },
      { by: 'name', val: 'postalCode' },
      { by: 'name', val: 'zip' },
      { by: 'name', val: 'zip_code' },
      { by: 'aria-label', val: 'zip' },
      { by: 'aria-label', val: 'postal' },
      { by: 'data-testid', val: 'postal' },
      { by: 'data-testid', val: 'zip' },
      { by: 'placeholder', val: 'zip' },
      { by: 'placeholder', val: 'postal' },
      { by: 'label', val: 'zip' },
      { by: 'label', val: 'postal' },
    ],
  };

  const detected = {};
  for (const [field, priority] of Object.entries(checks)) {
    const el = findField(priority);
    if (el) {
      detected[field] = {
        tag: el.tagName.toLowerCase(),
        type: el.type || undefined,
        id: el.id || undefined,
        name: el.getAttribute('name') || undefined,
        autocomplete: el.getAttribute('autocomplete') || undefined,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        placeholder: el.placeholder || undefined,
        dataTestid: el.getAttribute('data-testid') || undefined,
        labelText: (() => {
          const forId = el.id;
          if (forId) {
            const lab = document.querySelector(`label[for="${CSS.escape(forId)}"]`);
            if (lab) return lab.textContent.trim().slice(0, 80);
          }
          const parentLab = el.closest('label');
          if (parentLab) return parentLab.textContent.trim().slice(0, 80);
          return undefined;
        })(),
      };
    }
  }
  return {
    ok: Object.keys(detected).length > 0,
    detected,
    frameHost: location.hostname,
    isStripe: location.hostname.includes('stripe') || location.hostname.includes('js.stripe.com'),
  };
}

// ── Startup ────────────────────────────────────────────────────────────────
// Lazy connection: don't auto-connect on startup.
// WebSocket bridges connect only when sendWs() is called (on-demand).
// This avoids ERR_CONNECTION_REFUSED spam when Stitch Manager is not running.
// If you need immediate connection, call reconnectAllBridges() manually.
// chrome.runtime.onInstalled.addListener(() => reconnectAllBridges());
// chrome.runtime.onStartup.addListener(() => reconnectAllBridges());
console.log('[Stitch Toolkit] Background service worker started. WS bridges in lazy mode.');
