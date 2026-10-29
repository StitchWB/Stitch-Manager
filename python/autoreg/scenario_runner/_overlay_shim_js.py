"""Fallback StitchOverlayRuntime source (used when the extension overlay_runtime.js is unreadable)."""

OVERLAY_SHIM_JS = r"""
(() => {
  if (window.StitchOverlayRuntime) return;
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
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      host.style.right = `${Number.isFinite(Number(options.offsetX)) ? Number(options.offsetX) : 16}px`;
      if (String(options.position || '') === 'bottom-right') {
        host.style.bottom = `${Number.isFinite(Number(options.offsetY)) ? Number(options.offsetY) : 16}px`;
        host.style.top = '';
      } else {
        host.style.top = `${Number.isFinite(Number(options.offsetY)) ? Number(options.offsetY) : 16}px`;
        host.style.bottom = '';
      }
      if (options.markerAttr) host.setAttribute(String(options.markerAttr), '1');
      if (!host.isConnected) parent.appendChild(host);
      if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
      const root = host.shadowRoot;
      let panel = root.getElementById('__shim_panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = '__shim_panel';
        panel.style.pointerEvents = 'auto';
        panel.style.background = 'rgba(8,14,22,.95)';
        panel.style.color = '#f0f7ff';
        panel.style.border = '1px solid rgba(133,180,208,.36)';
        panel.style.borderRadius = '12px';
        panel.style.padding = '10px';
        panel.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
        panel.style.fontSize = '12px';
        panel.style.minWidth = '220px';
        const title = document.createElement('div');
        title.id = '__shim_title';
        const status = document.createElement('div');
        status.id = '__shim_status';
        const main = document.createElement('div');
        main.id = '__shim_main';
        main.style.margin = '6px 0';
        const reason = document.createElement('div');
        reason.id = '__shim_reason';
        const paused = document.createElement('div');
        paused.id = '__shim_paused';
        const compact = document.createElement('div');
        compact.id = '__shim_compact';
        compact.style.display = 'none';
        const body = document.createElement('div');
        body.id = '__shim_body';
        const extra = document.createElement('div');
        extra.id = '__shim_extra';
        const controls = document.createElement('div');
        controls.id = '__shim_controls';
        controls.style.display = 'flex';
        controls.style.gap = '6px';
        controls.style.flexWrap = 'wrap';
        body.appendChild(main);
        body.appendChild(reason);
        body.appendChild(paused);
        body.appendChild(extra);
        body.appendChild(controls);
        panel.appendChild(title);
        panel.appendChild(status);
        panel.appendChild(compact);
        panel.appendChild(body);
        root.appendChild(panel);
      }
      return {
        host,
        root,
        panel,
        titleEl: root.getElementById('__shim_title'),
        statusEl: root.getElementById('__shim_status'),
        mainEl: root.getElementById('__shim_main'),
        reasonEl: root.getElementById('__shim_reason'),
        pausedEl: root.getElementById('__shim_paused'),
        extraEl: root.getElementById('__shim_extra'),
        controlsEl: root.getElementById('__shim_controls'),
        compactEl: root.getElementById('__shim_compact'),
        bodyEl: root.getElementById('__shim_body'),
        collapseBtn: null,
        collapsed: false,
        setCollapsed(next) {
          this.collapsed = Boolean(next);
          if (this.compactEl) this.compactEl.style.display = this.collapsed ? 'block' : 'none';
          if (this.bodyEl) this.bodyEl.style.display = this.collapsed ? 'none' : 'block';
        },
        setVisible(visible) {
          host.style.display = visible ? 'block' : 'none';
        },
      };
    },
    renderControls(shell, controls, onCommand) {
      if (!shell || !shell.controlsEl) return;
      shell.controlsEl.textContent = '';
      for (const entry of controls || []) {
        const btn = document.createElement('button');
        const command = String((entry && entry.command) || '');
        btn.type = 'button';
        btn.textContent = String((entry && entry.label) || command || 'Action');
        btn.dataset.command = command;
        btn.style.padding = '6px 8px';
        btn.style.borderRadius = '7px';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof onCommand === 'function') onCommand(command, entry || {}, event);
        });
        shell.controlsEl.appendChild(btn);
      }
    },
    setControlState(shell, command, patch = {}) {
      const btn = shell && shell.controlsEl
        ? shell.controlsEl.querySelector(`button[data-command="${String(command || '')}"]`)
        : null;
      if (!btn) return;
      if (Object.prototype.hasOwnProperty.call(patch, 'disabled')) btn.disabled = Boolean(patch.disabled);
      if (Object.prototype.hasOwnProperty.call(patch, 'label')) btn.textContent = String(patch.label || btn.textContent || '');
    },
  };
  window.StitchOverlayRuntime = fallback;
})();
"""
