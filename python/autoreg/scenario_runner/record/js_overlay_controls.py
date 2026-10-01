"""Recorder overlay JS, part 2: control channel, shell and UI construction. Concatenated in order by overlay_script.py."""

_OVERLAY_JS_CONTROLS = r"""
  const sendControl = (cmd) => {
    try {
      if (typeof window.__stitchRecordControl === 'function') {
        window.__stitchRecordControl(cmd);
        return;
      }
    } catch {}
    try {
      console.info('__STITCH_REC_CTRL__' + String(cmd || ''));
    } catch {}
  };

  const emitProxySwitch = (proxyLibraryId) => {
    const id = (proxyLibraryId || '').toString().trim();
    if (!id) return;
    try {
      const payload = {
        kind: 'proxy.switch',
        ts: new Date().toISOString(),
        url: location.href,
        selector: null,
        value: null,
        meta: {
          proxyLibraryId: id,
          hasDirectProxy: false,
        },
      };
      if (typeof window.__stitchRecordEvent === 'function') {
        window.__stitchRecordEvent(payload);
      } else {
        console.info('__STITCH_REC_STEP__' + JSON.stringify(payload));
      }
    } catch {}
  };

  const requestProxyRestart = (proxyLibraryId) => {
    try {
      sendControl(JSON.stringify({
        action: 'proxy.restart',
        proxyLibraryId: (proxyLibraryId || '').toString().trim() || null,
        url: location.href,
      }));
    } catch {}
  };

  let shell = null;
  let ui = null;

  const ensureShell = () => {
    if (shell && shell.host && shell.host.isConnected) return shell;
    shell = runtime.createOverlayShell({
      hostId: '__stitch-recorder-overlay-host',
      position: 'bottom-right',
      offsetX: 16,
      offsetY: 16,
      markerAttr: 'data-stitch-recorder',
      title: 'Recorder',
      status: 'Status: Recording',
      mainText: 'Steps: 0',
      reasonText: 'Reason: -',
      pausedText: '',
      visible: true,
      collapsible: true,
      collapsed: Boolean(state.collapsed),
      onToggleCollapse: (collapsed) => {
        state.collapsed = Boolean(collapsed);
        renderOverlay();
      },
    });
    if (!shell) return null;

    runtime.renderControls(
      shell,
      [
        ...(window.__stitchRecorderRecording && !state.paused ? [{ command: 'manual', label: 'Manual ⏸', variant: 'accent' }] : []),
        { command: 'pause', label: state.paused ? 'Resume' : 'Pause' },
        { command: 'stop', label: 'Finish & Save', variant: 'stop' },
        { command: 'browser.close', label: 'Close Browser', variant: 'accent' },
      ],
      (command) => {
        if (command === 'manual') {
          // Record manual step and pause
          if (window.__stitchRecordEvent) {
            window.__stitchRecordEvent({
              kind: 'manual',
              ts: new Date().toISOString(),
              url: location.href,
              selector: null,
              value: null,
              meta: { source: 'manual-step', description: 'Manual action required (e.g., captcha)' },
            });
          } else {
            console.info('__STITCH_REC_STEP__' + JSON.stringify({
              kind: 'manual',
              ts: new Date().toISOString(),
              url: location.href,
              selector: null,
              value: null,
              meta: { source: 'manual-step', description: 'Manual action required (e.g., captcha)' },
            }));
          }
          // Pause recording
          state.paused = true;
          window.__stitchRecorderPaused = true;
          state.status = 'Manual step';
          state.reason = 'Complete the action manually, then click Resume';
          state.pausedSince = Date.now();
          sendControl('pause');
          renderOverlay();
          return;
        }

        if (command === 'pause') {
          // If resuming from manual step, record manual-continue step
          if (state.status === 'Manual step' && state.paused) {
            if (window.__stitchRecordEvent) {
              window.__stitchRecordEvent({
                kind: 'manual-continue',
                ts: new Date().toISOString(),
                url: location.href,
                selector: null,
                value: null,
                meta: { source: 'manual-step-continue' },
              });
            } else {
              console.info('__STITCH_REC_STEP__' + JSON.stringify({
                kind: 'manual-continue',
                ts: new Date().toISOString(),
                url: location.href,
                selector: null,
                value: null,
                meta: { source: 'manual-step-continue' },
              }));
            }
          }
          state.paused = !state.paused;
          window.__stitchRecorderPaused = state.paused;
          if (state.paused) {
            state.status = 'Paused';
            state.reason = 'Operator pause';
            if (!state.pausedSince) state.pausedSince = Date.now();
            sendControl('pause');
          } else {
            state.status = 'Recording';
            state.reason = '-';
            state.pausedSince = null;
            sendControl('resume');
          }
          renderOverlay();
          return;
        }

        if (command === 'stop') {
          state.status = 'Stopping...';
          window.__stitchRecorderPaused = true;
          state.pausedSince = null;
          renderOverlay();
          sendControl('stop');
          return;
        }

        if (command === 'browser.close') {
          state.status = 'Closing browser...';
          state.reason = 'Operator requested browser close';
          renderOverlay();
          sendControl(JSON.stringify({ action: 'browser.close' }));
        }
      }
    );
    return shell;
  };

  const makeBtn = (label, variant) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `stitch-btn${variant ? ` ${variant}` : ''}`;
    btn.textContent = label;
    return btn;
  };

  const ensureUi = () => {
    const currentShell = ensureShell();
    if (!currentShell || !currentShell.extraEl) return null;
    if (ui && ui.tabsList && ui.tabsList.isConnected) return ui;

    const extra = currentShell.extraEl;
    extra.textContent = '';

    const tabsBlock = document.createElement('div');
    tabsBlock.style.marginBottom = '8px';
    const tabsHeader = document.createElement('div');
    tabsHeader.textContent = 'Tabs';
    tabsHeader.className = 'stitch-subhead';
    const tabsList = document.createElement('div');
    tabsList.style.display = 'flex';
    tabsList.style.flexDirection = 'column';
    tabsList.style.gap = '4px';
    tabsBlock.appendChild(tabsHeader);
    tabsBlock.appendChild(tabsList);

    const proxyPicker = document.createElement('select');
    proxyPicker.className = 'stitch-field';
    proxyPicker.style.marginBottom = '8px';

    const proxyRow = document.createElement('div');
    proxyRow.style.display = 'grid';
    proxyRow.style.gridTemplateColumns = '1fr auto auto';
    proxyRow.style.gap = '6px';
    proxyRow.style.marginBottom = '8px';

    const proxyInput = document.createElement('input');
    proxyInput.type = 'text';
    proxyInput.placeholder = 'proxyLibraryId';
    proxyInput.className = 'stitch-field';
    proxyInput.style.padding = '8px 10px';

    const proxyRecordBtn = makeBtn('Record Step', 'success');
    const proxyApplyBtn = makeBtn('Apply&Continue', 'accent');

    proxyPicker.onchange = () => {
      const id = (proxyPicker.value || '').trim();
      if (id) proxyInput.value = id;
    };

    proxyRecordBtn.onclick = () => {
      const id = (proxyInput.value || '').trim();
      if (!id) return;
      emitProxySwitch(id);
      state.reason = `Proxy switched (${id})`;
      renderOverlay();
    };

    proxyApplyBtn.onclick = () => {
      const id = (proxyInput.value || '').trim();
      if (!id) return;
      emitProxySwitch(id);
      requestProxyRestart(id);
      state.status = 'Restarting...';
      state.reason = `Restarting with ${id}`;
      renderOverlay();
    };

    proxyRow.appendChild(proxyInput);
    proxyRow.appendChild(proxyRecordBtn);
    proxyRow.appendChild(proxyApplyBtn);

    const utilityRow = document.createElement('div');
    utilityRow.style.display = 'flex';
    utilityRow.style.gap = '6px';
    utilityRow.style.marginTop = '8px';
    const newTabBtn = makeBtn('New tab', '');
    newTabBtn.onclick = () => {
      sendControl(JSON.stringify({ action: 'tab.new' }));
    };
    utilityRow.appendChild(newTabBtn);

    extra.appendChild(tabsBlock);
    extra.appendChild(proxyPicker);
    extra.appendChild(proxyRow);
    extra.appendChild(utilityRow);

    ui = {
      tabsList,
      proxyPicker,
      proxyInput,
      newTabBtn,
    };
    return ui;
  };
"""
