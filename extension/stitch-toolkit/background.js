// Stitch Toolkit — Unified Background Service Worker
// Merged from stitch-scenario-runner (canonical WS bridge + record/replay engine)
// and stitch-toolkit (panel tool handlers).
//
// WS bridge protocol (ports in shared.js):
//   record 18731 ← python/run_extension_record.py
//   replay 18732 ← python/run_extension_replay.py
//   health 18733 ← python/probe_extension_bridge.py (ping/pong)

import { BRIDGE_PORTS, STORAGE_KEYS, TOOLKIT_VERSION } from './shared.js';
import { sessionManager } from './session-manager.js';

const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_RECONNECT_DELAY = 30000;
const MAX_OUTBOUND_QUEUE_SIZE = 200;
// Pace auto-connect attempts across service-worker restarts (every page load
// wakes the worker via overlay-sync; without a guard CloakBrowser profiles
// would spam connection attempts to the bridge ports).
const BRIDGE_AUTOCONNECT_GUARD_MS = 45000;

let _replayTask = null;

const bridgeState = {
  record: { ws: null, connecting: false, outboundQueue: [], reconnectAttempt: 0, status: 'offline', lock: null },
  replay: { ws: null, connecting: false, outboundQueue: [], reconnectAttempt: 0, status: 'offline', lock: null },
  health: { ws: null, connecting: false, outboundQueue: [], reconnectAttempt: 0, status: 'offline', lock: null },
};

async function canStartSession(newMode) {
  const currentMode = sessionManager.getMode();
  const currentTabId = sessionManager.getState().tabId;

  if (currentMode !== null) {
    return {
      ok: false,
      error: `Session already active: ${currentMode}`,
      currentMode,
    };
  }
  if (currentTabId != null) {
    try {
      await chrome.tabs.get(currentTabId);
    } catch {
      return {
        ok: false,
        error: `Previous session tab (${currentTabId}) no longer exists`,
      };
    }
  }
  return { ok: true };
}

async function stopCurrentSession(force = false) {
  if (sessionManager.isRecording()) {
    await stopRecordSession({ skipNotifyTab: true, persist: false });
  } else if (sessionManager.isReplaying()) {
    await applyReplayControl('stop');
  }
}

let _saveTimer = null;
async function saveSessionToStorage() {
  if (!sessionManager.isRecording()) {
    await chrome.storage.session.remove(STORAGE_KEYS.sessionBackup).catch((e) => {
      console.warn('[bg] Failed to clear session backup:', e);
    });
    return;
  }
  const state = sessionManager.getState();
  const record = state.record;
  const backup = {
    mode: state.mode,
    tabId: state.tabId,
    record: {
      runId: record.runId,
      scenarioName: record.scenarioName,
      startUrl: record.startUrl,
      origin: record.origin,
      steps: record.steps,
      stepCount: record.stepCount,
      paused: record.paused,
    },
  };
  await chrome.storage.session.set({ [STORAGE_KEYS.sessionBackup]: backup }).catch((e) => {
    console.warn('[bg] Failed to save session to storage:', e);
  });
}

function scheduleSaveSessionToStorage() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    void saveSessionToStorage();
  }, 1000);
}

async function restoreSessionFromStorage() {
  try {
    const data = await chrome.storage.session.get(STORAGE_KEYS.sessionBackup);
    const backup = data?.[STORAGE_KEYS.sessionBackup];
    if (!backup || backup.mode !== 'record' || !backup.record) return;
    sessionManager._restoreRecordState(backup.record, backup.tabId);
    console.log('[bg] Restored recording session from storage:', sessionManager.getStepCount(), 'steps');
  } catch {}
}

void restoreSessionFromStorage();

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stableRunId(prefix = 'popup') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toIso(ts = Date.now()) {
  try {
    return new Date(ts).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || '').trim());
}

function normalizeRecordedStep(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const kind = String(source.kind || 'unknown').trim() || 'unknown';
  return {
    kind,
    ts: String(source.ts || toIso()).trim() || toIso(),
    url: typeof source.url === 'string' ? source.url : null,
    selector: typeof source.selector === 'string' ? source.selector : null,
    value: typeof source.value === 'string' ? source.value : null,
    meta: source.meta && typeof source.meta === 'object' ? source.meta : {},
    frameSrc: typeof source.frameSrc === 'string' ? source.frameSrc : null,
  };
}

function buildScenarioFromRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const steps = Array.isArray(record.steps) ? record.steps : [];
  const sanitizedSteps = steps.map(normalizeRecordedStep).filter(step => Boolean(step?.kind));

  if (!sanitizedSteps.length) return null;

  const firstNav = sanitizedSteps.find(s => String(s?.kind || '').toLowerCase() === 'nav');
  const startUrl =
    (isHttpUrl(record.startUrl) ? String(record.startUrl).trim() : '') ||
    (isHttpUrl(firstNav?.url) ? String(firstNav.url).trim() : '') ||
    'https://google.com';

  const importedAt = toIso();
  const scenarioId = String(record.runId || '').trim() || stableRunId('scenario');
  const name =
    String(record.scenarioName || '').trim() ||
    `Recorded ${importedAt.slice(0, 19).replace('T', ' ')}`;

  return {
    id: scenarioId,
    name,
    startUrl,
    steps: sanitizedSteps,
    importedAt,
    source: 'extension-record',
  };
}

async function persistLocalScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') return;
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.scenarios,
    STORAGE_KEYS.selectedScenarioId,
  ]);
  const existing = Array.isArray(data?.[STORAGE_KEYS.scenarios])
    ? data[STORAGE_KEYS.scenarios]
    : [];
  const next = [...existing, scenario].slice(-50);
  await chrome.storage.local.set({
    [STORAGE_KEYS.scenarios]: next,
    [STORAGE_KEYS.selectedScenarioId]: scenario.id,
  });
}

function normalizePopupReplayPayload(payload) {
  const obj = payload && typeof payload === 'object' ? payload : {};
  const steps = Array.isArray(obj.steps) ? obj.steps : [];
  const fromStep = Number(obj.fromStep || 1);

  const candidateStart = String(obj.startUrl || obj.startedUrl || obj.url || '').trim();
  const firstNav = steps.find(s => {
    const kind = String(s?.kind || s?.type || '').toLowerCase();
    return kind === 'nav' || kind === 'navigate';
  });
  const navUrl = String(firstNav?.url || '').trim();

  const startUrl =
    (candidateStart && /^https?:\/\//i.test(candidateStart) ? candidateStart : '') ||
    (navUrl && /^https?:\/\//i.test(navUrl) ? navUrl : '') ||
    'https://google.com';

  if (!steps.length) {
    throw new Error('Replay payload has no steps');
  }

  return {
    runId: String(obj.runId || '').trim() || stableRunId('popup_replay'),
    scenarioName: String(obj.scenarioName || obj.name || '').trim() || 'popup_replay',
    startUrl,
    steps,
    fromStep: Number.isFinite(fromStep) && fromStep > 0 ? Math.floor(fromStep) : 1,
  };
}

function sendWs(kind, payload) {
  const state = bridgeState[kind];
  if (!state) return 'error';
  const ws = state.ws;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    if (state.outboundQueue.length < MAX_OUTBOUND_QUEUE_SIZE) {
      state.outboundQueue.push(payload);
    }
    return 'queued';
  }

  try {
    ws.send(JSON.stringify(payload));
    return 'sent';
  } catch {
    if (state.outboundQueue.length < MAX_OUTBOUND_QUEUE_SIZE) {
      state.outboundQueue.push(payload);
    }
    return 'queued';
  }
}

function flushOutboundQueue(kind) {
  const state = bridgeState[kind];
  if (!state || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  const queue = state.outboundQueue;
  state.outboundQueue = [];

  for (const payload of queue) {
    try {
      state.ws.send(JSON.stringify(payload));
    } catch {
      state.outboundQueue.push(payload);
    }
  }
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

async function waitTabLoaded(tabId, timeoutMs = 20000) {
  // Poll instead of a one-shot onUpdated listener: fast pages (localhost)
  // can reach 'complete' before the listener is registered, which made the
  // listener variant wait the full timeout and stall session start.
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return false;
    if (tab.status === 'complete') return true;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
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

  if (url && /^https?:\/\//i.test(url)) {
    await chrome.tabs.update(tabId, { url });
    await waitTabLoaded(tabId);
  }
  return tabId;
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (e) {
    console.warn('[bg] sendToTab failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

async function ensureExtensionContentScripts(tabId) {
  const probeOk = await sendToTab(tabId, { type: 'stitch:overlay-sync' });
  if (probeOk) return true;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'i18n.js',
        'overlay_runtime.js',
        'content_state.js',
        'content_redaction.js',
        'content_selectors.js',
        'content_overlay.js',
        'content_recorder.js',
        'content_runner.js',
      ],
    });
  } catch {
    return false;
  }

  await new Promise(r => setTimeout(r, 80));
  return await sendToTab(tabId, { type: 'stitch:overlay-sync' });
}

function getOverlayPayload() {
  const mode = sessionManager.getMode();

  if (mode === 'record') {
    const record = sessionManager.getState().record;
    const suppressOverlay = Boolean(record?.suppressOverlay);
    return {
      mode: 'record',
      paused: sessionManager.isPaused(),
      status: sessionManager.isPaused() ? 'paused' : 'running',
      runId: record?.runId || null,
      scenarioName: record?.scenarioName || null,
      startUrl: record?.startUrl || null,
      // Tells the content overlay to capture silently when a native HUD (or
      // no HUD) is in charge. Shard keeps it false so the extension HUD is
      // the visible control surface.
      suppressOverlay,
      record: {
        stepCount: sessionManager.getStepCount(),
        steps: sessionManager.getSteps(),
      },
    };
  }

  if (mode === 'replay' && _replayTask) {
    const replayStatus = _replayTask.status || 'running';
    let uiStatus = replayStatus;
    if (replayStatus === 'manual-paused') {
      uiStatus = 'manual-paused';
    } else if (_replayTask.paused) {
      uiStatus = 'paused';
    }

    return {
      mode: 'replay',
      paused: Boolean(_replayTask.paused) || replayStatus === 'manual-paused',
      status: uiStatus,
      replay: {
        current: Number(_replayTask.current || 0),
        total: Number(_replayTask.totalSteps || _replayTask.steps?.length || 0),
        steps: Array.isArray(_replayTask.steps) ? _replayTask.steps : [],
      },
      error: sessionManager.getState().lastError || null,
    };
  }

  return {
    mode: 'idle',
    paused: false,
    status: 'idle',
    record: { stepCount: 0, steps: [] },
    replay: { current: 0, total: 0, steps: [] },
  };
}

function getOverlayPayloadForTab(tabId) {
  if (tabId == null) return getOverlayPayload();
  const stateTabId = sessionManager.getState().tabId;
  if (stateTabId == null) return getOverlayPayload();
  const state = sessionManager.getState();
  if (state.mode === 'record' && state.record?.nativeHosted) {
    // Native-hosted capture runs in every tab of the recorder browser;
    // any tab asking for a sync gets the live record state.
    return getOverlayPayload();
  }
  if (tabId !== stateTabId) {
    return {
      mode: 'idle',
      paused: false,
      status: 'idle',
      record: { stepCount: 0, steps: [] },
      replay: { current: 0, total: 0, steps: [] },
    };
  }
  return getOverlayPayload();
}

async function pushOverlayState(tabId = sessionManager.getState().tabId) {
  const state = sessionManager.getState();
  if (state.mode === 'record' && state.record?.nativeHosted) {
    // Broadcast to every tab so capture starts/stops and pause state syncs
    // across the whole recorder browser, not just the session tab.
    const payload = getOverlayPayload();
    const tabs = await chrome.tabs.query({}).catch(() => []);
    for (const t of Array.isArray(tabs) ? tabs : []) {
      if (t?.id != null) {
        await sendToTab(t.id, { type: 'stitch:overlay-state', payload });
      }
    }
    return;
  }
  if (tabId == null) return;
  await sendToTab(tabId, {
    type: 'stitch:overlay-state',
    payload: getOverlayPayload(),
  });
}

async function applyRecordControl(command) {
  if (!sessionManager.isRecording()) return;
  const normalized = String(command || '').toLowerCase();
  if (normalized === 'stop' || normalized === 'abort' || normalized === 'cancel') {
    await stopRecordSession();
    return;
  }
  if (normalized === 'pause') {
    await sessionManager.setPaused(true);
  }
  if ((normalized === 'resume' || normalized === 'continue')) {
    await sessionManager.setPaused(false);
  }
  const tabId = sessionManager.getState().tabId;
  if (tabId != null) {
    await sendToTab(tabId, {
      type: 'stitch:control',
      payload: { command: normalized },
    });
  }
  await pushOverlayState();
}

async function runDomStep(tabId, step) {
  const kind = String(step?.kind || 'unknown').toLowerCase();

  if (kind === 'manual' || kind === 'manual-continue') {
    sendWs('replay', {
      type: 'replay_step_waiting',
      payload: {
        runId: _replayTask?.runId,
        index: _replayTask?.current || 0,
        kind: kind,
        message: 'Manual action required',
      },
    });

    _replayTask.status = 'manual-paused';
    await pushOverlayState(tabId);

    let manualResolve = null;
    const manualSignal = new Promise(resolve => { manualResolve = resolve; });
    _replayTask._manualResolve = manualResolve;

    const tabBeforeWait = await chrome.tabs.get(tabId).catch(() => null);
    if (!tabBeforeWait) {
      console.log('[bg] Tab closed before manual step — stopping replay');
      if (_replayTask) _replayTask.stopped = true;
    }

    await manualSignal;
    if (_replayTask) _replayTask._manualResolve = null;

    if (_replayTask) {
      _replayTask.manualContinue = false;
      _replayTask.status = 'running';
    }

    return { ok: true, skipped: true, reason: 'manual-step' };
  }

  if (kind === 'nav' || kind === 'goto' || kind === 'navigate') {
    const target = String(step?.url || '').trim();
    if (!target) throw new Error('nav step has no url');
    if (!/^https?:\/\//i.test(target)) {
      throw new Error(`nav step has invalid url (only http/https allowed): ${target.slice(0, 80)}`);
    }
    await chrome.tabs.update(tabId, { url: target });
    await waitTabLoaded(tabId);
    return;
  }

  if (kind === 'proxy.switch' || kind === 'unknown') {
    return;
  }

  const waitMs = Math.max(800, Number(step?.meta?.waitMs || 4200));
  const pollMs = 120;

  const frameSrc = step.frameSrc || step.meta?.frameSrc || null;
  let scriptTarget = { tabId };
  if (frameSrc) {
    try {
      const allFrames = await chrome.webNavigation.getAllFrames({ tabId });
      if (allFrames) {
        const match = allFrames.find(f => f.url === frameSrc && f.frameId !== 0);
        if (match) {
          scriptTarget = { tabId, frameIds: [match.frameId] };
        }
      }
    } catch {}
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: scriptTarget,
    func: async (s, options) => {
      const stepKind = String(s?.kind || 'unknown').toLowerCase();
      const selector = typeof s?.selector === 'string' ? s.selector.trim() : '';
      const value = typeof s?.value === 'string' ? s.value : '';
      const timeoutMs = Number(options?.timeoutMs || 4200);
      const pollIntervalMs = Number(options?.pollIntervalMs || 120);
      const locators =
        s?.meta &&
        typeof s.meta === 'object' &&
        s.meta.locators &&
        typeof s.meta.locators === 'object'
          ? s.meta.locators
          : s?.locators && typeof s.locators === 'object'
            ? s.locators
            : {};

      const cssCandidatesRaw = Array.isArray(locators.css) ? locators.css : [];
      const cssCandidates = [];
      const cssSeen = new Set();

      const pushCss = candidate => {
        const next = String(candidate || '').trim();
        if (!next || cssSeen.has(next)) return;
        cssSeen.add(next);
        cssCandidates.push(next);
      };

      if (selector) pushCss(selector);
      for (const candidate of cssCandidatesRaw) pushCss(candidate);

      const textLocator =
        locators.text && typeof locators.text === 'object'
          ? {
              tag: String(locators.text.tag || '')
                .trim()
                .toLowerCase(),
              value: String(locators.text.value || '')
                .replace(/\s+/g, ' ')
                .trim(),
            }
          : null;

      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

      const normalizeText = input =>
        String(input || '')
          .replace(/\s+/g, ' ')
          .trim();

      const querySelectorDeep = selectorText => {
        if (!selectorText) return null;

        const roots = [document];
        const visited = new Set();

        while (roots.length) {
          const root = roots.shift();
          if (!root || visited.has(root)) continue;
          visited.add(root);

          try {
            const match = root.querySelector(selectorText);
            if (match) return match;
          } catch {
            return null;
          }

          let descendants = [];
          try {
            descendants = Array.from(root.querySelectorAll('*'));
          } catch {
            descendants = [];
          }

          for (const el of descendants) {
            if (el && el.shadowRoot && !visited.has(el.shadowRoot)) {
              roots.push(el.shadowRoot);
            }
          }
        }

        return null;
      };

      const queryByText = locator => {
        const expected = normalizeText(locator?.value || '');
        if (!expected) return null;

        const tag = normalizeText(locator?.tag || '').toLowerCase();
        const selectorText = tag || '*';

        let nodes = [];
        try {
          nodes = Array.from(document.querySelectorAll(selectorText));
        } catch {
          nodes = [];
        }

        let includesFallback = null;
        for (const node of nodes) {
          const text = normalizeText(node?.innerText || node?.textContent || '');
          if (!text) continue;
          if (text === expected) return node;
          if (!includesFallback && text.includes(expected)) {
            includesFallback = node;
          }
        }
        return includesFallback;
      };

      const findTargetNow = () => {
        for (const candidate of cssCandidates) {
          const found = querySelectorDeep(candidate);
          if (found) return found;
        }

        const byText = queryByText(textLocator);
        if (byText) return byText;

        return null;
      };

      const findTargetWithWait = async () => {
        const started = Date.now();
        while (Date.now() - started <= timeoutMs) {
          const found = findTargetNow();
          if (found) return found;
          await sleep(pollIntervalMs);
        }
        return null;
      };

      const targetDebug = () => {
        if (cssCandidates.length) return cssCandidates.join(' | ');
        if (textLocator?.value) return `text:${textLocator.value}`;
        return '(none)';
      };

      const ensureTarget = async () => {
        const target = await findTargetWithWait();
        if (!target) {
          throw new Error(`target not found: ${targetDebug()}`);
        }
        try {
          target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' });
        } catch {}
        return target;
      };

      const typeInto = (target, val) => {
        if (!target) throw new Error('input target not found');
        target.focus?.();

        if (target.isContentEditable) {
          target.textContent = val;
          target.dispatchEvent(new InputEvent('input', { bubbles: true, data: val }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }

        if ('value' in target) {
          const descriptor = Object.getOwnPropertyDescriptor(target.__proto__, 'value');
          if (descriptor && typeof descriptor.set === 'function') {
            descriptor.set.call(target, val);
          } else {
            target.value = val;
          }
          target.dispatchEvent(new Event('input', { bubbles: true }));
          target.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }

        throw new Error('input target is not editable');
      };

      if (stepKind === 'click') {
        const target = await ensureTarget();
        target.click();
        return { ok: true };
      }

      if (stepKind === 'change' || stepKind === 'input') {
        const target = await ensureTarget();
        typeInto(target, value);
        return { ok: true };
      }

      if (stepKind === 'submit') {
        const target = (await findTargetWithWait()) || document.activeElement;
        if (!target) throw new Error('submit target not found');

        const form = target.tagName === 'FORM' ? target : target.closest?.('form');
        if (form) {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.submit?.();
          }
          return { ok: true };
        }

        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        return { ok: true };
      }

      if (stepKind === 'keydown') {
        const target = await ensureTarget();
        const key = String(value || s?.meta?.key || 'Enter');
        const shiftKey = Boolean(s?.meta?.shiftKey);
        const ctrlKey = Boolean(s?.meta?.ctrlKey);
        const altKey = Boolean(s?.meta?.altKey);
        target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, ctrlKey, altKey, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key, shiftKey, ctrlKey, altKey, bubbles: true }));
        return { ok: true };
      }

      if (stepKind === 'scroll') {
        const scrollTop = Number(s?.meta?.scrollTop ?? 0);
        const scrollLeft = Number(s?.meta?.scrollLeft ?? 0);
        const target = await findTargetWithWait();
        if (target && target !== document.documentElement && target !== document.body) {
          target.scrollTop = scrollTop;
          target.scrollLeft = scrollLeft;
        } else {
          window.scrollTo({ top: scrollTop, left: scrollLeft, behavior: 'instant' });
        }
        return { ok: true };
      }

      return { ok: true };
    },
    args: [step, { timeoutMs: waitMs, pollIntervalMs: pollMs }],
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Step execution failed');
  }

  await new Promise(r => setTimeout(r, 120));
}

async function startRecordSession(payload) {
  const originRaw = String(payload?.origin || 'bridge').toLowerCase();
  // 'bridge' = driven by Python via WS (steps stream to the app, no local persist).
  // 'popup' / 'toolkit' = started locally from the panel; scenario is persisted on stop.
  const origin = originRaw === 'popup' || originRaw === 'toolkit' ? originRaw : 'bridge';
  const requestedUrl = String(payload?.startUrl || '').trim();
  // nativeHosted: the Python native recorder owns the browser (identity, tabs,
  // proxy). Never re-navigate the tab and capture in every tab. The HUD is
  // controlled separately by suppressOverlay: Cloak hides it (the native
  // overlay is the HUD); Shard shows it (it is the only control surface).
  const nativeHosted = Boolean(payload?.nativeHosted);
  const suppressOverlay =
    payload?.suppressOverlay === undefined ? nativeHosted : Boolean(payload.suppressOverlay);
  let tabId = payload?.tabId ? Number(payload.tabId) : null;
  if (tabId == null && nativeHosted) {
    tabId = await getActiveTabId();
  }
  if (tabId == null) {
    tabId = await ensureTabForUrl(isHttpUrl(requestedUrl) ? requestedUrl : null);
  }

  let tab = await chrome.tabs.get(tabId).catch(() => null);
  let tabUrl = String(tab?.url || '').trim();
  if (nativeHosted && !isHttpUrl(tabUrl)) {
    // Python is navigating this tab to startUrl right now; give it a moment
    // instead of failing the session on a transient about:blank.
    const deadline = Date.now() + 10000;
    while (!isHttpUrl(tabUrl) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      tab = await chrome.tabs.get(tabId).catch(() => null);
      tabUrl = String(tab?.url || '').trim();
    }
  }
  if (!isHttpUrl(tabUrl)) {
    throw new Error('Open a regular website tab (http/https) before starting extension recording');
  }

  const runId = String(payload?.runId || '').trim() || stableRunId('record');
  const scenarioName =
    String(payload?.scenarioName || '').trim() ||
    `Recorded ${toIso().slice(0, 19).replace('T', ' ')}`;

  await sessionManager.startRecordSession(
    runId,
    scenarioName,
    isHttpUrl(requestedUrl) ? requestedUrl : tabUrl,
    origin,
    tabId,
    nativeHosted,
    suppressOverlay
  );
  _replayTask = null;

  const contentReady = await ensureExtensionContentScripts(tabId);
  if (!contentReady) {
    await sessionManager.stopRecordSession();
    throw new Error(
      'Cannot inject extension recorder into this page. Open a regular website tab and try again.'
    );
  }

  const sent = await sendToTab(tabId, {
    type: 'stitch:start-record',
    payload: {
      runId,
      startUrl: isHttpUrl(requestedUrl) ? requestedUrl : tabUrl,
      scenarioName,
      alias: payload?.alias,
    },
  });

  if (!sent) {
    await sessionManager.stopRecordSession();
    throw new Error('Failed to start recording in active tab (tab may be restricted)');
  }

  await pushOverlayState(tabId);
}

async function stopRecordSession(options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const state = sessionManager.getState();
  const record = state.mode === 'record' ? state.record : null;
  if (!record) return { ok: true, saved: false, scenario: null };
  if (record.finalizing) return { ok: true, saved: false, scenario: null };

  await sessionManager.setFinalizing(true);
  const tabId = state.tabId;
  const wasNativeHosted = Boolean(record?.nativeHosted);

  if (!opts.skipNotifyTab && tabId != null) {
    await sendToTab(tabId, { type: 'stitch:stop-record', payload: {} });
  }

  const scenario = buildScenarioFromRecord(sessionManager.getState().record);
  const shouldPersist =
    typeof opts.persist === 'boolean' ? opts.persist : String(sessionManager.getState().record?.origin || 'bridge') !== 'bridge';

  if (shouldPersist && scenario) {
    await persistLocalScenario(scenario);
  }

  const idlePayload = {
    mode: 'idle',
    paused: false,
    status: 'idle',
    record: { stepCount: 0, steps: [] },
    replay: { current: 0, total: 0, steps: [] },
  };
  if (wasNativeHosted) {
    // Stop capture in every tab, not just the session tab.
    const tabs = await chrome.tabs.query({}).catch(() => []);
    for (const t of Array.isArray(tabs) ? tabs : []) {
      if (t?.id != null) {
        await sendToTab(t.id, { type: 'stitch:overlay-state', payload: idlePayload });
      }
    }
  } else if (tabId != null) {
    await sendToTab(tabId, {
      type: 'stitch:overlay-state',
      payload: idlePayload,
    });
  }

  await sessionManager.stopRecordSession();
  // Notify the Python bridge (if any) that the session ended. Required when
  // the operator stops from the extension HUD — the only control surface in
  // ShardBrowser — because Python otherwise waits for its own timeout.
  if (String(record.origin || 'bridge') === 'bridge') {
    sendWs('record', {
      type: 'record_stopped',
      payload: { runId: record.runId || null },
    });
  }
  void saveSessionToStorage();
  return { ok: true, saved: shouldPersist && Boolean(scenario), scenario };
}

async function startReplaySession(payload) {
  const startUrl = String(payload?.startUrl || 'https://google.com').trim();
  // nativeHosted: Python owns the browser (identity/proxy) and already opened
  // startUrl. Reuse the active tab instead of re-navigating — avoids a
  // redundant full page load on engines like ShardBrowser.
  const nativeHosted = Boolean(payload?.nativeHosted);
  let tabId = null;
  if (nativeHosted) {
    tabId = await getActiveTabId();
  }
  if (tabId == null) {
    tabId = await ensureTabForUrl(startUrl);
  }

  const fromStep = Number(payload?.fromStep || 1);
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];

  _replayTask = {
    runId: payload?.runId,
    tabId,
    steps,
    fromStep: Number.isFinite(fromStep) && fromStep > 0 ? Math.floor(fromStep) : 1,
    totalSteps: 0,
    index: 0,
    current: 0,
    paused: false,
    stopped: false,
    manualContinue: false,
    status: 'running',
    nativeHosted,
    _unpauseResolve: null,
    _manualResolve: null,
  };
  _replayTask.totalSteps = _replayTask.fromStep - 1 + steps.length;
  _replayTask.current = steps.length ? _replayTask.fromStep : 0;

  await sessionManager.update([
    { type: 'SET_MODE', mode: 'replay' },
    { type: 'SET_TAB_ID', tabId },
  ]);

  await pushOverlayState(tabId);
  void replayLoop();
}

async function replayLoop() {
  const task = _replayTask;
  if (!task) return;

  while (task.index < task.steps.length && !task.stopped) {
    if (task.paused) {
      task.status = 'paused';
      await pushOverlayState(task.tabId);
      await new Promise(resolve => { task._unpauseResolve = resolve; });
      task._unpauseResolve = null;
      continue;
    }

    task.status = 'running';

    const step = task.steps[task.index] || {};
    task.current = task.fromStep + task.index;
    await pushOverlayState(task.tabId);
    const index = task.fromStep + task.index;
    sendWs('replay', {
      type: 'replay_step_start',
      payload: {
        runId: task.runId,
        index,
        kind: step.kind || 'unknown',
        selector: step.selector || null,
        url: step.url || null,
      },
    });

    try {
      await runDomStep(task.tabId, step);
      sendWs('replay', {
        type: 'replay_step_done',
        payload: {
          runId: task.runId,
          index,
          kind: step.kind || 'unknown',
          selector: step.selector || null,
          url: step.url || null,
        },
      });
      task.index += 1;
      task.current = Math.min(task.fromStep + task.index, task.totalSteps || task.steps.length);
      await pushOverlayState(task.tabId);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      await sessionManager.setError(errorMsg);
      task.status = 'stopped';
      sendWs('replay', {
        type: 'replay_step_fail',
        payload: {
          runId: task.runId,
          index,
          kind: step.kind || 'unknown',
          selector: step.selector || null,
          url: step.url || null,
          error: e instanceof Error ? e.message : String(e),
        },
      });
      task.stopped = true;
      await pushOverlayState(task.tabId);
      sendWs('replay', {
        type: 'replay_error',
        payload: { runId: task.runId, error: e instanceof Error ? e.message : String(e) },
      });
      break;
    }
  }

  if (!task.stopped && task.index >= task.steps.length) {
    task.status = 'finished';
    task.current = task.totalSteps || task.steps.length;
    await pushOverlayState(task.tabId);
    sendWs('replay', {
      type: 'replay_finished',
      payload: { runId: task.runId },
    });
  }

  await sendToTab(task.tabId, {
    type: 'stitch:overlay-state',
    payload: {
      mode: 'idle',
      paused: false,
      status: 'idle',
      record: { stepCount: 0, steps: [] },
      replay: { current: 0, total: 0, steps: [] },
    },
  });

  _replayTask = null;
  await sessionManager.update([
    { type: 'SET_MODE', mode: null },
    { type: 'SET_TAB_ID', tabId: null },
    { type: 'SET_ERROR', error: null },
  ]);
}

async function applyReplayControl(command) {
  const task = _replayTask;
  if (!task) return;
  if (command === 'pause') {
    task.paused = true;
    task.status = 'paused';
    await pushOverlayState(task.tabId);
    return;
  }
  if (command === 'resume' || command === 'continue') {
    if (task.status === 'manual-paused') {
      task.manualContinue = true;
      task.status = 'running';
      if (task._manualResolve) {
        task._manualResolve();
        task._manualResolve = null;
      }
    }
    task.paused = false;
    if (task.status === 'manual-paused') task.status = 'running';
    if (task._unpauseResolve) {
      task._unpauseResolve();
      task._unpauseResolve = null;
    }
    await pushOverlayState(task.tabId);
    return;
  }
  if (command === 'stop' || command === 'abort' || command === 'cancel') {
    task.stopped = true;
    task.status = 'stopped';
    if (task._unpauseResolve) {
      task._unpauseResolve();
      task._unpauseResolve = null;
    }
    if (task._manualResolve) {
      task._manualResolve();
      task._manualResolve = null;
    }
    await pushOverlayState(task.tabId);
  }
}

function reconnectAllBridges() {
  for (const kind of ['record', 'replay', 'health']) {
    const state = bridgeState[kind];
    if (state && state.status === 'failed') {
      state.reconnectAttempt = 0;
      state.status = 'offline';
    }
  }
  connectBridge('record', BRIDGE_PORTS.record);
  connectBridge('replay', BRIDGE_PORTS.replay);
  connectBridge('health', BRIDGE_PORTS.health);
}

function bridgeIsOnline(kind) {
  const ws = bridgeState[kind]?.ws;
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

function bridgeIsConnecting(kind) {
  const state = bridgeState[kind];
  if (!state) return false;
  if (state.connecting) return true;
  return Boolean(state.ws && state.ws.readyState === WebSocket.CONNECTING);
}

function getBridgeStatus(kind) {
  const state = bridgeState[kind];
  if (!state) return 'offline';
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return 'online';
  if (state.status === 'failed') return 'failed';
  if (state.connecting) return 'connecting';
  return state.status || 'offline';
}

function closeBridge(kind) {
  const state = bridgeState[kind];
  if (!state) return;
  if (state.ws && state.ws.readyState !== WebSocket.CLOSED && state.ws.readyState !== WebSocket.CLOSING) {
    try {
      state.ws.close(1000, 'Session ended');
    } catch {}
  }
  state.ws = null;
  state.connecting = false;
}

function closeAllBridges() {
  for (const kind of ['record', 'replay', 'health']) {
    closeBridge(kind);
  }
}

function connectBridge(kind, port) {
  const state = bridgeState[kind];
  if (!state || state.connecting) return;
  if (
    state.ws &&
    (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)
  )
    return;

  if (state.ws && state.ws.readyState !== WebSocket.CLOSED && state.ws.readyState !== WebSocket.CLOSING) {
    try {
      state.ws.close(1000, 'Reconnecting');
    } catch {}
  }
  state.ws = null;

  if (state.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    state.status = 'failed';
    return;
  }

  state.connecting = true;
  state.status = 'reconnecting';

  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  state.ws = ws;

  ws.onopen = () => {
    state.connecting = false;
    state.reconnectAttempt = 0;
    state.status = 'online';
    flushOutboundQueue(kind);
    sendWs(kind, { type: 'hello', payload: { client: 'stitch-extension', kind } });

    if (kind === 'record' && sessionManager.isRecording()) {
      const record = sessionManager.getState().record;
      sendWs('record', {
        type: 'session_active',
        payload: {
          mode: 'record',
          runId: record.runId,
          scenarioName: record.scenarioName,
          stepCount: record.stepCount,
          paused: record.paused,
        },
      });
    } else if (kind === 'replay' && sessionManager.isReplaying() && _replayTask) {
      sendWs('replay', {
        type: 'session_active',
        payload: {
          mode: 'replay',
          runId: _replayTask.runId,
          current: _replayTask.current,
          total: _replayTask.totalSteps,
          paused: _replayTask.paused,
        },
      });
    }
  };

  ws.onclose = () => {
    state.connecting = false;
    if (bridgeState[kind]?.ws === ws) {
      bridgeState[kind].ws = null;
    }

    state.reconnectAttempt += 1;
    if (state.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      state.status = 'failed';
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempt), MAX_RECONNECT_DELAY);
    state.status = `reconnecting (${state.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`;
    setTimeout(() => connectBridge(kind, port), delay);
  };

  ws.onerror = (evt) => {
    console.error(`[bg] WebSocket error on ${kind} bridge:`, evt);
  };

  ws.onmessage = async evt => {
    const msg = safeJsonParse(evt.data);
    if (!msg || typeof msg !== 'object') return;
    const type = String(msg.type || '').toLowerCase();
    const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
    try {
      await handleBridgeMessage(kind, type, payload);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[bg] bridge ${kind} handler failed for '${type}':`, errMsg);
      try {
        await chrome.storage.session.set({
          'stitch:lastBridgeError': { kind, type, error: errMsg, ts: Date.now() },
        });
      } catch {}
    }
  };
}

async function handleBridgeMessage(kind, type, payload) {

    if (kind === 'record') {
      if (type === 'start_record') {
        const force = Boolean(payload?.force);
        const check = await canStartSession('record');
        if (!check.ok) {
          if (force) {
            await stopCurrentSession(true);
          } else {
            const record = sessionManager.getState().record;
            sendWs('record', {
              type: 'session_active',
              payload: {
                mode: 'record',
                runId: record?.runId,
                stepCount: record?.stepCount || 0,
                paused: record?.paused || false,
              },
            });
            return;
          }
        }
        try {
          await startRecordSession(payload);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error('[bg] startRecordSession failed:', errMsg);
          sendWs('record', {
            type: 'record_error',
            payload: { error: errMsg, code: 'session_start_failed' },
          });
        }
        return;
      }
      if (type === 'stop_record') {
        await stopRecordSession();
        return;
      }
      if (type === 'control') {
        const command = String(payload.command || '').toLowerCase();
        await applyRecordControl(command);
      }
      return;
    }

    if (kind === 'replay') {
      if (type === 'start_replay') {
        const force = Boolean(payload?.force);
        const check = await canStartSession('replay');
        if (!check.ok) {
          if (force) {
            await stopCurrentSession(true);
          } else {
            sendWs('replay', {
              type: 'session_active',
              payload: {
                mode: 'replay',
                runId: _replayTask?.runId,
                current: _replayTask?.current || 0,
                total: _replayTask?.totalSteps || 0,
                paused: _replayTask?.paused || false,
              },
            });
            return;
          }
        }
        try {
          await startReplaySession(payload);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          console.error('[bg] startReplaySession failed:', errMsg);
          sendWs('replay', {
            type: 'replay_error',
            payload: { runId: payload?.runId, error: errMsg },
          });
        }
        return;
      }
      if (type === 'stop_replay') {
        await applyReplayControl('stop');
        return;
      }
      if (type === 'control') {
        const command = String(payload.command || '').toLowerCase();
        await applyReplayControl(command);
      }
    }

  if (kind === 'health') {
    if (type === 'ping') {
      sendWs('health', {
        type: 'pong',
        payload: {
          nonce: payload.nonce ?? null,
          ts: Date.now(),
        },
      });
    }
  }
}

// ── Bridge auto-connect (guarded) ──────────────────────────────────────────
// The worker wakes on every page load (overlay-sync), so raw top-level
// reconnects would spam ws:// connection attempts in CloakBrowser profiles
// where Stitch is not running. A timestamp guard (persisted in
// chrome.storage.session so it survives service-worker restarts) limits
// auto-connect to at most once per BRIDGE_AUTOCONNECT_GUARD_MS, and a
// 1-minute alarm re-arms failed channels so long-lived browsers still attach
// to Python jobs that start later (they wait up to 120s for the connection).
const BRIDGE_GUARD_KEY = 'stitch:lastBridgeAutoConnect';

async function armBridges(force = false) {
  const now = Date.now();
  if (!force) {
    try {
      const data = await chrome.storage.session.get(BRIDGE_GUARD_KEY);
      const last = Number(data?.[BRIDGE_GUARD_KEY] || 0);
      if (Number.isFinite(last) && now - last < BRIDGE_AUTOCONNECT_GUARD_MS) return;
    } catch {}
  }
  try { await chrome.storage.session.set({ [BRIDGE_GUARD_KEY]: now }); } catch {}
  reconnectAllBridges();
}

try {
  chrome.alarms.create('stitch-bridge-rearm', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm?.name === 'stitch-bridge-rearm') void armBridges(true);
  });
} catch (e) {
  console.warn('[bg] alarms unavailable, bridge re-arm disabled:', e instanceof Error ? e.message : String(e));
}

chrome.runtime.onInstalled.addListener(() => {
  void armBridges(true);
});

chrome.runtime.onStartup.addListener(() => {
  void armBridges(true);
});

void armBridges(false);

chrome.tabs.onRemoved.addListener((removedTabId) => {
  const state = sessionManager.getState();
  if (state.tabId === removedTabId) {
    console.log(`[bg] Tab ${removedTabId} closed during active session — cleaning up`);
    const currentMode = state.mode;
    const currentTabId = state.tabId;
    if (currentMode === 'record' && currentTabId === removedTabId) {
      void stopRecordSession({ skipNotifyTab: true, persist: true });
    } else if (currentMode === 'replay' && currentTabId === removedTabId) {
      void applyReplayControl('stop');
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = String(message?.type || '');

  if (type === 'stitch:record-event') {
    const step = normalizeRecordedStep(message.payload || {});
    sendWs('record', {
      type: 'record_event',
      payload: step,
    });
    if (sessionManager.isRecording()) {
      void sessionManager.addStep(step);
      void pushOverlayState();
      scheduleSaveSessionToStorage();
      // Live progress for the toolkit panel (float button badge / recorder tool).
      const progressTabId = sessionManager.getState().tabId;
      if (progressTabId != null) {
        void sendToTab(progressTabId, {
          type: 'tk:recorder-progress',
          payload: { stepCount: sessionManager.getStepCount(), paused: sessionManager.isPaused() },
        });
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (type === 'stitch:record-stopped') {
    sendWs('record', {
      type: 'record_stopped',
      payload: message.payload || {},
    });

    void (async () => {
      const state = sessionManager.getState();
      if (
        state.mode === 'record' &&
        state.record &&
        !state.record.finalizing
      ) {
        await stopRecordSession({ skipNotifyTab: true });
      }
    })();

    sendResponse({ ok: true });
    return true;
  }

  if (type === 'stitch:status') {
    const state = sessionManager.getState();
    sendResponse({
      ok: true,
      session: {
        mode: state.mode,
        tabId: state.tabId,
        record: state.record
          ? {
              runId: state.record.runId,
              origin: state.record.origin || 'bridge',
              stepCount: state.record.stepCount,
              paused: state.record.paused,
            }
          : null,
        replay: _replayTask
          ? {
              runId: _replayTask.runId,
              index: _replayTask.current,
              total: _replayTask.totalSteps || _replayTask.steps.length,
              paused: _replayTask.paused,
            }
          : null,
      },
      fullSessionState: JSON.parse(JSON.stringify({
        mode: state.mode,
        tabId: state.tabId,
        record: state.record,
        replay: _replayTask,
        lastError: state.lastError,
      })),
      bridges: {
        record: bridgeIsOnline('record'),
        replay: bridgeIsOnline('replay'),
        health: bridgeIsOnline('health'),
      },
      connecting: {
        record: bridgeIsConnecting('record'),
        replay: bridgeIsConnecting('replay'),
        health: bridgeIsConnecting('health'),
      },
      status: {
        record: getBridgeStatus('record'),
        replay: getBridgeStatus('replay'),
        health: getBridgeStatus('health'),
      },
    });
    return true;
  }

  if (type === 'stitch:reconnect') {
    void armBridges(true);
    sendResponse({ ok: true });
    return true;
  }

  if (type === 'stitch:popup-control') {
    const command = String(message?.payload?.command || '').toLowerCase();
    void (async () => {
      if (sessionManager.isRecording()) {
        await applyRecordControl(command);
      } else if (sessionManager.isReplaying()) {
        await applyReplayControl(command);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (type === 'stitch:overlay-control') {
    const command = String(message?.payload?.command || '').toLowerCase();
    void (async () => {
      if (sessionManager.isRecording()) {
        await applyRecordControl(command);
      } else if (sessionManager.isReplaying()) {
        await applyReplayControl(command);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (type === 'stitch:overlay-sync') {
    const senderTabId = sender?.tab?.id ?? null;
    sendResponse({ ok: true, payload: getOverlayPayloadForTab(senderTabId) });
    return true;
  }

  if (type === 'stitch:popup-start-replay') {
    void (async () => {
      try {
        const force = Boolean(message?.payload?.force);
        const check = await canStartSession('replay');
        if (!check.ok) {
          if (force) {
            await stopCurrentSession(true);
          } else {
            sendResponse({ ok: false, error: check.error });
            return;
          }
        }

        const normalized = normalizePopupReplayPayload(message?.payload);
        await startReplaySession({
          runId: normalized.runId,
          scenarioName: normalized.scenarioName,
          startUrl: normalized.startUrl,
          steps: normalized.steps,
          fromStep: normalized.fromStep,
        });

        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === 'stitch:popup-start-record') {
    void (async () => {
      try {
        const force = Boolean(message?.payload?.force);
        const check = await canStartSession('record');
        if (!check.ok) {
          if (force) {
            await stopCurrentSession(true);
          } else {
            sendResponse({ ok: false, error: check.error });
            return;
          }
        }

        const incoming =
          message?.payload && typeof message.payload === 'object' ? message.payload : {};
        const runId = String(incoming.runId || '').trim() || stableRunId('record');
        const scenarioName =
          String(incoming.scenarioName || '').trim() ||
          `Recorded ${toIso().slice(0, 19).replace('T', ' ')}`;
        const startUrl = String(incoming.startUrl || '').trim();

        await startRecordSession({
          runId,
          scenarioName,
          startUrl: isHttpUrl(startUrl) ? startUrl : null,
          origin: 'popup',
          tabId: incoming.tabId || undefined,
        });

        sendResponse({ ok: true, runId, scenarioName });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === 'stitch:popup-finish-record') {
    void (async () => {
      try {
        const state = sessionManager.getState();
        if (state.mode !== 'record' || !state.record) {
          sendResponse({ ok: false, error: 'No active recording session' });
          return;
        }

        if (String(state.record.origin || '') !== 'popup') {
          sendResponse({ ok: false, error: 'Active recording was not started from popup' });
          return;
        }

        const result = await stopRecordSession({ persist: true });
        sendResponse({
          ok: true,
          saved: Boolean(result?.saved),
          scenario: result?.scenario || null,
        });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  // ── Toolkit panel handlers (recorder/replay UI) ─────────
  if (type === 'tk:recorder-start') {
    void (async () => {
      try {
        const incoming = message?.payload && typeof message.payload === 'object' ? message.payload : {};
        const force = Boolean(incoming.force);
        const check = await canStartSession('record');
        if (!check.ok) {
          if (force) {
            await stopCurrentSession(true);
          } else {
            sendResponse({ ok: false, error: check.error });
            return;
          }
        }
        const runId = String(incoming.runId || '').trim() || stableRunId('record');
        const scenarioName =
          String(incoming.scenarioName || incoming.name || '').trim() ||
          `Recorded ${toIso().slice(0, 19).replace('T', ' ')}`;
        const startUrl = String(incoming.startUrl || '').trim();
        await startRecordSession({
          runId,
          scenarioName,
          startUrl: isHttpUrl(startUrl) ? startUrl : null,
          origin: 'toolkit',
          tabId: incoming.tabId || undefined,
        });
        sendResponse({ ok: true, runId, scenarioName });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === 'tk:recorder-stop') {
    void (async () => {
      try {
        const state = sessionManager.getState();
        if (state.mode !== 'record') {
          sendResponse({ ok: true, saved: false, scenario: null });
          return;
        }
        const result = await stopRecordSession();
        sendResponse({ ok: true, saved: Boolean(result?.saved), scenario: result?.scenario || null });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === 'tk:recorder-status') {
    const state = sessionManager.getState();
    sendResponse({
      ok: true,
      mode: state.mode,
      origin: state.record?.origin || null,
      stepCount: sessionManager.getStepCount(),
      paused: sessionManager.isPaused(),
      replay: _replayTask
        ? {
            runId: _replayTask.runId,
            current: _replayTask.current,
            total: _replayTask.totalSteps,
            paused: _replayTask.paused,
            status: _replayTask.status,
          }
        : null,
    });
    return true;
  }

  if (type === 'tk:recorder-save') {
    void (async () => {
      try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.scenarios]);
        const scenarios = Array.isArray(data?.[STORAGE_KEYS.scenarios]) ? data[STORAGE_KEYS.scenarios] : [];
        sendResponse({ ok: true, scenarios });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === 'tk:recorder-steps') {
    sendResponse({
      ok: true,
      mode: sessionManager.getMode(),
      steps: sessionManager.getSteps(),
    });
    return true;
  }

  if (type === 'tk:scenario-delete') {
    void (async () => {
      try {
        const id = String(message?.payload?.id || '').trim();
        if (!id) {
          sendResponse({ ok: false, error: 'Missing scenario id' });
          return;
        }
        const data = await chrome.storage.local.get([STORAGE_KEYS.scenarios]);
        const existing = Array.isArray(data?.[STORAGE_KEYS.scenarios]) ? data[STORAGE_KEYS.scenarios] : [];
        const next = existing.filter(s => String(s?.id || '') !== id);
        if (next.length === existing.length) {
          sendResponse({ ok: false, error: 'Scenario not found' });
          return;
        }
        await chrome.storage.local.set({ [STORAGE_KEYS.scenarios]: next });
        sendResponse({ ok: true, remaining: next.length });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === 'tk:replay-start') {
    void (async () => {
      try {
        const force = Boolean(message?.payload?.force);
        const check = await canStartSession('replay');
        if (!check.ok) {
          if (force) {
            await stopCurrentSession(true);
          } else {
            sendResponse({ ok: false, error: check.error });
            return;
          }
        }
        const normalized = normalizePopupReplayPayload(message?.payload);
        await startReplaySession({
          runId: normalized.runId,
          scenarioName: normalized.scenarioName,
          startUrl: normalized.startUrl,
          steps: normalized.steps,
          fromStep: normalized.fromStep,
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return true;
  }

  if (type === 'tk:replay-control') {
    void (async () => {
      await applyReplayControl(String(message?.payload?.command || '').toLowerCase());
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (type === 'tk:status') {
    // User activity signal — opportunistically re-arm bridge connections.
    void armBridges(false);
    const state = sessionManager.getState();
    sendResponse({
      ok: true,
      version: TOOLKIT_VERSION,
      mode: state.mode,
      record: state.record
        ? {
            runId: state.record.runId,
            origin: state.record.origin || 'bridge',
            stepCount: state.record.stepCount,
            paused: state.record.paused,
          }
        : null,
      replay: _replayTask
        ? {
            runId: _replayTask.runId,
            current: _replayTask.current,
            total: _replayTask.totalSteps,
            paused: _replayTask.paused,
          }
        : null,
      bridges: {
        record: bridgeIsOnline('record'),
        replay: bridgeIsOnline('replay'),
        health: bridgeIsOnline('health'),
      },
    });
    return true;
  }

  return false;
});
