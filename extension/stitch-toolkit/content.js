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
      activeTab: 'recorder',
      theme: 'auto',
      soundEffects: false,
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
        var map = { 'Ctrl+Shift+S': 'toggle', 'Cmd+Shift+S': 'toggle', 'Ctrl+Shift+R': 'recorder-toggle', 'Cmd+Shift+R': 'recorder-toggle', 'Ctrl+Shift+E': 'export', 'Cmd+Shift+E': 'export' };
        var action = map[key];
        if (action) { e.preventDefault(); e.stopPropagation(); EventBus.emit('shortcut:' + action, e); }
      }, true);
    }
    return { init: init };
  })();

  // ── SVG Icons (Phosphor-style, inline) ───────────────────────────────
  var ICONS = {
    logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
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
        floatBtn.style.left = Math.max(10, Math.min(posX, window.innerWidth - 54)) + 'px';
        floatBtn.style.top = Math.max(10, Math.min(posY, window.innerHeight - 54)) + 'px';
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
          '<button class="tk-tab tk-active" data-id="recorder"><span class="tk-tab-icon">' + ICONS.recorder + '</span><span>' + window.StitchI18n.t('tab.recorder') + '</span><span class="tk-steps-badge" id="tk-rec-badge" style="display:none">0</span></button>' +
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

      window.addEventListener('resize', function () {
        // Clamp float button inside viewport
        var r = floatBtn.getBoundingClientRect();
        var x = parseFloat(floatBtn.style.left) || r.left;
        var y = parseFloat(floatBtn.style.top) || r.top;
        if (x + r.width > window.innerWidth - 10) {
          floatBtn.style.left = Math.max(10, window.innerWidth - r.width - 10) + 'px';
          floatBtn.style.right = 'auto';
        }
        if (y + r.height > window.innerHeight - 10) {
          floatBtn.style.top = Math.max(10, window.innerHeight - r.height - 10) + 'px';
          floatBtn.style.bottom = 'auto';
        }
        // Clamp panel inside viewport
        if (panel.classList.contains('tk-open')) {
          var pr = panel.getBoundingClientRect();
          var px = parseFloat(panel.style.left) || pr.left;
          var py = parseFloat(panel.style.top) || pr.top;
          if (px + pr.width > window.innerWidth - 10) {
            panel.style.left = Math.max(10, window.innerWidth - pr.width - 10) + 'px';
            panel.style.right = 'auto';
          }
          if (py + pr.height > window.innerHeight - 10) {
            panel.style.top = Math.max(10, window.innerHeight - pr.height - 10) + 'px';
            panel.style.bottom = 'auto';
          }
        }
      });
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
      if (expanded) {
        positionPanel();
        EventBus.emit('panel:opened');
      } else {
        // Cleanup recorder when panel closes
        if (window.RecorderTool && window.RecorderTool.cleanup) window.RecorderTool.cleanup();
        EventBus.emit('panel:closed');
      }
    }

    function updateTabUI(activeId) {
      panel.querySelectorAll('.tk-tab').forEach(function (t) { t.classList.toggle('tk-active', t.dataset.id === activeId); });
      var title = panel.querySelector('.tk-panel-subtitle');
      var titles = { recorder: window.StitchI18n.t('recorder.title'), settings: window.StitchI18n.t('tab.settings') };
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

    var _liveStepCount = 0;

    // mode: 'record' | 'replay' | falsy (idle)
    function setRecordingUI(mode, paused) {
      var recording = mode === 'record';
      var replaying = mode === 'replay';
      floatBtn.classList.toggle('tk-recording', recording && !paused);
      floatBtn.classList.toggle('tk-replaying', replaying);
      if (!recording && !replaying) setLiveStepCount(0);
    }

    function setLiveStepCount(count) {
      _liveStepCount = Math.max(0, Number(count) || 0);
      updateStepsBadge();
    }

    function updateStepsBadge() {
      floatBtn.querySelectorAll('.tk-steps-dot').forEach(function (b) { b.remove(); });
      if (_liveStepCount > 0) {
        var badge = document.createElement('div');
        badge.className = 'tk-steps-dot';
        badge.textContent = _liveStepCount > 99 ? '99+' : _liveStepCount;
        floatBtn.appendChild(badge);
      }
    }

    function applyTheme() {
      var theme = StateManager.get('theme');
      var shadowHost = document.getElementById('tk-shadow-host');
      if (shadowHost) {
        shadowHost.classList.remove('tk-light', 'tk-dark');
        if (theme === 'light') shadowHost.classList.add('tk-light');
        else if (theme === 'dark') shadowHost.classList.add('tk-dark');
      }
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
        '<div class="tk-ctx-item" id="tk-ctx-rec"><span class="tk-ctx-icon">⏺</span> ' + i18n('ctx.toggleRecorder') + ' <span class="tk-ctx-shortcut">⌘⇧R</span></div>' +
        '<div class="tk-ctx-item" id="tk-ctx-export"><span class="tk-ctx-icon">📤</span> ' + i18n('ctx.exportScenario') + ' <span class="tk-ctx-shortcut">⌘⇧E</span></div>' +
        '<div class="tk-ctx-sep"></div>' +
        '<div class="tk-ctx-item" id="tk-ctx-recorder"><span class="tk-ctx-icon">⏺</span> ' + i18n('ctx.recorder') + '</div>' +
        '<div class="tk-ctx-sep"></div>' +
        '<div class="tk-ctx-item" id="tk-ctx-expand"><span class="tk-ctx-icon">⬆</span> ' + (StateManager.get('expanded') ? i18n('ctx.collapse') : i18n('ctx.expand')) + '</div>';
      shadow.appendChild(menu);

      menu.querySelector('#tk-ctx-rec').onclick = function () { EventBus.emit('shortcut:recorder-toggle'); hideContextMenu(); };
      menu.querySelector('#tk-ctx-export').onclick = function () { EventBus.emit('shortcut:export'); hideContextMenu(); };
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
        tc.innerHTML = '';
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
      setLiveStepCount: setLiveStepCount,
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
  // Export core utilities to window for external tool files
  // ─────────────────────────────────────────────────────────────────────
  window.EventBus = EventBus;
  window.StateManager = StateManager;
  window.NotificationService = NotificationService;
  window.PanelManager = PanelManager;
  window.ToolRegistry = ToolRegistry;

  // ─────────────────────────────────────────────────────────────────────
  // External tools: loaded from panel/tools/*.js (listed in manifest after content.js)
  // Accessed via window namespace at runtime — do NOT capture in var at IIFE time
  // ─────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────
  // Subscriptions — ALL EventBus.on happen HERE, after all modules defined
  // This prevents TDZ (Temporal Dead Zone) issues
  // ─────────────────────────────────────────────────────────────────────

  // PanelManager subscriptions
  EventBus.on('tool:activated', function (tool) {
    PanelManager.updateTabUI(tool.id);
    if (tool && tool.mount) {
      var tc = PanelManager.getToolContainer();
      if (tc) { tc.innerHTML = ''; tool.mount(tc); }
    }
  });

  EventBus.on('recorder:state', function (data) {
    PanelManager.setRecordingUI(data.mode || (data.recording ? 'record' : null), data.paused);
  });

  EventBus.on('steps:updated', function () {
    PanelManager.updateStepsBadge();
  });

  // Shortcuts
  EventBus.on('shortcut:toggle', function () { PanelManager.togglePanel(); });
  EventBus.on('shortcut:export', function () { EventBus.emit('export:show'); });

  // RecorderTool subscriptions — steps live in the background session now
  EventBus.on('export:show', function () {
    try {
      chrome.runtime.sendMessage({ type: 'tk:recorder-steps' }).then(function (resp) {
        var steps = resp && resp.ok ? resp.steps : [];
        if (!steps || steps.length === 0) { NotificationService.warn(window.StitchI18n.t('recorder.noStepsToExport')); return; }
        if (window.RecorderTool) window.RecorderTool.showExportModal(steps);
      }).catch(function () { NotificationService.warn(window.StitchI18n.t('recorder.noStepsToExport')); });
    } catch (e) { NotificationService.warn(window.StitchI18n.t('recorder.noStepsToExport')); }
  });

  EventBus.on('shortcut:recorder-toggle', function () { if (window.RecorderTool) window.RecorderTool.toggle(); });

  // ─────────────────────────────────────────────────────────────────────
  // RecorderBridge — sync panel UI with background recording sessions
  // (bridge-driven sessions from the Stitch app included). NO side effects
  // until init() is called.
  // ─────────────────────────────────────────────────────────────────────
  var RecorderBridge = (function () {
    var _initialized = false;

    function applyStatus(resp) {
      if (!resp || !resp.ok) return;
      PanelManager.setRecordingUI(resp.mode || null, Boolean(resp.paused));
      if (resp.mode === 'record') PanelManager.setLiveStepCount(resp.stepCount || 0);
    }

    function init() {
      if (_initialized) return;
      _initialized = true;

      try {
        chrome.runtime.onMessage.addListener(function (message) {
          var type = message && message.type;
          if (type === 'tk:recorder-progress') {
            var payload = message.payload || {};
            PanelManager.setRecordingUI('record', Boolean(payload.paused));
            PanelManager.setLiveStepCount(payload.stepCount || 0);
            EventBus.emit('recorder:progress', payload);
          }
        });
      } catch (e) {
        console.warn('[TK RecorderBridge] onMessage unavailable:', e && e.message);
      }

      // Initial sync — covers sessions started before this page loaded.
      try {
        chrome.runtime.sendMessage({ type: 'tk:recorder-status' })
          .then(applyStatus)
          .catch(function () {});
      } catch (e) {}
    }

    return { init: init };
  })();

  // ─────────────────────────────────────────────────────────────────────
  // Bootstrap — инициализация приложения
  // ─────────────────────────────────────────────────────────────────────
  function bootstrap() {
    // Register tools — warn if external file failed to load
    var tools = [
      { ref: window.RecorderTool, name: 'RecorderTool', file: 'panel/tools/recorder-tool.js' },
      { ref: window.SettingsTool, name: 'SettingsTool', file: 'panel/tools/settings-tool.js' },
    ];
    tools.forEach(function (t) {
      if (t.ref && t.ref.id) {
        ToolRegistry.register(t.ref);
      } else {
        console.warn('[Stitch Toolkit] ' + t.name + ' not loaded — check ' + t.file);
      }
    });

    PanelManager.createUI();
    ShortcutManager.init();
    RecorderBridge.init();

    // Mount initial tool
    var activeTab = StateManager.get('activeTab');
    var activeTool = ToolRegistry.get(activeTab);
    var tc2 = PanelManager.getToolContainer();
    if (activeTool && activeTool.mount && tc2) {
      tc2.innerHTML = '';
      activeTool.mount(tc2);
    }

    console.log('[Stitch Toolkit] v0.7.0 initialized (' + window.StitchI18n.getLocale() + ')');
  }

  // Cleanup on page unload / extension reload
  window.addEventListener('beforeunload', function () {
    if (window.RecorderTool && window.RecorderTool.cleanup) window.RecorderTool.cleanup();
    window.__stitchToolkitInjected = false;
  });

  // Start when DOM ready — deferred to next tick so external tool files (listed
  // after content.js in manifest) have time to register on window namespace
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(bootstrap, 0); });
  } else {
    setTimeout(bootstrap, 0);
  }

})();