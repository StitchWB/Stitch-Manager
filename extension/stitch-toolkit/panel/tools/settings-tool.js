// Stitch Toolkit — Settings Tool (IIFE)
// Provides settings UI: language, theme, toggles, data export/clear.

(function () {
  'use strict';

  if (window.SettingsTool) return;

  function render() {
    var i18n = window.StitchI18n.t;
    var s = window.StateManager.getAll();
    var themeLabels = { auto: i18n('settings.themeAuto'), dark: i18n('settings.themeDark'), light: i18n('settings.themeLight') };

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
      '<div class="tk-section-title">' + i18n('settings.bridgeTitle') + '</div>' +
      '<div class="tk-bridge-grid" id="tk-bridge-grid">' +
        '<div class="tk-bridge-row" data-bridge="record"><span class="tk-bridge-dot"></span><span class="tk-bridge-name">' + i18n('settings.bridgeRecord') + '</span><span class="tk-bridge-state">…</span></div>' +
        '<div class="tk-bridge-row" data-bridge="replay"><span class="tk-bridge-dot"></span><span class="tk-bridge-name">' + i18n('settings.bridgeReplay') + '</span><span class="tk-bridge-state">…</span></div>' +
        '<div class="tk-bridge-row" data-bridge="health"><span class="tk-bridge-dot"></span><span class="tk-bridge-name">' + i18n('settings.bridgeHealth') + '</span><span class="tk-bridge-state">…</span></div>' +
      '</div>' +
      '<div class="tk-hint" style="text-align:left;margin-top:6px">' + i18n('settings.bridgeHint') + '</div>' +
      '<div class="tk-section-title">' + i18n('settings.data') + '</div>' +
      '<div class="tk-row">' +
        '<button class="tk-btn" id="tk-export-all" style="flex:1">' + i18n('settings.exportAll') + '</button>' +
        '<button class="tk-btn tk-danger" id="tk-clear-all" style="flex:1">' + i18n('settings.clearAll') + '</button>' +
      '</div>' +
      '<div class="tk-hint">' + i18n('app.version', { version: '0.7.0' }) + '</div>';
  }

  function refreshBridgeStatus(container) {
    var grid = container.querySelector('#tk-bridge-grid');
    if (!grid) return;
    try {
      chrome.runtime.sendMessage({ type: 'tk:status' }).then(function (resp) {
        if (!resp || !resp.ok || !resp.bridges) return;
        var i18n = window.StitchI18n.t;
        ['record', 'replay', 'health'].forEach(function (kind) {
          var row = grid.querySelector('[data-bridge="' + kind + '"]');
          if (!row) return;
          var online = Boolean(resp.bridges[kind]);
          row.classList.toggle('tk-on', online);
          var stateEl = row.querySelector('.tk-bridge-state');
          if (stateEl) stateEl.textContent = online ? i18n('settings.bridgeOnline') : i18n('settings.bridgeOffline');
        });
      }).catch(function () {});
    } catch (e) {}
  }

  function mount(container) {
    container.innerHTML = render();

    refreshBridgeStatus(container);

    container.querySelector('#tk-set-sound') && container.querySelector('#tk-set-sound').addEventListener('click', function () { toggleSetting('soundEffects', this); });

    container.querySelector('#tk-set-locale') && container.querySelector('#tk-set-locale').addEventListener('change', function () {
      window.StitchI18n.setLocale(this.value);
      window.PanelManager.refreshCurrentTool();
      window.NotificationService.info('Language changed to ' + window.StitchI18n.getLocaleNames()[this.value]);
    });

    container.querySelector('#tk-set-theme') && container.querySelector('#tk-set-theme').addEventListener('change', function () {
      window.StateManager.set('theme', this.value);
      document.documentElement.classList.remove('tk-light', 'tk-dark');
      if (this.value === 'light') document.documentElement.classList.add('tk-light');
      else if (this.value === 'dark') document.documentElement.classList.add('tk-dark');
    });

    container.querySelector('#tk-export-all') && container.querySelector('#tk-export-all').addEventListener('click', function () { exportAll(container); });
    container.querySelector('#tk-clear-all') && container.querySelector('#tk-clear-all').addEventListener('click', function () { clearAll(container); });
  }

  function toggleSetting(key, btn) {
    var val = !window.StateManager.get(key);
    window.StateManager.set(key, val);
    btn.classList.toggle('tk-on', val);
  }

  function exportAll(container) {
    var data = {
      version: '0.7.0',
      exported: new Date().toISOString(),
      settings: {
        theme: window.StateManager.get('theme'),
        soundEffects: window.StateManager.get('soundEffects'),
      },
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'stitch-toolkit-config.json';
    a.click();
    URL.revokeObjectURL(url);
    window.NotificationService.success(window.StitchI18n.t('settings.configExported'));
  }

  function clearAll(container) {
    if (!confirm(window.StitchI18n.t('settings.confirmClearAll'))) return;
    Object.keys(window.StateManager.getAll()).forEach(function (k) {
      window.StateManager.save(k, k === 'theme' ? 'auto' : (Array.isArray(window.StateManager.getAll()[k]) ? [] : null));
    });
    window.NotificationService.info(window.StitchI18n.t('settings.allDataCleared'));
    mount(container);
  }

  // Export to window namespace
  window.SettingsTool = {
    id: 'settings',
    name: 'Settings',
    icon: '⚡',
    mount: mount
  };

})();
