// ═══════════════════════════════════════════════════════════════════════
// Stitch Toolkit — Content Script (v0.5.1)
// Architecture: EventBus + Module pattern, No side-effects in IIFEs
// All EventBus subscriptions happen AFTER all modules are defined
// ═══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
  if (window.__stitchToolkitInjected) return;
  window.__stitchToolkitInjected = true;

  // ─────────────────────────────────────────────────────────────────────
  // EventBus — центральная шина для коммуникации модулей
  // ─────────────────────────────────────────────────────────────────────
  const EventBus = (function () {
    const listeners = {};
    function on(event, cb) { (listeners[event] = listeners[event] || []).push(cb); }
    function off(event, cb) { (listeners[event] || []).splice((listeners[event] || []).indexOf(cb) >>> 0, 1); }
    function emit(event, data) { (listeners[event] || []).forEach(cb => { try { cb(data); } catch (e) { console.error('[TK EventBus]', e); } }); }
    function once(event, cb) { on(event, function h(data) { off(event, h); cb(data); }); }
    return { on, off, emit, once };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // StateManager — персистентное состояние через localStorage
  // ─────────────────────────────────────────────────────────────────────
  const StateManager = (function () {
    const PREFIX = 'tk:';
    const defaults = {
      expanded: false,
      posX: null,
      posY: null,
      panelPosX: null,
      panelPosY: null,
      activeTab: 'stripe',
      theme: 'auto',
      autoExpand: true,
      clipboardWatch: true,
      soundEffects: false,
      autoDetect: true,
      cardHistory: [],
      billingProfiles: [],
      lastCard: null,
      recordingSteps: [],
      recorderPaused: false,
    };
    const state = {};
    Object.keys(defaults).forEach(function (k) {
      try { var raw = localStorage.getItem(PREFIX + k); state[k] = raw !== null ? JSON.parse(raw) : defaults[k]; }
      catch { state[k] = defaults[k]; }
    });

    function save(key, val) {
      state[key] = val;
      try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch {}
      EventBus.emit('state:' + key, val);
    }
    function get(key) { return state[key]; }
    function set(key, val) { save(key, val); }
    function getAll() { return Object.assign({}, state); }

    return { save: save, get: get, set: set, getAll: getAll };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // ToolRegistry — регистрация и управление инструментами
  // ─────────────────────────────────────────────────────────────────────
  const ToolRegistry = (function () {
    var tools = {};
    var activeId = null;

    function register(tool) { if (tool && tool.id) tools[tool.id] = tool; }
    function getAll() { return Object.values(tools); }
    function get(id) { return tools[id]; }
    function getActive() { return activeId ? tools[activeId] : null; }

    function activate(id) {
      var tool = tools[id];
      if (!tool) return;
      activeId = id;
      StateManager.set('activeTab', id);
      EventBus.emit('tool:activated', tool);
    }

    return { register: register, getAll: getAll, get: get, getActive: getActive, activate: activate };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // NotificationService — toast уведомления
  // NO side effects here — only pure functions
  // ─────────────────────────────────────────────────────────────────────
  var NotificationService = (function () {
    function init() {
      if (document.getElementById('tk-toast-root')) return;
      var root = document.createElement('div');
      root.id = 'tk-toast-root';
      root.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483645;overflow:visible;';
      document.documentElement.appendChild(root);

      var container = document.createElement('div');
      container.className = 'tk-toast-container tk-toast-bottom';
      root.appendChild(container);

      var container2 = document.createElement('div');
      container2.className = 'tk-toast-container tk-toast-top';
      root.appendChild(container2);

      root._container = container;
      root._container2 = container2;
    }

    function showToast(msg, type, opts) {
      opts = opts || {};
      var root = document.getElementById('tk-toast-root');
      var container = opts.top ? root._container2 : root._container;
      var icon = type === 'ok' ? '✅' : type === 'err' ? '❌' : type === 'warn' ? '⚠️' : '💡';
      var el = document.createElement('div');
      el.className = 'tk-toast';
      el.innerHTML = '<span class="tk-toast-icon">' + icon + '</span><span class="tk-toast-msg">' + msg + '</span>' +
        (opts.action ? '<button class="tk-toast-action" id="tk-toast-act">' + opts.action + '</button>' : '') +
        '<button class="tk-toast-close">✕</button>';

      if (opts.action) el.querySelector('#tk-toast-act').onclick = function () { if (opts.actionFn) opts.actionFn(); remove(); };
      el.querySelector('.tk-toast-close').onclick = remove;
      el.style.animationDelay = '0ms';
      container.appendChild(el);

      function remove() {
        el.classList.add('tk-toast-out');
        setTimeout(function () { el.remove(); }, 280);
      }

      var duration = opts.duration !== undefined ? opts.duration : (type === 'ok' ? 2500 : type === 'err' ? 4000 : 3000);
      if (duration > 0) setTimeout(remove, duration);
      return { close: remove };
    }

    function success(msg, opts) { return showToast(msg, 'ok', opts); }
    function error(msg, opts) { return showToast(msg, 'err', opts); }
    function info(msg, opts) { return showToast(msg, 'info', opts); }
    function warn(msg, opts) { return showToast(msg, 'warn', opts); }

    return { success: success, error: error, info: info, warn: warn };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // ShortcutManager — глобальные keyboard shortcuts
  // NO side effects here
  // ─────────────────────────────────────────────────────────────────────
  var ShortcutManager = (function () {
    function init() {
      document.addEventListener('keydown', function (e) {
        if (!e || !(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
        var key = (e.ctrlKey ? 'Ctrl+' : 'Cmd+') + 'Shift+' + e.key.toUpperCase();
        var map = { 'Ctrl+Shift+S': 'toggle', 'Cmd+Shift+S': 'toggle', 'Ctrl+Shift+F': 'quick-fill', 'Cmd+Shift+F': 'quick-fill', 'Ctrl+Shift+R': 'recorder-toggle', 'Cmd+Shift+R': 'recorder-toggle', 'Ctrl+Shift+E': 'export', 'Cmd+Shift+E': 'export' };
        var action = map[key];
        if (action) { e.preventDefault(); e.stopPropagation(); EventBus.emit('shortcut:' + action, e); }
      }, true);
    }
    return { init: init };
  })();

  // ── SVG Icons (Phosphor-style, inline) ───────────────────────────────
  var ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    stripe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    recorder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    lightning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    detect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  };

  // ─────────────────────────────────────────────────────────────────────
  // PanelManager — UI: float button, panel, tabs, drag
  // ONLY define functions here, NO EventBus.on subscriptions
  // ─────────────────────────────────────────────────────────────────────
  var PanelManager = (function () {
    var host, shadow, floatBtn, panel;
    var dragMode = null;

    function loadStyle() {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('panel/panel.css');
      shadow.appendChild(link);
    }

    function createUI() {
      if (document.getElementById('tk-shadow-host')) return;
      host = document.createElement('div');
      host.id = 'tk-shadow-host';
      host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;overflow:visible;';
      document.documentElement.appendChild(host);
      shadow = host.attachShadow({ mode: 'open' });

      loadStyle();

      // Float button
      floatBtn = document.createElement('button');
      floatBtn.className = 'tk-float-btn';
      floatBtn.innerHTML = ICONS.logo;
      applyTheme();
      var posX = StateManager.get('posX');
      var posY = StateManager.get('posY');
      if (posX !== null && posY !== null) {
        floatBtn.style.right = 'auto';
        floatBtn.style.bottom = 'auto';
        floatBtn.style.left = posX + 'px';
        floatBtn.style.top = posY + 'px';
      }
      shadow.appendChild(floatBtn);

      // Panel
      panel = document.createElement('div');
      panel.className = 'tk-panel' + (StateManager.get('expanded') ? ' tk-open' : '');
      panel.innerHTML =
        '<div class="tk-panel-header" id="tk-header">' +
          '<div class="tk-panel-logo">' + ICONS.logo + '</div>' +
          '<div class="tk-panel-info"><div class="tk-panel-title">' + window.StitchI18n.t('app.title') + '</div><div class="tk-panel-subtitle" id="tk-header-sub">' + window.StitchI18n.t('app.ready') + '</div></div>' +
          '<div class="tk-panel-actions">' +
            '<button class="tk-action-btn" id="tk-btn-theme" title="' + window.StitchI18n.t('tooltip.toggleTheme') + '">' + ICONS.moon + '</button>' +
            '<button class="tk-action-btn" id="tk-btn-settings" title="' + window.StitchI18n.t('tooltip.settings') + '">' + ICONS.settings + '</button>' +
          '</div>' +
          '<button class="tk-close-btn" id="tk-close" title="' + window.StitchI18n.t('tooltip.close') + '">' + ICONS.close + '</button>' +
        '</div>' +
        '<div class="tk-tabs" id="tk-tabs">' +
          '<button class="tk-tab tk-active" data-id="stripe"><span class="tk-tab-icon">' + ICONS.stripe + '</span><span>' + window.StitchI18n.t('tab.stripe') + '</span></button>' +
          '<button class="tk-tab" data-id="recorder"><span class="tk-tab-icon">' + ICONS.recorder + '</span><span>' + window.StitchI18n.t('tab.recorder') + '</span><span class="tk-steps-badge" id="tk-rec-badge" style="display:none">0</span></button>' +
          '<button class="tk-tab" data-id="settings"><span class="tk-tab-icon">' + ICONS.settings + '</span><span>' + window.StitchI18n.t('tab.settings') + '</span></button>' +
        '</div>' +
        '<div class="tk-tool-content" id="tk-tool-content"></div>';
      shadow.appendChild(panel);

      bindEvents();
      positionPanel();
    }

    function bindEvents() {
      floatBtn.addEventListener('click', function (e) { if (dragMode === null) togglePanel(); });
      floatBtn.addEventListener('mousedown', startDrag);
      panel.querySelector('#tk-close').addEventListener('click', function () { togglePanel(false); });
      panel.querySelector('#tk-header').addEventListener('mousedown', startDragPanel);

      panel.querySelector('#tk-tabs').addEventListener('click', function (e) {
        var tab = e.target.closest('.tk-tab');
        if (!tab) return;
        var id = tab.dataset.id;
        ToolRegistry.activate(id);
        updateTabUI(id);
      });

      panel.querySelector('#tk-btn-theme').addEventListener('click', function (e) { e.stopPropagation(); cycleTheme(); });
      panel.querySelector('#tk-btn-settings').addEventListener('click', function (e) { e.stopPropagation(); ToolRegistry.activate('settings'); updateTabUI('settings'); });

      document.addEventListener('mouseup', endDrag);
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && StateManager.get('expanded')) togglePanel(false); });

      floatBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); showContextMenu(e.clientX, e.clientY); });
      document.addEventListener('click', function (e) { if (!e.target.closest('#tk-shadow-host')) hideContextMenu(); });
    }

    function startDrag(e) {
      if (e.button !== 0) return;
      dragMode = 'btn';
      var rect = floatBtn.getBoundingClientRect();
      floatBtn._dragStartX = e.clientX;
      floatBtn._dragStartY = e.clientY;
      floatBtn._dragElStartX = rect.left;
      floatBtn._dragElStartY = rect.top;
      floatBtn.classList.add('dragging');
      e.preventDefault();
    }

    function startDragPanel(e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      dragMode = 'panel';
      var rect = panel.getBoundingClientRect();
      panel._dragStartX = e.clientX;
      panel._dragStartY = e.clientY;
      panel._dragElStartX = rect.left;
      panel._dragElStartY = rect.top;
      e.preventDefault();
    }

    function onDrag(e) {
      if (!dragMode) return;
      var dx = e.clientX - (dragMode === 'btn' ? floatBtn._dragStartX : panel._dragStartX);
      var dy = e.clientY - (dragMode === 'btn' ? floatBtn._dragStartY : panel._dragStartY);

      if (dragMode === 'btn') {
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) floatBtn.classList.add('dragging');
        floatBtn.style.right = 'auto';
        floatBtn.style.bottom = 'auto';
        floatBtn.style.left = (floatBtn._dragElStartX + dx) + 'px';
        floatBtn.style.top = (floatBtn._dragElStartY + dy) + 'px';
        positionPanel();
      } else {
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = (panel._dragElStartX + dx) + 'px';
        panel.style.top = (panel._dragElStartY + dy) + 'px';
      }
    }

    function endDrag() {
      if (dragMode === 'btn') {
        var rect = floatBtn.getBoundingClientRect();
        StateManager.save('posX', Math.round(rect.left));
        StateManager.save('posY', Math.round(rect.top));
        StateManager.save('panelPosX', null);
        StateManager.save('panelPosY', null);
        floatBtn.classList.remove('dragging');
      } else if (dragMode === 'panel') {
        var rect = panel.getBoundingClientRect();
        StateManager.save('panelPosX', Math.round(rect.left));
        StateManager.save('panelPosY', Math.round(rect.top));
      }
      dragMode = null;
    }

    function positionPanel() {
      var savedPanelX = StateManager.get('panelPosX');
      var savedPanelY = StateManager.get('panelPosY');
      if (savedPanelX !== null && savedPanelY !== null) {
        panel.style.top = savedPanelY + 'px';
        panel.style.left = savedPanelX + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        return;
      }
      var rect = floatBtn.getBoundingClientRect();
      var panelH = 480;
      var top = rect.top - panelH - 12;
      if (top < 10) top = rect.bottom + 12;
      var left = rect.left + rect.width / 2 - 150;
      if (left < 10) left = 10;
      if (left + 300 > window.innerWidth - 10) left = window.innerWidth - 310;
      panel.style.top = top + 'px';
      panel.style.left = left + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }

    function togglePanel(force) {
      var expanded = force !== undefined ? force : !StateManager.get('expanded');
      StateManager.save('expanded', expanded);
      panel.classList.toggle('tk-open', expanded);
      if (expanded) positionPanel();
    }

    function updateTabUI(activeId) {
      panel.querySelectorAll('.tk-tab').forEach(function (t) { t.classList.toggle('tk-active', t.dataset.id === activeId); });
      var title = panel.querySelector('.tk-panel-subtitle');
      var titles = { stripe: window.StitchI18n.t('stripe.cardDetails'), recorder: window.StitchI18n.t('recorder.title'), settings: window.StitchI18n.t('tab.settings') };
      if (title) title.textContent = titles[activeId] || window.StitchI18n.t('app.ready');
    }

    function updateToolContent(html) {
      var tc = panel.querySelector('#tk-tool-content');
      if (tc) tc.innerHTML = html;
    }

    function setSubtitle(text) {
      var sub = panel.querySelector('.tk-panel-subtitle');
      if (sub) sub.textContent = text;
    }

    function setRecordingUI(recording, paused) {
      floatBtn.classList.toggle('tk-recording', recording && !paused);
    }

    function updateStepsBadge() {
      var steps = StateManager.get('recordingSteps') || [];
      floatBtn.querySelectorAll('.tk-steps-dot').forEach(function (b) { b.remove(); });
      if (steps.length > 0) {
        var badge = document.createElement('div');
        badge.className = 'tk-steps-dot';
        badge.textContent = steps.length > 99 ? '99+' : steps.length;
        floatBtn.appendChild(badge);
      }
    }

    function applyTheme() {
      var theme = StateManager.get('theme');
      document.documentElement.classList.remove('tk-light', 'tk-dark');
      if (theme === 'light') document.documentElement.classList.add('tk-light');
      else if (theme === 'dark') document.documentElement.classList.add('tk-dark');
      var btn = panel && panel.querySelector('#tk-btn-theme');
      if (btn) btn.innerHTML = theme === 'light' ? ICONS.moon : ICONS.sun;
    }

    function cycleTheme() {
      var t = StateManager.get('theme');
      var next = t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto';
      StateManager.set('theme', next);
      applyTheme();
    }

    function showContextMenu(x, y) {
      hideContextMenu();
      var menu = document.createElement('div');
      menu.className = 'tk-context-menu tk-visible';
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      var i18n = window.StitchI18n.t;
      menu.innerHTML =
        '<div class="tk-ctx-item" id="tk-ctx-fill"><span class="tk-ctx-icon">⚡</span> ' + i18n('ctx.quickFill') + ' <span class="tk-ctx-shortcut">⌘⇧F</span></div>' +
        '<div class="tk-ctx-item" id="tk-ctx-rec"><span class="tk-ctx-icon">⏺</span> ' + i18n('ctx.toggleRecorder') + ' <span class="tk-ctx-shortcut">⌘⇧R</span></div>' +
        '<div class="tk-ctx-item" id="tk-ctx-export"><span class="tk-ctx-icon">📤</span> ' + i18n('ctx.exportScenario') + ' <span class="tk-ctx-shortcut">⌘⇧E</span></div>' +
        '<div class="tk-ctx-sep"></div>' +
        '<div class="tk-ctx-item" id="tk-ctx-stripe"><span class="tk-ctx-icon">💳</span> ' + i18n('ctx.stripeFiller') + '</div>' +
        '<div class="tk-ctx-item" id="tk-ctx-recorder"><span class="tk-ctx-icon">⏺</span> ' + i18n('ctx.recorder') + '</div>' +
        '<div class="tk-ctx-sep"></div>' +
        '<div class="tk-ctx-item" id="tk-ctx-expand"><span class="tk-ctx-icon">⬆</span> ' + (StateManager.get('expanded') ? i18n('ctx.collapse') : i18n('ctx.expand')) + '</div>';
      shadow.appendChild(menu);

      menu.querySelector('#tk-ctx-fill').onclick = function () { EventBus.emit('shortcut:quick-fill'); hideContextMenu(); };
      menu.querySelector('#tk-ctx-rec').onclick = function () { EventBus.emit('shortcut:recorder-toggle'); hideContextMenu(); };
      menu.querySelector('#tk-ctx-export').onclick = function () { EventBus.emit('shortcut:export'); hideContextMenu(); };
      menu.querySelector('#tk-ctx-stripe').onclick = function () { ToolRegistry.activate('stripe'); updateTabUI('stripe'); hideContextMenu(); };
      menu.querySelector('#tk-ctx-recorder').onclick = function () { ToolRegistry.activate('recorder'); updateTabUI('recorder'); hideContextMenu(); };
      menu.querySelector('#tk-ctx-expand').onclick = function () { togglePanel(); hideContextMenu(); };

      setTimeout(function () { document.addEventListener('click', hideHandler); }, 10);
      function hideHandler(e) {
        if (!menu.contains(e.target)) { hideContextMenu(); document.removeEventListener('click', hideHandler); }
      }
    }

    function hideContextMenu() {
      if (shadow) shadow.querySelectorAll('.tk-context-menu').forEach(function (m) { m.remove(); });
    }

    function pulseFloatBtn() {
      floatBtn.style.animation = 'tk-pulse 0.5s ease 3';
      setTimeout(function () { floatBtn.style.animation = ''; }, 1500);
    }

    function expandPanel() {
      if (!StateManager.get('expanded')) togglePanel(true);
    }

    function refreshCurrentTool() {
      var tc = getToolContainer();
      if (tc) {
        var tool = ToolRegistry.getActive();
        if (tool && tool.mount) tool.mount(tc);
      }
    }

    function getToolContainer() {
      return shadow ? shadow.querySelector('#tk-tool-content') : null;
    }

    // NO EventBus.on here — all subscriptions happen in Subscriptions block

    return {
      createUI: createUI,
      togglePanel: togglePanel,
      updateTabUI: updateTabUI,
      updateToolContent: updateToolContent,
      setSubtitle: setSubtitle,
      setRecordingUI: setRecordingUI,
      updateStepsBadge: updateStepsBadge,
      applyTheme: applyTheme,
      pulseFloatBtn: pulseFloatBtn,
      expandPanel: expandPanel,
      hideContextMenu: hideContextMenu,
      refreshCurrentTool: refreshCurrentTool,
      getToolContainer: getToolContainer,
    };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // StripeFillerTool — инструмент заполнения карт
  // ONLY define functions here, NO EventBus.on subscriptions
  // ─────────────────────────────────────────────────────────────────────
  var StripeFillerTool = (function () {
    function luhn(card) {
      var n = card.replace(/\D/g, '');
      if (!n || n.length < 13) return false;
      var sum = 0, odd = false;
      for (var i = n.length - 1; i >= 0; i--) {
        var d = parseInt(n[i], 10);
        if (odd) { d *= 2; if (d > 9) d -= 9; }
        sum += d;
        odd = !odd;
      }
      return sum % 10 === 0;
    }

    function mask(raw) { return raw.replace(/\d(?=\d{4})/g, '*'); }

    function parseCard(raw) {
      var t = String(raw || '').trim();
      if (!t) return null;
      var p = t.split('|');
      if (p.length >= 4) return { number: p[0].trim(), month: p[1].trim(), year: p[2].trim(), cvc: p[3].trim() };
      var m = t.match(/(\d{13,19})\D+(\d{1,2})\D+(\d{2,4})\D+(\d{3,4})/);
      if (m) return { number: m[1], month: m[2], year: m[3], cvc: m[4] };
      return null;
    }

    function saveCard(raw) {
      if (!raw || raw.trim().length < 10) return;
      var hist = StateManager.get('cardHistory') || [];
      var filtered = hist.filter(function (h) { return h.raw !== raw.trim(); });
      filtered.unshift({ raw: raw.trim(), ts: Date.now(), name: '' });
      if (filtered.length > 10) filtered.length = 10;
      StateManager.set('cardHistory', filtered);
      StateManager.set('lastCard', raw.trim());
    }

    function fillForm(data, billing) {
      return chrome.runtime.sendMessage({ type: 'tk:stripe-fill', payload: { cardData: data, billing: billing } })
        .then(function (resp) {
          if (resp && resp.ok) return resp;
          throw new Error(resp && resp.error ? resp.error : 'No Stripe fields found');
        });
    }

    function quickFill() {
      var lastCard = StateManager.get('lastCard');
      if (!lastCard) { NotificationService.warn(window.StitchI18n.t('stripe.noLastCard')); return; }
      var data = parseCard(lastCard);
      if (!data) { NotificationService.error(window.StitchI18n.t('stripe.invalidLastCard')); return; }
      PanelManager.setSubtitle(window.StitchI18n.t('status.filling'));
      fillForm(data, null).then(function (resp) {
        NotificationService.success(window.StitchI18n.t('stripe.filledLastCard', { count: resp.filledFrames || '?' }));
        PanelManager.setSubtitle(window.StitchI18n.t('stripe.cardDetails'));
      }).catch(function (e) {
        NotificationService.error(window.StitchI18n.t('stripe.fillFailed') + ': ' + (e.message || ''));
        PanelManager.setSubtitle(window.StitchI18n.t('stripe.cardDetails'));
      });
    }

    function render() {
      var hist = StateManager.get('cardHistory') || [];
      var lastCard = StateManager.get('lastCard');
      var profiles = StateManager.get('billingProfiles') || [];
      var lastProfile = profiles[0] || null;

      var histOptions = hist.map(function (h) { return '<option value="' + h.raw.replace(/"/g, '&quot;') + '">' + mask(h.raw) + '</option>'; }).join('');
      var profileOptions = profiles.map(function (p) { return '<option value="' + p.name + '">' + p.name + '</option>'; }).join('');

      var i18n = window.StitchI18n.t;
      return '<div class="tk-section-title">' + i18n('stripe.cardDetails') + '</div>' +
        '<div class="tk-card-row">' +
          '<select id="tk-hist" class="tk-select" title="Recent cards"><option value="">' + i18n('stripe.recentCards') + '</option>' + histOptions + '</select>' +
          '<input id="tk-card" class="tk-input" placeholder="' + i18n('stripe.cardNumber') + '" autocomplete="off" value="' + (lastCard || '') + '" />' +
          '<button class="tk-mini" id="tk-save-btn" title="' + i18n('stripe.saveCard') + '">' + ICONS.plus + '</button>' +
        '</div>' +
        '<div class="tk-billing-toggle" id="tk-billing-toggle">' +
          '<span class="tk-chevron" id="tk-billing-chevron">▼</span>' + i18n('stripe.billingInfo') +
        '</div>' +
        '<div id="tk-billing-section" style="display:none">' +
          '<div class="tk-checkbox-row">' +
            '<input type="checkbox" id="tk-use-billing" checked />' +
            '<label for="tk-use-billing">' + i18n('stripe.autoFillBilling') + '</label>' +
            '<select id="tk-profile-select" class="tk-select" style="flex:1;margin-bottom:0;margin-left:auto;max-width:120px"><option value="">' + i18n('stripe.profile') + '</option>' + profileOptions + '</select>' +
          '</div>' +
          '<input id="tk-name" class="tk-input" placeholder="' + i18n('stripe.cardholderName') + '" value="' + (lastProfile ? (lastProfile.name || '') : '') + '" />' +
          '<div class="tk-row">' +
            '<input id="tk-country" class="tk-input" placeholder="' + i18n('stripe.country') + '" style="flex:0.5" value="' + (lastProfile ? (lastProfile.country || '') : '') + '" />' +
            '<input id="tk-address" class="tk-input" placeholder="' + i18n('stripe.address') + '" style="flex:1" value="' + (lastProfile ? (lastProfile.address || '') : '') + '" />' +
          '</div>' +
          '<input id="tk-postal" class="tk-input" placeholder="' + i18n('stripe.postalCode') + '" style="width:48%" value="' + (lastProfile ? (lastProfile.postal || '') : '') + '" />' +
        '</div>' +
        '<div class="tk-row" style="margin-top:12px">' +
          '<button class="tk-btn tk-accent" id="tk-fill-btn">' + ICONS.lightning + ' ' + i18n('stripe.fillCard') + '</button>' +
          '<button class="tk-btn" id="tk-detect-btn">' + ICONS.detect + ' ' + i18n('stripe.detect') + '</button>' +
        '</div>' +
        '<div id="tk-msg" class="tk-status tk-info" style="display:none"></div>' +
        '<div class="tk-hint">' + i18n('stripe.shortcuts') + '</div>';
    }

    function mount(container) {
      container.innerHTML = render();
      var $ = function (s) { return container.querySelector(s.charAt(0) === '#' ? s : '#' + s); };

      var showOk = function (msg) {
        var el = $('tk-msg'); if (el) { el.style.display = 'flex'; el.className = 'tk-status tk-ok'; el.innerHTML = '<span class="tk-status-icon">✅</span><span>' + msg + '</span>'; }
      };
      var showErr = function (msg) {
        var el = $('tk-msg'); if (el) { el.style.display = 'flex'; el.className = 'tk-status tk-err'; el.innerHTML = '<span class="tk-status-icon">❌</span><span>' + msg + '</span>'; }
      };
      var hideMsg = function () { var el = $('tk-msg'); if (el) el.style.display = 'none'; };

      $('tk-card').addEventListener('input', function () {
        var raw = this.value.trim();
        if (raw.length >= 13) {
          var num = raw.split('|')[0].replace(/\D/g, '');
          if (num.length >= 13) {
            this.classList.toggle('tk-valid', luhn(num));
            this.classList.toggle('tk-invalid', !luhn(num) && raw.indexOf('|') !== -1);
          }
        } else {
          this.classList.remove('tk-valid', 'tk-invalid');
        }
      });

      $('tk-hist').addEventListener('change', function () {
        if (this.value) { $('tk-card').value = this.value; this.value = ''; }
      });

      $('tk-save-btn').addEventListener('click', function () {
        var raw = $('tk-card').value;
        if (!raw.trim()) { showErr(window.StitchI18n.t('stripe.enterCardFirst')); return; }
        if (!parseCard(raw)) { showErr(window.StitchI18n.t('stripe.invalidFormat')); return; }
        saveCard(raw);
        showOk(window.StitchI18n.t('stripe.saved'));
        setTimeout(hideMsg, 1500);
      });

      $('tk-fill-btn').addEventListener('click', function () {
        hideMsg();
        var raw = $('tk-card').value;
        var data = parseCard(raw);
        if (!data) { showErr(window.StitchI18n.t('stripe.formatHint')); return; }

        var billing = $('tk-use-billing').checked ? {
          name: $('tk-name').value.trim(),
          country: $('tk-country').value.trim().toUpperCase(),
          address: $('tk-address').value.trim(),
          postalCode: $('tk-postal').value.trim(),
          profile: $('tk-profile-select').value,
        } : null;

        saveCard(raw);
        var btn = $('tk-fill-btn');
        btn.disabled = true;
        btn.innerHTML = '<span>⏳</span> ' + window.StitchI18n.t('status.filling');

        fillForm(data, billing).then(function (resp) {
          showOk(window.StitchI18n.t('stripe.filledFrames', { count: resp.filledFrames || '?' }));
          btn.classList.add('tk-success');
          btn.innerHTML = '<span>✅</span> ' + window.StitchI18n.t('status.done');
          setTimeout(function () {
            btn.classList.remove('tk-success');
            btn.disabled = false;
            btn.innerHTML = '<span>⚡</span> ' + window.StitchI18n.t('stripe.fillCard');
          }, 2000);
        }).catch(function (e) {
          showErr(e.message || window.StitchI18n.t('stripe.fillFailed'));
          btn.disabled = false;
          btn.innerHTML = '<span>⚡</span> ' + window.StitchI18n.t('stripe.fillCard');
        });
      });

      $('tk-detect-btn').addEventListener('click', function () {
        hideMsg();
        var btn = $('tk-detect-btn');
        btn.disabled = true;
        fillForm({ number: '4111111111111111', month: '12', year: '2030', cvc: '123' }, null).then(function (resp) {
          showOk(window.StitchI18n.t('stripe.detectedFrames', { count: resp.filledFrames || '?' }));
        }).catch(function () {
          showErr(window.StitchI18n.t('stripe.notDetected'));
        }).finally(function () { btn.disabled = false; });
      });

      $('tk-card').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('tk-fill-btn').click(); });

      var billingToggle = $('tk-billing-toggle');
      if (billingToggle) {
        billingToggle.addEventListener('click', function () {
          var section = $('tk-billing-section');
          var chevron = $('tk-billing-chevron');
          if (section) {
            var isHidden = section.style.display === 'none';
            section.style.display = isHidden ? '' : 'none';
            billingToggle.classList.toggle('tk-open', isHidden);
            if (chevron) chevron.textContent = isHidden ? '▲' : '▼';
          }
        });
      }
    }

    // NO EventBus.on here — all subscriptions happen in Subscriptions block

    return { id: 'stripe', name: 'Stripe', icon: '💳', mount: mount, quickFill: quickFill };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // RecorderTool — инструмент записи сценариев
  // ONLY define functions here, NO EventBus.on subscriptions
  // ─────────────────────────────────────────────────────────────────────
  var RecorderTool = (function () {
    var _recording = false;
    var _paused = false;
    var _listener = null;

    function formatTime(ts) {
      var d = new Date(ts);
      return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0') + ':' + d.getSeconds().toString().padStart(2, '0');
    }

    function getSelector(el) {
      if (!el || el === document || el === document.documentElement) return null;
      try {
        if (el.id) return '#' + el.id;
        if (el.className && typeof el.className === 'string') {
          var cls = el.className.trim().split(/\s+/).filter(function (c) { return !c.startsWith('tk-'); }).join('.');
          if (cls) return '.' + cls.split('.').join('.');
        }
        return el.tagName.toLowerCase() + (el.name ? '[name="' + el.name + '"]' : '');
      } catch (e) { return null; }
    }

    function startListening() {
      if (_listener) return;
      _listener = function (e) {
        if (_paused || !_recording) return;
        var step = {
          type: e.type === 'click' ? 'click' : e.type === 'input' || e.type === 'change' ? 'input' : 'nav',
          desc: '',
          selector: '',
          value: '',
          ts: Date.now(),
          url: location.href,
        };

        if (e.type === 'click') {
          step.desc = (e.target.textContent || e.target.className || 'click').trim().substring(0, 50);
          step.selector = getSelector(e.target);
        } else if (e.type === 'input' || e.type === 'change') {
          step.desc = (e.target.name || e.target.id || e.target.className || 'input').trim().substring(0, 50);
          step.selector = getSelector(e.target);
          step.value = e.target.value ? '[redacted]' : '';
        }

        var steps = StateManager.get('recordingSteps');
        steps.push(step);
        StateManager.set('recordingSteps', steps);
        EventBus.emit('steps:updated');
      };

      document.addEventListener('click', _listener, true);
      document.addEventListener('input', _listener, true);
      window.addEventListener('popstate', _listener);
    }

    function stopListening() {
      if (_listener) {
        document.removeEventListener('click', _listener, true);
        document.removeEventListener('input', _listener, true);
        window.removeEventListener('popstate', _listener);
        _listener = null;
      }
    }

    function render() {
      var i18n = window.StitchI18n.t;
      var steps = StateManager.get('recordingSteps') || [];
      var stepItems = steps.length === 0 ? '<div class="tk-hint" style="margin:0;text-align:center">' + i18n('recorder.noSteps').replace(/\n/g, '<br>') + '</div>' :
        steps.map(function (s, i) {
          var icon = s.type === 'click' ? '🖱' : s.type === 'input' ? '⌨' : s.type === 'nav' ? '🌐' : '•';
          return '<div class="tk-step" data-idx="' + i + '"><span class="tk-step-icon">' + icon + '</span><span class="tk-step-text">' + (s.desc || s.type) + '</span><span class="tk-step-time">' + formatTime(s.ts) + '</span><button class="tk-step-del" data-del="' + i + '">✕</button></div>';
        }).join('');

      return '<div class="tk-section-title">' + i18n('recorder.title') + '</div>' +
        '<div class="tk-step-list" id="tk-step-list">' + stepItems + '</div>' +
        '<div class="tk-row">' +
          '<button class="tk-btn ' + (_recording ? 'tk-danger' : 'tk-success') + '" id="tk-rec-toggle">' + (_recording ? (_paused ? i18n('recorder.resume') : i18n('recorder.pause')) : i18n('recorder.start')) + '</button>' +
          '<button class="tk-btn" id="tk-rec-clear"' + (steps.length === 0 ? ' disabled' : '') + '>' + i18n('recorder.clear') + '</button>' +
        '</div>' +
        '<div class="tk-row" style="margin-top:6px">' +
          '<button class="tk-btn" id="tk-rec-import" style="flex:1">' + i18n('recorder.import') + '</button>' +
          '<button class="tk-btn tk-accent" id="tk-rec-export"' + (steps.length === 0 ? ' disabled' : '') + ' style="flex:1">' + i18n('recorder.export') + '</button>' +
        '</div>' +
        '<div class="tk-hint">' + i18n('recorder.stepsCount', { count: steps.length }) + ' · ' + i18n('recorder.shortcuts') + '</div>';
    }

    function mount(container) {
      container.innerHTML = render();
      var $ = function (s) { return container.querySelector(s.charAt(0) === '#' ? s : '#' + s); };

      $('tk-rec-toggle').onclick = function () {
        if (!_recording) start(); else _paused ? resume() : pause();
      };
      $('tk-rec-clear').onclick = function () {
        if (!confirm(window.StitchI18n.t('recorder.confirmClear'))) return;
        StateManager.set('recordingSteps', []);
        EventBus.emit('steps:updated');
        mount(container);
        NotificationService.info(window.StitchI18n.t('recorder.cleared'));
      };
      $('tk-rec-export').onclick = function () { EventBus.emit('export:show'); };
      $('tk-rec-import').onclick = function () { importScenario(); };

      container.querySelectorAll('.tk-step-del').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var idx = parseInt(btn.dataset.del, 10);
          var steps = StateManager.get('recordingSteps');
          steps.splice(idx, 1);
          StateManager.set('recordingSteps', steps);
          EventBus.emit('steps:updated');
          mount(container);
        };
      });
    }

    function start() {
      _recording = true;
      _paused = false;
      _startTime = Date.now();
      StateManager.set('recordingSteps', []);
      StateManager.set('recorderPaused', false);
      startListening();
      EventBus.emit('recorder:state', { recording: true, paused: false });
      PanelManager.setSubtitle('Recording...');
      PanelManager.refreshCurrentTool();
    }

    function pause() {
      _paused = true;
      StateManager.set('recorderPaused', true);
      EventBus.emit('recorder:state', { recording: true, paused: true });
      PanelManager.setSubtitle('Paused');
      PanelManager.refreshCurrentTool();
    }

    function resume() {
      _paused = false;
      StateManager.set('recorderPaused', false);
      EventBus.emit('recorder:state', { recording: true, paused: false });
      PanelManager.setSubtitle('Recording...');
      PanelManager.refreshCurrentTool();
    }

    function stop() {
      _recording = false;
      _paused = false;
      stopListening();
      EventBus.emit('recorder:state', { recording: false, paused: false });
      PanelManager.setSubtitle('Scenario Recorder');
      PanelManager.refreshCurrentTool();
    }

    function toggle() {
      if (!_recording) start(); else _paused ? resume() : pause();
    }

    function importScenario() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            if (Array.isArray(data)) {
              StateManager.set('recordingSteps', data);
              EventBus.emit('steps:updated');
              PanelManager.refreshCurrentTool();
              NotificationService.success(window.StitchI18n.t('recorder.imported', { count: data.length }));
            }
          } catch (e) { NotificationService.error(window.StitchI18n.t('recorder.invalidJson')); }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    function showExportModal(steps) {
      var i18n = window.StitchI18n.t;
      var modal = document.createElement('div');
      modal.className = 'tk-modal-overlay tk-visible';
      modal.innerHTML =
        '<div class="tk-modal">' +
          '<div class="tk-modal-title">' + i18n('export.title') + '</div>' +
          '<div class="tk-modal-format">' +
            '<button class="tk-modal-format-btn" data-fmt="json"><span class="tk-format-icon">📄</span> ' + i18n('export.json') + '</button>' +
            '<button class="tk-modal-format-btn" data-fmt="playwright"><span class="tk-format-icon">🎭</span> ' + i18n('export.playwright') + '</button>' +
            '<button class="tk-modal-format-btn" data-fmt="puppeteer"><span class="tk-format-icon">🎪</span> ' + i18n('export.puppeteer') + '</button>' +
            '<button class="tk-modal-format-btn" data-fmt="curl"><span class="tk-format-icon">🌐</span> ' + i18n('export.curl') + '</button>' +
          '</div>' +
          '<button class="tk-modal-close" id="tk-modal-close">' + i18n('export.cancel') + '</button>' +
        '</div>';

      var shadowEl = document.getElementById('tk-shadow-host');
      if (shadowEl && shadowEl.shadowRoot) shadowEl.shadowRoot.appendChild(modal);
      else document.documentElement.appendChild(modal);

      modal.querySelector('#tk-modal-close').onclick = function () { modal.remove(); };
      modal.onclick = function (e) { if (e.target === modal) modal.remove(); };

      modal.querySelectorAll('[data-fmt]').forEach(function (btn) {
        btn.onclick = function () {
          var fmt = btn.dataset.fmt;
          var content = exportAs(steps, fmt);
          downloadText(content, 'scenario.' + (fmt === 'json' ? 'json' : 'js'), fmt === 'json' ? 'application/json' : 'text/plain');
          modal.remove();
          NotificationService.success(window.StitchI18n.t('recorder.exported', { format: fmt.toUpperCase() }));
        };
      });
    }

    function exportAs(steps, fmt) {
      switch (fmt) {
        case 'json': return JSON.stringify(steps, null, 2);
        case 'playwright': return generatePlaywright(steps);
        case 'puppeteer': return generatePuppeteer(steps);
        case 'curl': return generateCurl(steps);
        default: return JSON.stringify(steps, null, 2);
      }
    }

    function generatePlaywright(steps) {
      var lines = ['// Generated by Stitch Toolkit', "const { chromium } = require('playwright');", '', 'async function runScenario() {', '  const browser = await chromium.launch();', '  const page = await browser.newPage();', ''];
      steps.forEach(function (s, i) {
        if (s.type === 'nav') lines.push('  // Step ' + (i + 1) + ': Navigate');
        else if (s.type === 'click') lines.push("  await page.click('" + (s.selector || '#element') + "'); // " + s.desc);
        else if (s.type === 'input') lines.push("  await page.fill('" + (s.selector || '#element') + "', '" + s.value + "'); // " + s.desc);
      });
      lines.push('', '  await browser.close();', '}', '', 'runScenario();');
      return lines.join('\n');
    }

    function generatePuppeteer(steps) {
      var lines = ['// Generated by Stitch Toolkit', "const puppeteer = require('puppeteer');", '', '(async () => {', '  const browser = await puppeteer.launch();', '  const page = await browser.newPage();', ''];
      steps.forEach(function (s, i) {
        if (s.type === 'nav') lines.push('  // Step ' + (i + 1) + ': Navigate');
        else if (s.type === 'click') lines.push("  await page.click('" + (s.selector || '#element') + "'); // " + s.desc);
        else if (s.type === 'input') lines.push("  await page.type('" + (s.selector || '#element') + "', '" + s.value + "'); // " + s.desc);
      });
      lines.push('', '  await browser.close();', '})();');
      return lines.join('\n');
    }

    function generateCurl(steps) {
      var navSteps = steps.filter(function (s) { return s.type === 'nav' && s.url; });
      if (navSteps.length === 0) return '// No navigation steps found for cURL export';
      var lines = ['# Generated by Stitch Toolkit — cURL commands', '# Copy commands and run in terminal', ''];
      navSteps.forEach(function (s, i) {
        lines.push('# Step ' + (i + 1) + ': ' + s.desc);
        lines.push('curl "' + s.url + '" \\');
        lines.push('  -H "User-Agent: Mozilla/5.0" \\');
        lines.push('  -H "Accept: text/html"');
        lines.push('');
      });
      return lines.join('\n');
    }

    function downloadText(content, filename, mimeType) {
      var blob = new Blob([content], { type: mimeType });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    // NO EventBus.on here — all subscriptions happen in Subscriptions block

    return {
      id: 'recorder', name: 'Recorder', icon: '⏺',
      mount: mount, start: start, stop: stop, toggle: toggle,
      pause: pause, resume: resume, clear: function () {
        if (!confirm('Clear all recorded steps?')) return;
        StateManager.set('recordingSteps', []);
        EventBus.emit('steps:updated');
        PanelManager.refreshCurrentTool();
      },
      importScenario: importScenario, showExportModal: showExportModal,
    };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // SettingsTool — настройки
  // ONLY define functions here, NO EventBus.on subscriptions
  // ─────────────────────────────────────────────────────────────────────
  var SettingsTool = (function () {
    function render() {
      var i18n = window.StitchI18n.t;
      var s = StateManager.getAll();
      var profiles = s.billingProfiles || [];
      var themeLabels = { auto: i18n('settings.themeAuto'), dark: i18n('settings.themeDark'), light: i18n('settings.themeLight') };

      var profileItems = profiles.map(function (p, i) {
        return '<div class="tk-profile-item" data-idx="' + i + '">' +
          '<span style="font-size:14px">👤</span>' +
          '<div style="flex:1"><div class="tk-profile-name">' + (p.name || 'Profile ' + (i + 1)) + '</div>' +
          '<div class="tk-profile-detail">' + (p.country || '') + ' · ' + (p.address || '') + ' · ' + (p.postal || '') + '</div></div>' +
          '<button class="tk-step-del" data-del="' + i + '" style="opacity:1">✕</button></div>';
      }).join('');

      var toggleOn = function (key) { return s[key] ? ' tk-on' : ''; };

      var localeNames = window.StitchI18n.getLocaleNames();
      var currentLocale = window.StitchI18n.getLocale();
      var localeOptions = Object.keys(localeNames).map(function (loc) {
        return '<option value="' + loc + '"' + (currentLocale === loc ? ' selected' : '') + '>' + localeNames[loc] + '</option>';
      }).join('');

      return '<div class="tk-section-title">' + i18n('settings.general') + '</div>' +
        '<div class="tk-settings-group">' +
          '<div class="tk-settings-row"><div><div class="tk-settings-name">' + i18n('settings.language') + '</div><div class="tk-settings-desc">' + i18n('settings.languageDesc') + '</div></div>' +
            '<select id="tk-set-locale" class="tk-select" style="width:120px;margin-bottom:0">' + localeOptions + '</select></div>' +
          '<div class="tk-settings-row"><div><div class="tk-settings-name">' + i18n('settings.autoDetectStripe') + '</div><div class="tk-settings-desc">' + i18n('settings.autoDetectStripeDesc') + '</div></div><button class="tk-toggle' + toggleOn('autoDetect') + '" id="tk-set-autodetect"></button></div>' +
          '<div class="tk-settings-row"><div><div class="tk-settings-name">' + i18n('settings.autoExpand') + '</div><div class="tk-settings-desc">' + i18n('settings.autoExpandDesc') + '</div></div><button class="tk-toggle' + toggleOn('autoExpand') + '" id="tk-set-autoexpand"></button></div>' +
          '<div class="tk-settings-row"><div><div class="tk-settings-name">' + i18n('settings.clipboardWatch') + '</div><div class="tk-settings-desc">' + i18n('settings.clipboardWatchDesc') + '</div></div><button class="tk-toggle' + toggleOn('clipboardWatch') + '" id="tk-set-clipboard"></button></div>' +
          '<div class="tk-settings-row"><div><div class="tk-settings-name">' + i18n('settings.soundEffects') + '</div><div class="tk-settings-desc">' + i18n('settings.soundEffectsDesc') + '</div></div><button class="tk-toggle' + toggleOn('soundEffects') + '" id="tk-set-sound"></button></div>' +
        '</div>' +
        '<div class="tk-section-title">' + i18n('settings.appearance') + '</div>' +
        '<div class="tk-settings-group">' +
          '<div class="tk-settings-row"><div><div class="tk-settings-name">' + i18n('settings.theme') + '</div><div class="tk-settings-desc">' + i18n('settings.themeAuto') + ': ' + themeLabels[s.theme] + '</div></div>' +
            '<select id="tk-set-theme" class="tk-select" style="width:120px;margin-bottom:0">' +
              '<option value="auto"' + (s.theme === 'auto' ? ' selected' : '') + '>' + i18n('settings.themeAuto') + '</option>' +
              '<option value="dark"' + (s.theme === 'dark' ? ' selected' : '') + '>' + i18n('settings.themeDark') + '</option>' +
              '<option value="light"' + (s.theme === 'light' ? ' selected' : '') + '>' + i18n('settings.themeLight') + '</option>' +
            '</select></div>' +
        '</div>' +
        '<div class="tk-section-title">' + i18n('settings.billingProfiles') + '</div>' +
        '<div class="tk-billing-profiles" id="tk-billing-profiles">' + profileItems + '<button class="tk-btn" id="tk-add-profile" style="margin-top:4px">' + i18n('settings.addProfile') + '</button></div>' +
        '<div class="tk-section-title">' + i18n('settings.data') + '</div>' +
        '<div class="tk-row">' +
          '<button class="tk-btn" id="tk-export-all" style="flex:1">' + i18n('settings.exportAll') + '</button>' +
          '<button class="tk-btn tk-danger" id="tk-clear-all" style="flex:1">' + i18n('settings.clearAll') + '</button>' +
        '</div>' +
        '<div class="tk-hint">' + i18n('app.version', { version: '0.5.2' }) + '</div>';
    }

    function mount(container) {
      container.innerHTML = render();
      var $ = function (s) { return container.querySelector(s.charAt(0) === '#' ? s : '#' + s); };

      container.querySelector('#tk-set-autodetect') && container.querySelector('#tk-set-autodetect').addEventListener('click', function () { toggleSetting('autoDetect', this); });
      container.querySelector('#tk-set-autoexpand') && container.querySelector('#tk-set-autoexpand').addEventListener('click', function () { toggleSetting('autoExpand', this); });
      container.querySelector('#tk-set-clipboard') && container.querySelector('#tk-set-clipboard').addEventListener('click', function () { toggleSetting('clipboardWatch', this); });
      container.querySelector('#tk-set-sound') && container.querySelector('#tk-set-sound').addEventListener('click', function () { toggleSetting('soundEffects', this); });

      container.querySelector('#tk-set-locale') && container.querySelector('#tk-set-locale').addEventListener('change', function () {
        window.StitchI18n.setLocale(this.value);
        // Refresh current tool to apply new locale
        PanelManager.refreshCurrentTool();
        NotificationService.info('Language changed to ' + window.StitchI18n.getLocaleNames()[this.value]);
      });

      container.querySelector('#tk-set-theme') && container.querySelector('#tk-set-theme').addEventListener('change', function () {
        StateManager.set('theme', this.value);
        document.documentElement.classList.remove('tk-light', 'tk-dark');
        if (this.value === 'light') document.documentElement.classList.add('tk-light');
        else if (this.value === 'dark') document.documentElement.classList.add('tk-dark');
      });

      container.querySelector('#tk-add-profile') && container.querySelector('#tk-add-profile').addEventListener('click', function () { addBillingProfile(container); });
      container.querySelector('#tk-export-all') && container.querySelector('#tk-export-all').addEventListener('click', function () { exportAll(container); });
      container.querySelector('#tk-clear-all') && container.querySelector('#tk-clear-all').addEventListener('click', function () { clearAll(container); });

      container.querySelectorAll('.tk-step-del').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var idx = parseInt(btn.dataset.del, 10);
          var profiles = StateManager.get('billingProfiles');
          profiles.splice(idx, 1);
          StateManager.set('billingProfiles', profiles);
          mount(container);
        };
      });
    }

    function toggleSetting(key, btn) {
      var val = !StateManager.get(key);
      StateManager.set(key, val);
      btn.classList.toggle('tk-on', val);
    }

    function addBillingProfile(container) {
      var i18n = window.StitchI18n.t;
      var name = prompt(i18n('settings.profileName'));
      if (!name) return;
      var country = prompt(i18n('settings.countryCode')) || '';
      var address = prompt(i18n('settings.address')) || '';
      var postal = prompt(i18n('settings.postalCode')) || '';

      var profiles = StateManager.get('billingProfiles') || [];
      profiles.unshift({ name: name, country: country, address: address, postal: postal });
      StateManager.set('billingProfiles', profiles);
      mount(container);
      NotificationService.success(i18n('settings.profileSaved'));
    }

    function exportAll(container) {
      var data = {
        version: '0.5.1',
        exported: new Date().toISOString(),
        cardHistory: StateManager.get('cardHistory'),
        billingProfiles: StateManager.get('billingProfiles'),
        settings: {
          theme: StateManager.get('theme'),
          autoDetect: StateManager.get('autoDetect'),
          autoExpand: StateManager.get('autoExpand'),
          clipboardWatch: StateManager.get('clipboardWatch'),
          soundEffects: StateManager.get('soundEffects'),
        },
      };
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'stitch-toolkit-config.json';
      a.click();
      URL.revokeObjectURL(url);
      NotificationService.success(window.StitchI18n.t('settings.configExported'));
    }

    function clearAll(container) {
      if (!confirm(window.StitchI18n.t('settings.confirmClearAll'))) return;
      Object.keys(StateManager.getAll()).forEach(function (k) {
        StateManager.save(k, k === 'theme' ? 'auto' : (Array.isArray(StateManager.getAll()[k]) ? [] : null));
      });
      NotificationService.info(window.StitchI18n.t('settings.allDataCleared'));
      mount(container);
    }

    return { id: 'settings', name: 'Settings', icon: '⚡', mount: mount };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // ClipboardWatcher — NO side effects here
  // ─────────────────────────────────────────────────────────────────────
  var ClipboardWatcher = (function () {
    var lastClipboard = '';
    var intervalId = null;

    function isCardNumber(text) {
      if (!text) return false;
      var stripped = text.replace(/\D/g, '');
      return stripped.length >= 13 && stripped.length <= 19 && /^\d{13,19}$/.test(stripped);
    }

    function parseCardFromText(text) {
      if (!text) return null;
      var parts = text.split('|');
      if (parts.length >= 4) return parts.map(function (p) { return p.trim(); }).join('|');
      var match = text.match(/(\d{13,19})\D+(\d{1,2})\D+(\d{2,4})\D+(\d{3,4})/);
      if (match) return [match[1], match[2], match[3], match[4]].join('|');
      if (isCardNumber(text)) return text;
      return null;
    }

    function check() {
      if (!StateManager.get('clipboardWatch')) return;
      try {
        navigator.clipboard.readText().then(function (text) {
          if (text && text !== lastClipboard && parseCardFromText(text)) {
            lastClipboard = text;
            EventBus.emit('clipboard:card', text);
          }
        }).catch(function () {});
      } catch (e) {}
    }

    function init() {
      if (!StateManager.get('clipboardWatch')) return;
      setTimeout(check, 3000);
      intervalId = setInterval(check, 5000);
    }

    return { init: init };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // AutoDetector — NO side effects here
  // ─────────────────────────────────────────────────────────────────────
  var AutoDetector = (function () {
    function hasStripeFields() {
      var selectors = [
        'input#cardNumber', 'input#cardExpiry', 'input#cardCvc',
        'input[name="cardnumber"]', 'input[autocomplete="cc-number"]',
        'input[name="cardExpiry"]', 'input[autocomplete="cc-exp"]',
        'iframe[src*="js.stripe.com"]', 'iframe[src*="stripe.com"]',
        '[class*="StripeElement"]', '[class*="stripe"]',
      ];
      for (var i = 0; i < selectors.length; i++) {
        try { if (document.querySelector(selectors[i])) return true; } catch (e) {}
      }
      try {
        var iframes = document.querySelectorAll('iframe');
        for (var j = 0; j < iframes.length; j++) {
          var src = iframes[j].src;
          if (src && (src.indexOf('stripe') !== -1 || src.indexOf('js.stripe') !== -1)) return true;
        }
      } catch (e) {}
      return false;
    }

    function run() {
      if (!StateManager.get('autoDetect')) return;
      var isStripe = hasStripeFields();
      if (isStripe && StateManager.get('activeTab') !== 'stripe') {
        ToolRegistry.activate('stripe');
        EventBus.emit('stripe:detected');
      }
    }

    function init() {
      if (!StateManager.get('autoDetect')) return;
      setTimeout(run, 1500);
      var origPush = history.pushState;
      var origReplace = history.replaceState;
      history.pushState = function () { var r = origPush.apply(this, arguments); setTimeout(run, 800); return r; };
      history.replaceState = function () { var r = origReplace.apply(this, arguments); setTimeout(run, 800); return r; };
      window.addEventListener('popstate', function () { setTimeout(run, 800); });
    }

    return { init: init, run: run };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // PasteInterceptor — auto-fill on Ctrl+V for Stripe checkout pages
  // Parses checker formats: 5154620021124134|12|2031|982 or with flags
  // ─────────────────────────────────────────────────────────────────────
  const PasteInterceptor = (function () {
    var _enabled = true;
    var _countryMap = {
      '\ud83c\uddfa\ud83c\uddf8': 'US', '\ud83c\udde6\ud83c\uddfa': 'AU', '\ud83c\udde7\ud83c\udded': 'CH',
      '\ud83c\udde8\ud83c\udde6': 'CA', '\ud83c\udde9\ud83c\uddea': 'DE', '\ud83c\uddec\ud83c\udde7': 'GB',
      '\ud83c\uddee\ud83c\uddf9': 'IT', '\ud83c\uddf3\ud83c\uddf1': 'NL', '\ud83c\uddf5\ud83c\uddf1': 'PL',
      '\ud83c\uddf7\ud83c\uddfa': 'RU', '\ud83c\uddf8\ud83c\udde6': 'SE', '\ud83c\uddf9\ud83c\udded': 'TH',
      '\ud83c\uddf0\ud83c\uddf7': 'KR', '\ud83c\udde6\ud83c\uddf1': 'AL', '\ud83c\udde6\ud83c\uddf7': 'AR',
      '\ud83c\udde9\ud83c\uddf0': 'DK', '\ud83c\uddea\ud83c\uddf8': 'ES', '\ud83c\uddeb\ud83c\uddf7': 'FR',
      '\ud83c\uddec\ud83c\uddf1': 'GL', '\ud83c\udded\ud83c\uddf9': 'HU', '\ud83c\uddee\ud83c\uddf4': 'IO',
      '\ud83c\uddef\ud83c\uddf5': 'JP', '\ud83c\uddf1\ud83c\uddfb': 'LV', '\ud83c\uddf2\ud83c\uddf4': 'MO',
      '\ud83c\uddf2\ud83c\uddfd': 'MX', '\ud83c\uddf3\ud83c\uddec': 'NG', '\ud83c\uddf5\ud83c\uddf9': 'PT',
      '\ud83c\uddf7\ud83c\uddf4': 'RO', '\ud83c\uddf9\ud83c\uddfc': 'TW', '\ud83c\uddfa\ud83c\uddf8': 'US',
      '\ud83c\uddfb\ud83c\udde6': 'VE', '\ud83c\uddf8\ud83c\uddff': 'ZA', '\ud83c\uddf9\ud83c\uddf3': 'TR',
      '\ud83c\uddf8\ud83c\uddea': 'SG', '\ud83c\udde8\ud83c\uddff': 'CZ', '\ud83c\uddee\ud83c\uddf3': 'IN',
      '\ud83c\uddf3\ud83c\uddfe': 'UA', '\ud83c\uddf2\ud83c\udde9': 'ID', '\ud83c\uddf0\ud83c\uddff': 'KZ',
    };

    function isStripeCheckout() {
      return location.hostname.includes('checkout.stripe.com') ||
        location.hostname.includes('pay.stripe.com') ||
        document.querySelector('iframe[src*="stripe"], iframe[src*="js.stripe.com"]') !== null;
    }

    function parseCheckerOutput(text) {
      var t = String(text || '').trim();
      if (!t) return null;

      // Remove common prefixes/suffixes
      t = t.replace(/^Live\s*\|?\s*/i, '').replace(/\|?\s*Charge\s+OK\.?\s*\[.*?\]\s*$/i, '');
      t = t.replace(/\[BIN:\s*.*?\]\s*\|?/gi, '');
      t = t.replace(/^\|?\s*|\s*\|?$/g, '');

      var parts = t.split('|');
      if (parts.length >= 4) {
        var number = parts[0].trim().replace(/\D/g, '');
        var month = parts[1].trim().replace(/\D/g, '').padStart(2, '0');
        var year = parts[2].trim().replace(/\D/g, '');
        var cvc = parts[3].trim().replace(/\D/g, '');

        // Validate
        if (number.length < 13 || number.length > 19) return null;
        if (month.length > 2) return null;
        if (year.length !== 2 && year.length !== 4) return null;
        if (cvc.length < 3 || cvc.length > 4) return null;

        // Extract country from emoji flag
        var country = null;
        for (var flag in _countryMap) {
          if (text.indexOf(flag) !== -1) { country = _countryMap[flag]; break; }
        }

        return { number: number, month: month, year: year.length === 2 ? '20' + year : year, cvc: cvc, country: country || 'US' };
      }

      // Fallback regex for space/comma separated
      var m = t.match(/(\d{13,19})\D+(\d{1,2})\D+(\d{2,4})\D+(\d{3,4})/);
      if (m) {
        var y = m[3];
        return { number: m[1], month: m[2].padStart(2, '0'), year: y.length === 2 ? '20' + y : y, cvc: m[4], country: 'US' };
      }

      return null;
    }

    function autoFill(data) {
      if (!data) return;
      var cardData = {
        number: data.number,
        month: data.month,
        year: data.year,
        cvc: data.cvc,
        name: 'John Doe',
        country: data.country || 'US',
        address: '123 Main St',
        city: 'New York',
        state: 'NY',
        postalCode: '10001',
      };

      chrome.runtime.sendMessage({
        type: 'tk:stripe-fill',
        payload: { cardData: cardData, billing: true }
      }).then(function (resp) {
        if (resp && resp.ok) {
          NotificationService.success('Card auto-filled from clipboard (' + (resp.filledFrames || '?') + ' frame(s))');
        }
      }).catch(function (e) {
        console.warn('[TK PasteInterceptor] Fill failed:', e);
      });
    }

    function onPaste(e) {
      if (!_enabled || !isStripeCheckout()) return;
      var clipboard = e.clipboardData || window.clipboardData;
      if (!clipboard) return;

      var text = clipboard.getData('text');
      if (!text || text.indexOf('|') === -1) return;

      var data = parseCheckerOutput(text);
      if (!data) return;

      e.preventDefault();
      e.stopPropagation();

      autoFill(data);

      // Also save as last card
      StateManager.set('lastCard', data.number + '|' + data.month + '|' + data.year + '|' + data.cvc);
    }

    function init() {
      document.addEventListener('paste', onPaste, true);
    }

    function setEnabled(v) { _enabled = Boolean(v); }

    return { init: init, setEnabled: setEnabled };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // Subscriptions — ALL EventBus.on happen HERE, after all modules defined
  // This prevents TDZ (Temporal Dead Zone) issues
  // ─────────────────────────────────────────────────────────────────────

  // PanelManager subscriptions
  EventBus.on('tool:activated', function (tool) {
    PanelManager.updateTabUI(tool.id);
    if (tool && tool.mount) {
      var tc = PanelManager.getToolContainer();
      if (tc) tool.mount(tc);
    }
  });

  EventBus.on('stripe:detected', function () {
    if (StateManager.get('autoExpand')) PanelManager.expandPanel();
    PanelManager.pulseFloatBtn();
  });

  EventBus.on('recorder:state', function (data) {
    PanelManager.setRecordingUI(data.recording, data.paused);
  });

  EventBus.on('steps:updated', function () {
    PanelManager.updateStepsBadge();
  });

  // Shortcuts
  EventBus.on('shortcut:toggle', function () { PanelManager.togglePanel(); });
  EventBus.on('shortcut:quick-fill', function () { StripeFillerTool.quickFill(); });
  EventBus.on('shortcut:export', function () { EventBus.emit('export:show'); });

  // StripeFillerTool subscriptions
  EventBus.on('fill:quick', function (raw) {
    var lastCard = StateManager.get('lastCard');
    if (!lastCard) { NotificationService.warn('No last card'); return; }
    var data = parseCard(lastCard);
    if (!data) { NotificationService.error('Invalid last card'); return; }
    PanelManager.setSubtitle('Filling last card...');
    fillForm(data, null).then(function (resp) {
      NotificationService.success('Filled last card (' + (resp.filledFrames || '?') + ' frame(s))');
      PanelManager.setSubtitle('Card Filler');
    }).catch(function (e) {
      NotificationService.error('Fill failed: ' + (e.message || ''));
      PanelManager.setSubtitle('Card Filler');
    });

    function parseCard(raw) {
      var t = String(raw || '').trim();
      if (!t) return null;
      var p = t.split('|');
      if (p.length >= 4) return { number: p[0].trim(), month: p[1].trim(), year: p[2].trim(), cvc: p[3].trim() };
      var m = t.match(/(\d{13,19})\D+(\d{1,2})\D+(\d{2,4})\D+(\d{3,4})/);
      if (m) return { number: m[1], month: m[2], year: m[3], cvc: m[4] };
      return null;
    }

    function fillForm(data, billing) {
      return chrome.runtime.sendMessage({ type: 'tk:stripe-fill', payload: { cardData: data, billing: billing } })
        .then(function (resp) {
          if (resp && resp.ok) return resp;
          throw new Error(resp && resp.error ? resp.error : 'No Stripe fields found');
        });
    }
  });

  // RecorderTool subscriptions
  EventBus.on('export:show', function () {
    var steps = StateManager.get('recordingSteps');
    if (!steps || steps.length === 0) { NotificationService.warn(window.StitchI18n.t('recorder.noStepsToExport')); return; }
    RecorderTool.showExportModal(steps);
  });

  EventBus.on('shortcut:recorder-toggle', function () { RecorderTool.toggle(); });

  // Clipboard watcher
  EventBus.on('clipboard:card', function (raw) {
    var i18n = window.StitchI18n.t;
    NotificationService.showToast('🃏 ' + i18n('notif.cardDetected') + ' — ' + raw.replace(/\d(?=\d{4})/g, '*'), 'info', {
      action: i18n('notif.fillNow'),
      actionFn: function () { StripeFillerTool.quickFill(); },
      duration: 6000,
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Bootstrap — инициализация приложения
  // ─────────────────────────────────────────────────────────────────────
  function bootstrap() {
    ToolRegistry.register(StripeFillerTool);
    ToolRegistry.register(RecorderTool);
    ToolRegistry.register(SettingsTool);

    PanelManager.createUI();
    ShortcutManager.init();
    AutoDetector.init();
    ClipboardWatcher.init();
    PasteInterceptor.init();

    // Mount initial tool
    var activeTab = StateManager.get('activeTab');
    var activeTool = ToolRegistry.get(activeTab);
    var tc2 = PanelManager.getToolContainer();
    if (activeTool && activeTool.mount && tc2) {
      activeTool.mount(tc2);
    }

    console.log('[Stitch Toolkit] v0.6.0 initialized (' + window.StitchI18n.getLocale() + ')');
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();