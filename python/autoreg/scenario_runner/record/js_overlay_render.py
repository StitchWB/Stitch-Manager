"""Recorder overlay JS, part 3: tabs/overlay rendering and window hooks. Concatenated in order by overlay_script.py."""

_OVERLAY_JS_RENDER = r"""
  const renderTabs = () => {
    const refs = ensureUi();
    if (!refs) return;
    const tabsList = refs.tabsList;
    while (tabsList.firstChild) tabsList.removeChild(tabsList.firstChild);

    const tabs = Array.isArray(state.tabs) ? state.tabs : [];
    const activeTabId = (state.activeTabId || '').toString();
    if (!tabs.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No tabs';
      empty.style.opacity = '0.7';
      tabsList.appendChild(empty);
      return;
    }

    let tabIdx = 0;
    for (const tab of tabs) {
      const tabId = (tab && tab.id != null ? String(tab.id) : '').trim();
      if (!tabId) continue;
      tabIdx += 1;

      const row = document.createElement('div');
      row.className = 'stitch-tab-row';

      const activate = document.createElement('button');
      activate.type = 'button';
      activate.className = `stitch-tab-btn${tabId === activeTabId ? ' active' : ''}`;
      activate.title = (tab.url || '').toString();

      const content = document.createElement('span');
      content.style.display = 'inline-flex';
      content.style.alignItems = 'center';
      content.style.gap = '6px';

      const indexBadge = document.createElement('span');
      indexBadge.textContent = String(tabIdx);
      indexBadge.style.opacity = '0.75';
      indexBadge.style.minWidth = '12px';

      const faviconUrl = (tab.favicon || '').toString().trim();
      if (faviconUrl) {
        const img = document.createElement('img');
        img.src = faviconUrl;
        img.alt = '';
        img.width = 14;
        img.height = 14;
        img.style.width = '14px';
        img.style.height = '14px';
        img.style.borderRadius = '3px';
        img.style.objectFit = 'cover';
        img.style.background = 'rgba(15,23,42,0.5)';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => {
          try { img.remove(); } catch {}
        };
        content.appendChild(img);
      }

      const label = document.createElement('span');
      label.textContent = (tab.title || tab.url || 'tab').toString().slice(0, 42);
      content.appendChild(indexBadge);
      content.appendChild(label);
      activate.textContent = '';
      activate.appendChild(content);

      activate.onclick = () => {
        sendControl(JSON.stringify({ action: 'tab.activate', tabId }));
      };

      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.className = 'stitch-tab-close';
      close.onclick = () => {
        sendControl(JSON.stringify({ action: 'tab.close', tabId }));
      };

      row.appendChild(activate);
      row.appendChild(close);
      tabsList.appendChild(row);
    }
  };

  const renderOverlay = () => {
    const currentShell = ensureShell();
    const refs = ensureUi();
    if (!currentShell || !refs) return;

    syncProxyPicker(refs.proxyPicker, refs.proxyInput);

    if (currentShell.titleEl) currentShell.titleEl.textContent = 'Recorder';
    if (currentShell.statusEl) currentShell.statusEl.textContent = `Status: ${state.status || 'Recording'}`;
    if (currentShell.mainEl) currentShell.mainEl.textContent = `Steps: ${Number.isFinite(Number(state.count)) ? Number(state.count) : 0}`;

    let reasonValue = (state.reason || '-').toString();
    if (!reasonValue || reasonValue === '-') {
      const currentProxyId = (state.activeProxyId || '').toString().trim();
      const currentProxyLabel = (state.activeProxyLabel || '').toString().trim();
      if (currentProxyId || currentProxyLabel) {
        reasonValue = currentProxyLabel ? `Proxy: ${currentProxyLabel}` : `Proxy: ${currentProxyId}`;
      }
    }
    if (currentShell.reasonEl) {
      currentShell.reasonEl.textContent = `Reason: ${reasonValue || '-'}`;
      currentShell.reasonEl.style.display = 'block';
    }

    if (currentShell.pausedEl) {
      if (state.paused && state.pausedSince) {
        const sec = Math.max(0, Math.floor((Date.now() - state.pausedSince) / 1000));
        currentShell.pausedEl.textContent = `Paused: ${sec}s`;
        currentShell.pausedEl.style.display = 'block';
      } else {
        currentShell.pausedEl.textContent = 'Paused: -';
        currentShell.pausedEl.style.display = 'none';
      }
    }

    if (currentShell.compactEl) {
      currentShell.compactEl.textContent = `${state.paused ? 'PAUSED' : 'REC'} • ${Number.isFinite(Number(state.count)) ? Number(state.count) : 0}`;
    }

    runtime.setControlState(currentShell, 'pause', { label: state.paused ? 'Resume' : 'Pause' });
    currentShell.setCollapsed(Boolean(state.collapsed));
    currentShell.setVisible(true);
    renderTabs();
  };

  const ensureOverlayAttached = () => {
    const currentShell = ensureShell();
    if (!currentShell) return;
    if (!currentShell.host.isConnected) {
      (document.body || document.documentElement).appendChild(currentShell.host);
    }
    renderOverlay();
  };

  window.__stitchRecorderOverlaySetStatus = (text) => {
    state.status = (text || 'Recording').toString();
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetReason = (text) => {
    const v = (text || '').toString().trim();
    state.reason = v || '-';
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetPaused = (flag) => {
    state.paused = Boolean(flag);
    if (state.paused) {
      if (!state.pausedSince) state.pausedSince = Date.now();
    } else {
      state.pausedSince = null;
    }
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetSaved = (path) => {
    state.status = 'Saved';
    state.reason = path ? `Saved to ${path}` : 'Saved';
    state.paused = false;
    state.pausedSince = null;
    state.savedPath = (path || '').toString();
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetCount = (value) => {
    const n = Number(value || 0);
    state.count = Number.isFinite(n) ? n : 0;
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetTabs = (payload) => {
    const data = payload && typeof payload === 'object' ? payload : {};
    const tabs = Array.isArray(data.tabs) ? data.tabs : [];
    state.tabs = tabs
      .map((t) => {
        if (!t || typeof t !== 'object') return null;
        const id = (t.id || '').toString().trim();
        if (!id) return null;
        return {
          id,
          title: (t.title || '').toString(),
          url: (t.url || '').toString(),
          favicon: (t.favicon || '').toString(),
        };
      })
      .filter(Boolean);
    const activeTabId = (data.activeTabId || '').toString().trim();
    state.activeTabId = activeTabId || (state.tabs[0] ? state.tabs[0].id : null);
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetProxy = (payload) => {
    const data = payload && typeof payload === 'object' ? payload : {};
    state.activeProxyId = (data.proxyLibraryId || '').toString().trim();
    state.activeProxyLabel = (data.label || '').toString().trim();
    ensureOverlayAttached();
  };

  state.count = Number(window.__stitchRecorderStepCount || 0);
  ensureOverlayAttached();

  window.addEventListener('pageshow', ensureOverlayAttached);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureOverlayAttached();
  });

  setInterval(() => {
    ensureOverlayAttached();
  }, 700);
})();
"""
