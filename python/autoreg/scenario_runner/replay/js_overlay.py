"""Replay overlay bootstrap JS (installed into replayed pages)."""

_REPLAY_OVERLAY_BOOTSTRAP = r"""
(() => {
  try {
    if (window.top !== window.self) return;
  } catch {
    return;
  }

  if (window.__stitchReplayOverlayInstalled) return;
  window.__stitchReplayOverlayInstalled = true;

  if (!window.__stitchReplayOverlayState) {
    window.__stitchReplayOverlayState = {
      collapsed: false,
      paused: false,
      pausedSince: null,
      stepCurrent: 0,
      stepTotal: 0,
      status: 'Running',
      reason: '-',
    };
  }
  const state = window.__stitchReplayOverlayState;
  const runtime = window.StitchOverlayRuntime;
  if (!runtime || typeof runtime.createOverlayShell !== 'function') return;

  const shell = runtime.createOverlayShell({
    hostId: '__stitch-replay-overlay-host',
    position: 'bottom-right',
    offsetX: 16,
    offsetY: 16,
    markerAttr: 'data-stitch-replay-overlay',
    title: 'Replay',
    status: 'Running',
    mainText: 'Step: -/-',
    reasonText: 'Reason: -',
    pausedText: '',
    visible: true,
    collapsible: true,
    collapsed: Boolean(state.collapsed),
    onToggleCollapse: (collapsed) => {
      state.collapsed = Boolean(collapsed);
      render();
    },
  });
  if (!shell) return;

  const sendControl = (cmd) => {
    if (typeof window.__stitchReplayControl === 'function') {
      window.__stitchReplayControl(cmd);
    }
  };

  runtime.renderControls(
    shell,
    [
      { command: 'pause', label: state.paused ? 'Resume' : 'Pause' },
      { command: 'stop', label: 'Stop', variant: 'stop' },
    ],
    (command) => {
      if (command === 'pause') {
        state.paused = !state.paused;
        if (state.paused) {
          if (!state.pausedSince) state.pausedSince = Date.now();
          state.status = 'Paused';
          state.reason = 'Operator pause';
          sendControl('pause');
        } else {
          state.pausedSince = null;
          state.status = 'Running';
          state.reason = '-';
          sendControl('resume');
        }
        render();
        return;
      }
      if (command === 'stop') {
        state.status = 'Stopping...';
        state.paused = false;
        state.pausedSince = null;
        sendControl('stop');
        render();
      }
    }
  );

  const render = () => {
    if (shell.titleEl) shell.titleEl.textContent = 'Replay';
    if (shell.statusEl) shell.statusEl.textContent = `Status: ${state.status || 'Running'}`;

    const current = Number(state.stepCurrent || 0);
    const total = Number(state.stepTotal || 0);
    const progress = current && total ? `${current}/${total}` : '-/-';

    if (shell.mainEl) shell.mainEl.textContent = `Step: ${progress}`;
    if (shell.reasonEl) {
      shell.reasonEl.textContent = `Reason: ${String(state.reason || '-').trim() || '-'}`;
      shell.reasonEl.style.display = 'block';
    }

    if (shell.pausedEl) {
      if (state.paused && state.pausedSince) {
        const sec = Math.max(0, Math.floor((Date.now() - state.pausedSince) / 1000));
        shell.pausedEl.textContent = `Paused: ${sec}s`;
        shell.pausedEl.style.display = 'block';
      } else {
        shell.pausedEl.textContent = 'Paused: -';
        shell.pausedEl.style.display = 'none';
      }
    }

    if (shell.compactEl) {
      shell.compactEl.textContent = `${state.paused ? 'PAUSED' : 'RUN'} • ${progress}`;
    }

    runtime.setControlState(shell, 'pause', {
      label: state.paused ? 'Resume' : 'Pause',
    });
    shell.setCollapsed(Boolean(state.collapsed));
    shell.setVisible(true);
  };

  window.__stitchReplayOverlaySetStatus = (text) => {
    state.status = (text || 'Running').toString();
    render();
  };

  window.__stitchReplayOverlaySetStep = (current, total) => {
    state.stepCurrent = Number(current || 0);
    state.stepTotal = Number(total || 0);
    render();
  };

  window.__stitchReplayOverlaySetReason = (text) => {
    const v = (text || '').toString().trim();
    state.reason = v || '-';
    render();
  };

  window.__stitchReplayOverlaySetPaused = (flag) => {
    state.paused = Boolean(flag);
    if (state.paused) {
      if (!state.pausedSince) state.pausedSince = Date.now();
      if (!state.reason || state.reason === '-') state.reason = 'Operator pause';
    } else {
      state.pausedSince = null;
      if (state.reason === 'Operator pause') state.reason = '-';
    }
    render();
  };

  window.__stitchReplayOverlaySetSaved = (path) => {
    state.status = 'Saved';
    state.reason = path ? `Saved report ${path}` : 'Saved';
    state.paused = false;
    state.pausedSince = null;
    render();
  };

  setInterval(() => {
    if (!state.paused || !state.pausedSince) return;
    render();
  }, 1000);

  render();
})();
"""
