"""Recorder overlay JS, part 1: state init and proxy picker sync. Concatenated in order by overlay_script.py."""

_OVERLAY_JS_STATE = r"""
(() => {
  // Only render overlay in top-level document (avoid iframes like reCAPTCHA).
  try {
    if (window.top !== window.self) return;
  } catch {
    return;
  }

  if (!window.__stitchRecorderOverlayState) {
    window.__stitchRecorderOverlayState = {
      status: 'Recording',
      reason: '-',
      paused: false,
      pausedSince: null,
      collapsed: false,
      count: Number(window.__stitchRecorderStepCount || 0),
      savedPath: '',
      tabs: [],
      activeTabId: null,
      activeProxyId: (window.__stitchRecorderActiveProxyId || '').toString(),
      activeProxyLabel: (window.__stitchRecorderActiveProxyLabel || '').toString(),
    };
  }
  window.__stitchRecorderRecording = true;

  const state = window.__stitchRecorderOverlayState;
  const runtime = window.StitchOverlayRuntime;
  if (!runtime || typeof runtime.createOverlayShell !== 'function') return;

  const getRuntimeCatalog = () => (
    Array.isArray(window.__stitchRecorderRuntimeProxyCatalog)
      ? window.__stitchRecorderRuntimeProxyCatalog
      : []
  );

  const getRuntimeMap = () => (
    window.__stitchRecorderRuntimeProxyMap &&
    typeof window.__stitchRecorderRuntimeProxyMap === 'object'
      ? window.__stitchRecorderRuntimeProxyMap
      : {}
  );

  const syncProxyPicker = (picker, input) => {
    if (!picker) return;
    const runtimeCatalog = getRuntimeCatalog();
    const runtimeMap = getRuntimeMap();
    const runtimeMapKeys = Object.keys(runtimeMap || {});
    const currentProxyId = (state.activeProxyId || '').toString().trim();
    const currentProxyLabel = (state.activeProxyLabel || '').toString().trim();
    const preserved = (
      (picker.value || '').toString().trim() ||
      (input && input.value ? input.value.toString().trim() : '') ||
      currentProxyId
    );

    while (picker.firstChild) picker.removeChild(picker.firstChild);

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = runtimeCatalog.length || runtimeMapKeys.length
      ? 'Pick proxy from library'
      : 'No enabled proxies in library';
    picker.appendChild(defaultOpt);

    const seen = new Set();
    if (currentProxyId) {
      const currentOpt = document.createElement('option');
      currentOpt.value = currentProxyId;
      currentOpt.textContent = currentProxyLabel || `Current proxy (${currentProxyId})`;
      picker.appendChild(currentOpt);
      seen.add(currentProxyId);
    }

    for (const item of runtimeCatalog) {
      try {
        const id = (item.id || '').toString().trim();
        if (!id || seen.has(id)) continue;
        const opt = document.createElement('option');
        opt.value = id;
        const label = (item.label || '').toString().trim() || id;
        const host = (item.host || '').toString();
        const port = String(item.port || '');
        const type = (item.proxyType || 'http').toString();
        opt.textContent = `${label} (${type}://${host}:${port})`;
        picker.appendChild(opt);
        seen.add(id);
      } catch {}
    }

    if (!runtimeCatalog.length && runtimeMapKeys.length) {
      for (const key of runtimeMapKeys) {
        try {
          const id = String(key || '').trim();
          if (!id || seen.has(id)) continue;
          const raw = (runtimeMap[key] || '').toString();
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = raw ? `${id} (${raw})` : id;
          picker.appendChild(opt);
          seen.add(id);
        } catch {}
      }
    }

    const selectedId = preserved && seen.has(preserved)
      ? preserved
      : currentProxyId && seen.has(currentProxyId)
        ? currentProxyId
        : '';
    picker.value = selectedId;
    if (input && !input.value && selectedId) input.value = selectedId;
  };
"""
