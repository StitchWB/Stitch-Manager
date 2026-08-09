(() => {
  if (window.StitchOverlayRuntime) return;

  // Visual tokens are aligned to the Stitch Toolkit panel (panel.css Deep Space
  // theme): indigo accent #6366f1, neutral dark surfaces, slate text palette.

  // Lazy i18n: ovT() is declared by content_overlay.js, which loads after this
  // file but before createOverlayShell() is ever called.
  function ovLabel(key, fallback) {
    try {
      if (typeof ovT === 'function') {
        const t = ovT(key, fallback);
        if (t && t !== key) return t;
      }
    } catch {}
    return fallback;
  }

  const BASE_STYLE = `
    :host {
      all: initial;
      color-scheme: dark;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    .stitch-panel {
      --stitch-text: #f8fafc;
      --stitch-text-strong: #f8fafc;
      --stitch-muted: #94a3b8;
      --stitch-muted-2: #94a3b8;
      --stitch-border: rgba(99, 102, 241, 0.25);
      --stitch-border-strong: rgba(165, 180, 252, 0.8);
      --stitch-surface: linear-gradient(180deg, rgba(14, 16, 28, 0.95), rgba(8, 9, 16, 0.97));
      --stitch-btn-border: rgba(129, 140, 248, 0.42);
      --stitch-btn-bg: linear-gradient(180deg, rgba(32, 34, 58, 0.95), rgba(22, 23, 40, 0.95));
      --stitch-btn-bg-hover: linear-gradient(180deg, rgba(43, 46, 74, 0.95), rgba(32, 34, 56, 0.95));
      --stitch-btn-shadow-hover: 0 8px 20px rgba(10, 11, 25, 0.36);
      --stitch-danger-border: rgba(255, 104, 104, 0.55);
      --stitch-danger-border-hover: rgba(255, 129, 129, 0.82);
      --stitch-danger-bg: linear-gradient(180deg, rgba(164, 35, 35, 0.88), rgba(134, 23, 23, 0.92));
      --stitch-danger-bg-hover: linear-gradient(180deg, rgba(183, 42, 42, 0.92), rgba(150, 28, 28, 0.95));
      --stitch-ghost-bg: rgba(8, 9, 18, 0.45);
      --stitch-ghost-bg-hover: rgba(14, 15, 30, 0.64);
      --stitch-ghost-border: rgba(129, 140, 248, 0.3);
      --stitch-ghost-border-hover: rgba(165, 180, 252, 0.55);

      pointer-events: auto;
      min-width: 238px;
      max-width: 340px;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      font-size: 12px;
      color: var(--stitch-text);
      background: var(--stitch-surface);
      border: 1px solid var(--stitch-border);
      border-radius: 12px;
      padding: 10px;
      box-shadow:
        0 10px 30px rgba(0, 0, 0, 0.4),
        inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }

    .stitch-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }

    .stitch-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.28px;
      text-transform: uppercase;
      border-radius: 999px;
      padding: 4px 9px;
      border: 1px solid rgba(99, 102, 241, 0.28);
      background: linear-gradient(150deg, #6366f1, #4f46e5);
      color: #f8fafc;
      box-shadow:
        0 8px 20px rgba(99, 102, 241, 0.28),
        inset 0 1px 0 rgba(255, 255, 255, 0.18);
      line-height: 1.1;
      user-select: none;
    }

    .stitch-status {
      font-size: 12px;
      color: #e2e8f0;
      opacity: 0.96;
    }

    .stitch-main {
      margin: 2px 0 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--stitch-text-strong);
      line-height: 1.35;
      white-space: pre-wrap;
    }

    .stitch-steps {
      margin: 4px 0 8px;
      max-height: 100px;
      overflow-y: auto;
      overflow-x: hidden;
      border: 1px solid rgba(99, 102, 241, 0.18);
      border-radius: 8px;
      background: rgba(10, 11, 22, 0.4);
      scrollbar-width: thin;
      scrollbar-color: rgba(99, 102, 241, 0.3) transparent;
    }

    .stitch-steps::-webkit-scrollbar {
      width: 6px;
    }

    .stitch-steps::-webkit-scrollbar-track {
      background: transparent;
    }

    .stitch-steps::-webkit-scrollbar-thumb {
      background: rgba(99, 102, 241, 0.3);
      border-radius: 3px;
    }

    .stitch-step-item {
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.4;
      color: #e2e8f0;
      border-bottom: 1px solid rgba(99, 102, 241, 0.1);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: background-color 0.1s ease;
    }

    .stitch-step-item:last-child {
      border-bottom: none;
    }

    .stitch-step-item.current {
      background: rgba(99, 102, 241, 0.15);
      color: #f8fafc;
      font-weight: 600;
      border-left: 2px solid rgba(99, 102, 241, 0.8);
    }

    .stitch-step-item.completed {
      opacity: 0.5;
      color: #94a3b8;
    }

    .stitch-step-item.future {
      opacity: 0.85;
      color: #e2e8f0;
    }

    .stitch-reason,
    .stitch-paused {
      margin: 0 0 6px;
      font-size: 11px;
      line-height: 1.4;
      color: #b0c0d0;
    }

    .stitch-paused {
      display: none;
      color: #cbd5e1;
    }

    .stitch-compact {
      display: none;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.2px;
      color: #cbd5e1;
      margin: 2px 0 6px;
      opacity: 0.92;
    }

    .stitch-controls {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
      gap: 8px;
    }

    .stitch-controls .stitch-btn {
      width: 100%;
    }

    .stitch-btn {
      appearance: none;
      border: 1px solid var(--stitch-btn-border);
      background: var(--stitch-btn-bg);
      color: var(--stitch-text-strong);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition:
        background-color 0.15s ease,
        border-color 0.15s ease,
        transform 0.08s ease,
        box-shadow 0.15s ease;
    }

    .stitch-btn:hover {
      border-color: var(--stitch-border-strong);
      background: var(--stitch-btn-bg-hover);
      box-shadow: var(--stitch-btn-shadow-hover);
    }

    .stitch-btn:active {
      transform: translateY(1px);
    }

    .stitch-btn:focus-visible {
      outline: none;
      border-color: var(--stitch-border-strong);
      box-shadow:
        0 0 0 3px rgba(99, 102, 241, 0.18),
        var(--stitch-btn-shadow-hover);
    }

    .stitch-btn[disabled] {
      opacity: 0.46;
      cursor: not-allowed;
      box-shadow: none;
      transform: none;
    }

    .stitch-btn.stop {
      background: var(--stitch-danger-bg);
      border-color: var(--stitch-danger-border);
    }

    .stitch-btn.stop:hover {
      border-color: var(--stitch-danger-border-hover);
      background: var(--stitch-danger-bg-hover);
      box-shadow: 0 10px 22px rgba(60, 10, 10, 0.35);
    }

    .stitch-btn.ghost {
      background: var(--stitch-ghost-bg);
      border-color: var(--stitch-ghost-border);
      color: #cbd5e1;
    }

    .stitch-btn.ghost:hover {
      border-color: var(--stitch-ghost-border-hover);
      background: var(--stitch-ghost-bg-hover);
      box-shadow: 0 8px 20px rgba(10, 11, 25, 0.25);
    }

    /* "accent" and "success" are overlay-only variants; keep them within popup visual language */
    .stitch-btn.accent {
      background: rgba(8, 9, 18, 0.45);
      border-color: rgba(99, 102, 241, 0.42);
      color: #e2e8f0;
    }

    .stitch-btn.accent:hover {
      border-color: rgba(165, 180, 252, 0.86);
      background: rgba(14, 15, 30, 0.64);
      box-shadow: 0 10px 22px rgba(17, 18, 40, 0.28);
    }

    .stitch-btn.success {
      background: rgba(8, 9, 18, 0.45);
      border-color: rgba(34, 211, 238, 0.32);
      color: #d9fbff;
    }

    .stitch-btn.success:hover {
      border-color: rgba(34, 211, 238, 0.55);
      background: rgba(14, 15, 30, 0.64);
      box-shadow: 0 10px 22px rgba(7, 40, 46, 0.24);
    }

    .stitch-extra {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(129, 140, 248, 0.22);
    }

    .stitch-extra:empty {
      display: none;
      margin: 0;
      padding: 0;
      border: 0;
    }

    .stitch-field {
      width: 100%;
      border: 1px solid var(--stitch-btn-border);
      background: rgba(10, 11, 22, 0.55);
      color: var(--stitch-text-strong);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 600;
      outline: none;
    }

    .stitch-field:focus {
      border-color: var(--stitch-border-strong);
    }

    .stitch-subhead {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.28px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 6px;
    }

    .stitch-muted {
      color: var(--stitch-muted);
      opacity: 0.9;
    }

    .stitch-tab-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      align-items: center;
    }

    .stitch-tab-btn {
      appearance: none;
      border: 1px solid rgba(129, 140, 248, 0.3);
      background: rgba(8, 9, 18, 0.35);
      color: #cbd5e1;
      border-radius: 10px;
      padding: 6px 8px;
      font-size: 11px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }

    .stitch-tab-btn:hover {
      border-color: rgba(165, 180, 252, 0.55);
      background: rgba(14, 15, 30, 0.64);
    }

    .stitch-tab-btn.active {
      border-color: rgba(99, 102, 241, 0.45);
      background: rgba(99, 102, 241, 0.16);
      color: #f8fafc;
    }

    .stitch-tab-close {
      appearance: none;
      border: 1px solid rgba(255, 104, 104, 0.4);
      background: rgba(120, 22, 22, 0.22);
      color: #ffd6d6;
      border-radius: 10px;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      line-height: 1;
    }

    .stitch-tab-close:hover {
      border-color: rgba(255, 129, 129, 0.82);
      background: rgba(150, 28, 28, 0.28);
    }

    .stitch-collapse-wrap {
      display: none;
    }

    .stitch-panel.collapsible .stitch-collapse-wrap {
      display: block;
    }

    .stitch-action-wrap {
      display: flex;
      gap: 6px;
      align-items: center;
    }
  `;

  function asText(value, fallback) {
    if (value === null || value === undefined) return fallback || '';
    return String(value);
  }

  function applyPosition(host, position, offsetX, offsetY) {
    host.style.position = 'fixed';
    host.style.zIndex = '2147483647';
    host.style.pointerEvents = 'none';
    const x = Number.isFinite(Number(offsetX)) ? Number(offsetX) : 14;
    const y = Number.isFinite(Number(offsetY)) ? Number(offsetY) : 14;
    host.style.top = '';
    host.style.right = '';
    host.style.bottom = '';
    host.style.left = '';
    if (position === 'bottom-right') {
      host.style.right = `${x}px`;
      host.style.bottom = `${y}px`;
      return;
    }
    host.style.right = `${x}px`;
    host.style.top = `${y}px`;
  }

  function createOverlayShell(options) {
    const opts = options || {};
    const hostId = asText(opts.hostId || '__stitch-overlay-host');
    const position = asText(opts.position || 'top-right');
    const parent = document.documentElement || document.body;
    if (!parent) return null;

    let host = document.getElementById(hostId);
    if (!host) {
      host = document.createElement('div');
      host.id = hostId;
    }
    if (opts.markerAttr) {
      host.setAttribute(asText(opts.markerAttr), '1');
    }
    applyPosition(host, position, opts.offsetX, opts.offsetY);
    if (!host.isConnected) {
      parent.appendChild(host);
    }

    let root = host.shadowRoot;
    if (!root) {
      root = host.attachShadow({ mode: 'open' });
    }

    let styleEl = root.getElementById('__stitch-overlay-style');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = '__stitch-overlay-style';
      styleEl.textContent = BASE_STYLE;
      root.appendChild(styleEl);
    }

    let panel = root.getElementById('__stitch-overlay-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = '__stitch-overlay-panel';
      panel.className = 'stitch-panel';

      const head = document.createElement('div');
      head.className = 'stitch-head';

      const title = document.createElement('div');
      title.className = 'stitch-title';
      title.id = '__stitch-overlay-title';

      const status = document.createElement('div');
      status.className = 'stitch-status';
      status.id = '__stitch-overlay-status';

      const actionWrap = document.createElement('div');
      actionWrap.className = 'stitch-action-wrap';

      const collapseWrap = document.createElement('div');
      collapseWrap.className = 'stitch-collapse-wrap';
      const collapseBtn = document.createElement('button');
      collapseBtn.type = 'button';
      collapseBtn.className = 'stitch-btn ghost';
      collapseBtn.id = '__stitch-overlay-collapse';
      collapseBtn.textContent = ovLabel('overlay.collapse', 'Collapse');
      collapseWrap.appendChild(collapseBtn);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'stitch-btn ghost';
      closeBtn.id = '__stitch-overlay-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.style.padding = '8px 12px';
      closeBtn.style.fontSize = '16px';
      closeBtn.style.lineHeight = '1';

      actionWrap.appendChild(collapseWrap);
      actionWrap.appendChild(closeBtn);

      head.appendChild(title);
      head.appendChild(status);
      head.appendChild(actionWrap);

      const compact = document.createElement('div');
      compact.id = '__stitch-overlay-compact';
      compact.className = 'stitch-compact';

      const body = document.createElement('div');
      body.id = '__stitch-overlay-body';

      const main = document.createElement('div');
      main.id = '__stitch-overlay-main';
      main.className = 'stitch-main';

      const steps = document.createElement('div');
      steps.id = '__stitch-overlay-steps';
      steps.className = 'stitch-steps';

      const reason = document.createElement('div');
      reason.id = '__stitch-overlay-reason';
      reason.className = 'stitch-reason';

      const paused = document.createElement('div');
      paused.id = '__stitch-overlay-paused';
      paused.className = 'stitch-paused';

      const extra = document.createElement('div');
      extra.id = '__stitch-overlay-extra';
      extra.className = 'stitch-extra';

      const controls = document.createElement('div');
      controls.id = '__stitch-overlay-controls';
      controls.className = 'stitch-controls';

      body.appendChild(main);
      body.appendChild(steps);
      body.appendChild(reason);
      body.appendChild(paused);
      body.appendChild(extra);
      body.appendChild(controls);

      panel.appendChild(head);
      panel.appendChild(compact);
      panel.appendChild(body);
      root.appendChild(panel);
    }

    const shell = {
      host,
      root,
      panel,
      titleEl: root.getElementById('__stitch-overlay-title'),
      statusEl: root.getElementById('__stitch-overlay-status'),
      mainEl: root.getElementById('__stitch-overlay-main'),
      stepsEl: root.getElementById('__stitch-overlay-steps'),
      reasonEl: root.getElementById('__stitch-overlay-reason'),
      pausedEl: root.getElementById('__stitch-overlay-paused'),
      extraEl: root.getElementById('__stitch-overlay-extra'),
      controlsEl: root.getElementById('__stitch-overlay-controls'),
      compactEl: root.getElementById('__stitch-overlay-compact'),
      bodyEl: root.getElementById('__stitch-overlay-body'),
      collapseBtn: root.getElementById('__stitch-overlay-collapse'),
      closeBtn: root.getElementById('__stitch-overlay-close'),
      collapsed: Boolean(opts.collapsed),
      setCollapsed(next) {
        this.collapsed = Boolean(next);
        if (this.collapseBtn) {
          this.collapseBtn.textContent = this.collapsed
            ? ovLabel('overlay.expand', 'Expand')
            : ovLabel('overlay.collapse', 'Collapse');
        }
        if (this.compactEl) {
          this.compactEl.style.display = this.collapsed ? 'block' : 'none';
        }
        if (this.bodyEl) {
          this.bodyEl.style.display = this.collapsed ? 'none' : 'block';
        }
        if (this.panel) {
          this.panel.style.minWidth = this.collapsed ? '150px' : '238px';
        }
      },
      setVisible(visible) {
        const shouldChange = this._lastVisible !== visible;
        this._lastVisible = visible;
        if (shouldChange) {
          this.host.style.display = visible ? 'block' : 'none';
        }
      },
    };

    if (opts.collapsible) {
      panel.classList.add('collapsible');
      if (shell.collapseBtn && !shell.collapseBtn.__stitchBound) {
        shell.collapseBtn.__stitchBound = true;
        shell.collapseBtn.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          shell.setCollapsed(!shell.collapsed);
          if (typeof opts.onToggleCollapse === 'function') {
            try {
              opts.onToggleCollapse(shell.collapsed);
            } catch {}
          }
        });
      }
    }

    if (shell.closeBtn && !shell.closeBtn.__stitchBound) {
      shell.closeBtn.__stitchBound = true;
      shell.closeBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        shell.setVisible(false);
        if (typeof opts.onClose === 'function') {
          try {
            opts.onClose();
          } catch {}
        }
      });
    }

    if (shell.titleEl) shell.titleEl.textContent = asText(opts.title, 'Stitch');
    if (shell.statusEl) shell.statusEl.textContent = asText(opts.status, 'idle');
    if (shell.mainEl) shell.mainEl.textContent = asText(opts.mainText, '');
    if (shell.reasonEl) {
      const text = asText(opts.reasonText, '');
      shell.reasonEl.textContent = text;
      shell.reasonEl.style.display = text ? 'block' : 'none';
    }
    if (shell.pausedEl) {
      const text = asText(opts.pausedText, '');
      shell.pausedEl.textContent = text;
      shell.pausedEl.style.display = text ? 'block' : 'none';
    }

    shell.setCollapsed(Boolean(opts.collapsed));
    shell.setVisible(opts.visible !== false);
    return shell;
  }

  function renderControls(shell, controls, onCommand) {
    if (!shell || !shell.controlsEl) return;
    shell.controlsEl.textContent = '';
    const list = Array.isArray(controls) ? controls : [];
    for (const entry of list) {
      const cfg = entry && typeof entry === 'object' ? entry : {};
      const btn = document.createElement('button');
      const command = asText(cfg.command, '');
      btn.type = 'button';
      btn.className = `stitch-btn${cfg.variant ? ` ${asText(cfg.variant)}` : ''}`;
      btn.textContent = asText(cfg.label, command || 'Action');
      btn.dataset.command = command;
      if (cfg.id) btn.id = asText(cfg.id);
      if (cfg.disabled) btn.disabled = true;
      btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof onCommand === 'function') {
          onCommand(command, cfg, event);
        }
      });
      shell.controlsEl.appendChild(btn);
    }
  }

  function setControlState(shell, command, patch) {
    if (!shell || !shell.controlsEl) return;
    const cmd = asText(command, '');
    if (!cmd) return;
    const btn = shell.controlsEl.querySelector(`button[data-command="${cmd}"]`);
    if (!btn) return;
    const cfg = patch && typeof patch === 'object' ? patch : {};
    if (Object.prototype.hasOwnProperty.call(cfg, 'disabled')) {
      btn.disabled = Boolean(cfg.disabled);
    }
    if (Object.prototype.hasOwnProperty.call(cfg, 'label')) {
      btn.textContent = asText(cfg.label, btn.textContent || '');
    }
    if (Object.prototype.hasOwnProperty.call(cfg, 'variant')) {
      btn.className = `stitch-btn${cfg.variant ? ` ${asText(cfg.variant)}` : ''}`;
    }
  }

  window.StitchOverlayRuntime = {
    createOverlayShell,
    renderControls,
    setControlState,
  };
})();
