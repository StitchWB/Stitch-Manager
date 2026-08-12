const overlay = {
  shell: null,
  _isVisible: null,
};

// i18n helper: the overlay runs at document_start in all frames; StitchI18n
// (i18n.js) is loaded in the same content-script set, but if it is missing
// for any reason the overlay degrades gracefully to English literals.
function ovT(key, fallback, vars) {
  let text = null;
  try {
    if (window.StitchI18n && typeof window.StitchI18n.t === 'function') {
      const translated = window.StitchI18n.t(key, vars);
      if (translated && translated !== key) text = translated;
    }
  } catch {}
  if (text === null) {
    text = String(fallback || key);
    if (vars) {
      for (const k of Object.keys(vars)) {
        text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      }
    }
  }
  return text;
}

let _dragState = null;
const _dragHandlers = { mouseMove: null, mouseUp: null };
let _escapeHandler = null;

function initOverlayDrag() {
  const shell = overlay.shell;
  if (!shell?.host || !shell.titleEl) return;

  const titleEl = shell.titleEl;
  titleEl.style.cursor = 'grab';
  titleEl.style.userSelect = 'none';

  titleEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const host = shell.host;
    const rect = host.getBoundingClientRect();
    _dragState = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    titleEl.style.cursor = 'grabbing';

    const onMouseMove = (ev) => {
      if (!_dragState) return;
      const dx = ev.clientX - _dragState.startX;
      const dy = ev.clientY - _dragState.startY;
      host.style.left = `${_dragState.startLeft + dx}px`;
      host.style.top = `${_dragState.startTop + dy}px`;
      host.style.right = 'auto';
    };

    const onMouseUp = () => {
      _dragState = null;
      titleEl.style.cursor = 'grab';
      if (_dragHandlers.mouseMove) {
        document.removeEventListener('mousemove', _dragHandlers.mouseMove);
        _dragHandlers.mouseMove = null;
      }
      if (_dragHandlers.mouseUp) {
        document.removeEventListener('mouseup', _dragHandlers.mouseUp);
        _dragHandlers.mouseUp = null;
      }
    };

    _dragHandlers.mouseMove = onMouseMove;
    _dragHandlers.mouseUp = onMouseUp;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function cleanupOverlayDrag() {
  if (_dragHandlers.mouseMove) {
    document.removeEventListener('mousemove', _dragHandlers.mouseMove);
    _dragHandlers.mouseMove = null;
  }
  if (_dragHandlers.mouseUp) {
    document.removeEventListener('mouseup', _dragHandlers.mouseUp);
    _dragHandlers.mouseUp = null;
  }
  _dragState = null;
}

function getOverlayRuntime() {
  if (window.StitchOverlayRuntime) return window.StitchOverlayRuntime;
  if (window.__stitchOverlayRuntimeFallback) return window.__stitchOverlayRuntimeFallback;

  const fallback = {
    createOverlayShell(options = {}) {
      const parent = document.documentElement || document.body;
      if (!parent) return null;
      const hostId = String(options.hostId || '__stitch-overlay-host');
      let host = document.getElementById(hostId);
      if (!host) {
        host = document.createElement('div');
        host.id = hostId;
      }
      host.style.position = 'fixed';
      host.style.top = '14px';
      host.style.right = '14px';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      if (!host.isConnected) parent.appendChild(host);

      if (!host.shadowRoot) {
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<div id="stitch-fallback"></div>';
      }
      const root = host.shadowRoot;
      const panelId = '__stitch-fallback-panel';
      let panel = root.getElementById(panelId);
      if (!panel) {
        panel = document.createElement('div');
        panel.id = panelId;
        panel.style.pointerEvents = 'auto';
        panel.style.minWidth = '220px';
        panel.style.background = 'rgba(10,11,20,.96)';
        panel.style.color = '#f8fafc';
        panel.style.border = '1px solid rgba(129,140,248,.38)';
        panel.style.borderRadius = '12px';
        panel.style.padding = '10px';
        panel.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
        panel.style.fontSize = '12px';
        const title = document.createElement('div');
        title.id = '__title';
        const status = document.createElement('div');
        status.id = '__status';
        const main = document.createElement('div');
        main.id = '__main';
        main.style.margin = '6px 0';
        const steps = document.createElement('div');
        steps.id = '__steps';
        steps.style.display = 'none';
        steps.style.maxHeight = '120px';
        steps.style.overflowY = 'auto';
        steps.style.marginTop = '6px';
        steps.style.fontSize = '11px';
        steps.style.color = '#94a3b8';
        const controls = document.createElement('div');
        controls.id = '__controls';
        controls.style.display = 'flex';
        controls.style.gap = '6px';
        panel.appendChild(title);
        panel.appendChild(status);
        panel.appendChild(main);
        panel.appendChild(steps);
        panel.appendChild(controls);
        root.appendChild(panel);
      }
      return {
        host,
        root,
        panel,
        titleEl: root.getElementById('__title'),
        statusEl: root.getElementById('__status'),
        mainEl: root.getElementById('__main'),
        stepsEl: root.getElementById('__steps'),
        controlsEl: root.getElementById('__controls'),
        setVisible(visible) {
          host.style.display = visible ? 'block' : 'none';
        },
      };
    },
    renderControls(shell, controls, onCommand) {
      if (!shell?.controlsEl) return;
      shell.controlsEl.textContent = '';
      for (const entry of controls || []) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = String(entry?.label || entry?.command || 'Action');
        btn.dataset.command = String(entry?.command || '');
        btn.style.padding = '6px 8px';
        btn.style.borderRadius = '7px';
        btn.style.cursor = 'pointer';
        if (entry?.disabled) {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        }
        btn.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          onCommand?.(btn.dataset.command || '', entry || {}, event);
        });
        shell.controlsEl.appendChild(btn);
      }
    },
    setControlState(shell, command, patch = {}) {
      const btn = shell?.controlsEl?.querySelector(`button[data-command="${String(command)}"]`);
      if (!btn) return;
      if (Object.prototype.hasOwnProperty.call(patch, 'disabled')) {
        btn.disabled = Boolean(patch.disabled);
        btn.style.opacity = patch.disabled ? '0.5' : '1';
        btn.style.cursor = patch.disabled ? 'not-allowed' : 'pointer';
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
        btn.textContent = String(patch.label || btn.textContent || '');
      }
    },
  };

  window.__stitchOverlayRuntimeFallback = fallback;
  return fallback;
}

const overlayRetries = { count: 0 };

function ensureOverlay() {
  if (!_frameContext.isTop) return;
  const parent = document.documentElement || document.body;
  if (!parent) {
    if (++overlayRetries.count > 40) return;
    setTimeout(ensureOverlay, 50);
    return;
  }
  overlayRetries.count = 0;

  const runtime = getOverlayRuntime();

  if (!overlay.shell?.host?.isConnected) {
    overlay.shell = runtime.createOverlayShell({
      hostId: 'stitch-overlay-host',
      position: 'top-right',
      offsetX: 14,
      offsetY: 14,
      markerAttr: 'data-stitch-overlay',
      title: ovT('overlay.idle', 'Idle'),
      status: 'idle',
      mainText: ovT('overlay.noSession', 'No active session'),
      reasonText: '',
      pausedText: '',
      visible: false,
      collapsible: true,
      collapsed: false,
      onClose: () => {
        overlay._isVisible = false;
      },
    });
    initOverlayDrag();

    if (!document.querySelector('[data-stitch-escape-bound]')) {
      const escapeHandler = (e) => {
        if (e.key === 'Escape' && overlay.shell && overlay._isVisible) {
          overlay.shell.setVisible(false);
          overlay._isVisible = false;
        }
      };
      _escapeHandler = escapeHandler;
      document.addEventListener('keydown', escapeHandler);
      // document.body is null at document_start — use documentElement as marker host
      (document.body || document.documentElement).setAttribute('data-stitch-escape-bound', '1');
    }
  }

  if (!overlay.shell) return;
}

function renderOverlayControls() {
  if (!overlay.shell) return;
  const runtime = getOverlayRuntime();

  const recording = isRecording();
  const replayPaused = isReplay() && state.replayStatus === 'paused';
  const replayManualPaused = isReplay() && state.replayStatus === 'manual-paused';
  const canResume = (recording && state.paused) || replayPaused || replayManualPaused;

  runtime.renderControls(
    overlay.shell,
    [
      ...(recording ? [{ command: 'manual', label: ovT('overlay.btnManual', 'Manual ⏸'), variant: 'accent' }] : []),
      {
        command: 'pause',
        label: ovT('overlay.btnPause', 'Pause'),
        disabled: state.paused || (!recording && !isReplay()) || replayManualPaused,
      },
      {
        command: 'resume',
        label: replayManualPaused ? ovT('overlay.btnContinue', 'Continue') : ovT('overlay.btnResume', 'Resume'),
        disabled: !canResume,
      },
      {
        command: 'stop',
        label: ovT('overlay.btnStop', 'Stop'),
        variant: 'stop',
        disabled: !recording && !isReplay(),
      },
    ],
    (command, cfg) => {
      if (!command) return;

      if (command === 'manual' && recording && !state.paused) {
        chrome.runtime.sendMessage({
          type: 'stitch:record-event',
          payload: {
            kind: 'manual',
            ts: nowIso(),
            url: location.href,
            selector: null,
            value: null,
            meta: { source: 'manual-step', description: 'Manual action required' },
          },
        });

        chrome.runtime.sendMessage({
          type: 'stitch:overlay-control',
          payload: { command: 'pause' },
        });
        return;
      }

      const currentlyManualPaused = isReplay() && state.replayStatus === 'manual-paused';
      if (command === 'resume' && recording && state.paused) {
        chrome.runtime.sendMessage({
          type: 'stitch:record-event',
          payload: {
            kind: 'manual-continue',
            ts: nowIso(),
            url: location.href,
            selector: null,
            value: null,
            meta: { source: 'manual-step-continue' },
          },
        });
      }

      chrome.runtime.sendMessage({
        type: 'stitch:overlay-control',
        payload: { command: command === 'resume' && currentlyManualPaused ? 'continue' : command },
      });
    }
  );
}

function isOverlayEvent(event) {
  if (typeof event?.composedPath !== 'function') return false;
  const path = event.composedPath();
  if (!Array.isArray(path)) return false;
  if (overlay.shell?.host && path.includes(overlay.shell.host)) return true;
  // The native recorder overlay (Python-injected HUD, marked
  // data-stitch-recorder="1") is Stitch-owned UI too: when the extension is
  // the capture engine in a native-hosted session, clicks on that HUD must
  // not become recorded steps.
  for (const node of path) {
    if (node && node.nodeType === 1 && typeof node.getAttribute === 'function') {
      if (node.getAttribute('data-stitch-recorder') === '1') return true;
    }
  }
  return false;
}

function renderOverlay() {
  if (!_frameContext.isTop) return;
  if (state.mode === 'idle' && state.paused) {
    console.warn('[Stitch] State inconsistency: mode=idle but paused=true. Auto-fixing.');
    state.paused = false;
  }

  if (isRecording() && state.recordStepCount == null) {
    console.warn('[Stitch] State inconsistency: recording but stepCount is null. Auto-fixing.');
    state.recordStepCount = 0;
  }

  ensureOverlay();
  if (!overlay.shell) return;

  // Native-hosted record: the extension captures silently while the native
  // recorder overlay is the visible HUD.
  if (state.hudSuppressed && isRecording()) {
    overlay._isVisible = false;
    overlay.shell.setVisible(false);
    return;
  }

  const active = isRecording() || isReplay();
  const wasVisible = overlay._isVisible;
  overlay._isVisible = active;

  if (wasVisible !== active) {
    overlay.shell.setVisible(active);
  }
  if (!active) return;

  const paused = Boolean(state.paused);
  const modeLabel = isRecording() ? ovT('overlay.record', 'Record') : ovT('overlay.replay', 'Replay');
  const statusLabel =
    isRecording()
      ? paused
        ? ovT('overlay.statusPaused', 'paused')
        : ovT('overlay.statusRunning', 'running')
      : state.replayStatus === 'manual-paused'
        ? ovT('overlay.statusManualPaused', 'manual-paused')
        : state.replayStatus === 'paused'
          ? ovT('overlay.statusPaused', 'paused')
          : state.replayStatus === 'stopped'
            ? ovT('overlay.statusStopped', 'stopped')
            : ovT('overlay.statusRunning', 'running');

  if (overlay.shell.titleEl) overlay.shell.titleEl.textContent = modeLabel;
  if (overlay.shell.statusEl) overlay.shell.statusEl.textContent = statusLabel;
  if (overlay.shell.mainEl) {
    const isManualStep = state.paused && isRecording();
    if (isRecording()) {
      overlay.shell.mainEl.textContent = isManualStep
        ? ovT('overlay.manualStepNow', '⚠️ Manual step {count} — do it now', { count: state.recordStepCount })
        : ovT('overlay.steps', 'Steps: {count}', { count: state.recordStepCount });
    } else if (state.replayStatus === 'manual-paused') {
      overlay.shell.mainEl.textContent = ovT('overlay.manualRequired', '⚠️ Manual action required — do it then continue');
    } else if (state.replayStatus === 'stopped' && state.replayError) {
      overlay.shell.mainEl.textContent = ovT('overlay.failed', '❌ Failed: {error}', { error: state.replayError.slice(0, 60) });
    } else {
      overlay.shell.mainEl.textContent = ovT('overlay.stepProgress', 'Step {current}/{total}', { current: state.replayCurrent, total: state.replayTotal || 0 });
    }
  }

  // Render step list in the overlay steps container (diff-based update - issue #41)
  if (overlay.shell.stepsEl) {
    const stepsData = state.overlaySteps || [];
    const stepsLen = stepsData.length;
    if (stepsLen > 0 && (isRecording() || isReplay())) {
      overlay.shell.stepsEl.style.display = 'block';
      // Performance: Incremental DOM update - only add new steps
      const currentChildCount = overlay.shell.stepsEl.children.length;
      if (currentChildCount !== stepsLen) {
        // Full rebuild when count changed significantly (e.g., after pause/resume)
        overlay.shell.stepsEl.textContent = '';
        for (let i = 0; i < stepsLen; i++) {
          const step = stepsData[i];
          const div = document.createElement('div');
          div.className = 'stitch-step-item';
          const kind = String(step.kind || 'unknown');
          const selector = step.selector ? ` → ${step.selector.slice(0, 30)}` : '';
          div.textContent = `${i + 1}. ${kind}${selector}`;
          // Mark current/completed/future for replay
          if (isReplay()) {
            const stepIndex = i + 1; // 1-based
            if (stepIndex < state.replayCurrent) {
              div.classList.add('completed');
            } else if (stepIndex === state.replayCurrent) {
              div.classList.add('current');
            } else {
              div.classList.add('future');
            }
          }
          overlay.shell.stepsEl.appendChild(div);
        }
        // Scroll to bottom (latest step visible)
        overlay.shell.stepsEl.scrollTop = overlay.shell.stepsEl.scrollHeight;
      }
    } else {
      overlay.shell.stepsEl.style.display = 'none';
    }
  }

  if (overlay.shell.reasonEl) {
    const isManualStep = state.paused && isRecording();
    const isReplayManual = state.replayStatus === 'manual-paused';
    if (isManualStep || isReplayManual) {
      reasonEl.textContent = isManualStep
        ? ovT('overlay.reasonResume', 'Click Resume when done')
        : ovT('overlay.reasonContinue', 'Complete the action manually, then click Continue');
      reasonEl.style.display = 'block';
    } else {
      overlay.shell.reasonEl.style.display = 'none';
    }
  }

  renderOverlayControls();
}

function applyOverlayState(payload) {
  const mode = String(payload?.mode || 'idle').toLowerCase();
  const prevMode = state.mode;
  const prevPaused = state.paused;

  console.debug(`[Stitch] applyOverlayState: ${prevMode}->${mode}, paused:${prevPaused}->${payload?.paused}`);

  if (mode === 'record' && prevMode !== 'record') {
    setupEventListeners();
    if (_frameContext.isTop) {
      startPollInterval();
      setupBeforeUnloadHandler();
    }
  }

  if (mode !== 'record' && prevMode === 'record') {
    removeAllListeners();
    clearAllTimers();
    cleanupOverlayDrag();
    if (_frameContext.isTop) {
      clearPollInterval();
      removeBeforeUnloadHandler();
    }
  }

  if (mode === 'idle' && (prevMode === 'record' || prevMode === 'replay')) {
    cleanupOverlayDrag();
    if (_escapeHandler) {
      document.removeEventListener('keydown', _escapeHandler);
      _escapeHandler = null;
      document.body?.removeAttribute('data-stitch-escape-bound');
    }
  }

  if (mode === 'record') {
    state.mode = 'record';
    state.paused = Boolean(payload?.paused);
    state.hudSuppressed = Boolean(payload?.suppressOverlay);
    state.replayStatus = 'idle';
    const count = Number(payload?.record?.stepCount ?? 0);
    state.recordStepCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
    state.runId = payload?.runId || state.runId;
    state.scenarioName = payload?.scenarioName || state.scenarioName;
    state.startUrl = payload?.startUrl || state.startUrl;
    state.lastUrl = state.lastUrl || state.startUrl || location.href;
    // Fresh top-level document entering a native-hosted session: emit the
    // load nav step (the injected recorder emitted the same) so multi-page
    // scenarios keep navigation markers for replay.
    if (prevMode !== 'record' && _frameContext.isTop && state.hudSuppressed) {
      state.lastUrl = location.href;
      sendRecordEvent('nav', { selector: null, value: null, meta: { reason: 'load' } });
    }
    // Store step list from background for overlay rendering
    state.overlaySteps = Array.isArray(payload?.record?.steps) ? payload.record.steps : state.overlaySteps || [];
    renderOverlay();
    return;
  }

  if (mode === 'replay') {
    state.mode = 'replay';
    state.paused = Boolean(payload?.paused);
    state.hudSuppressed = false;
    state.replayStatus = String(
      payload?.status || (state.paused ? 'paused' : 'running')
    ).toLowerCase();
    const current = Number(payload?.replay?.current ?? 0);
    const total = Number(payload?.replay?.total ?? 0);
    state.replayCurrent = Number.isFinite(current) && current >= 0 ? Math.floor(current) : 0;
    state.replayTotal = Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0;
    state.replayError = payload?.error || null;
    // Store step list from background for overlay rendering
    state.overlaySteps = Array.isArray(payload?.replay?.steps) ? payload.replay.steps : state.overlaySteps || [];
    renderOverlay();
    return;
  }

  state.mode = 'idle';
  state.paused = false;
  state.hudSuppressed = false;
  state.replayStatus = 'idle';
  state.replayCurrent = 0;
  state.replayTotal = 0;
  state.recordStepCount = 0;
  state.replayError = null;
  state.runId = null;
  state.scenarioName = null;
  state.startUrl = null;
  state.lastUrl = null;
  state.overlaySteps = [];
  renderOverlay();
}

function requestOverlaySync() {
  chrome.runtime.sendMessage({ type: 'stitch:overlay-sync' }, response => {
    if (chrome.runtime.lastError) return;
    if (!response?.ok) return;
    applyOverlayState(response.payload || {});
  });
}
