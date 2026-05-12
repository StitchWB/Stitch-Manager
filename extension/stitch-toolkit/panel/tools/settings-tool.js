// Stitch Toolkit — Settings Tool (IIFE)
// Provides settings UI: language, theme, toggles, billing profiles, data export/clear.

(function () {
  'use strict';

  if (window.SettingsTool) return;

  function render() {
    var i18n = window.StitchI18n.t;
    var s = window.StateManager.getAll();
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
      '<div class="tk-hint">' + i18n('app.version', { version: '0.6.1' }) + '</div>';
  }

  function mount(container) {
    container.innerHTML = render();

    container.querySelector('#tk-set-autodetect') && container.querySelector('#tk-set-autodetect').addEventListener('click', function () { toggleSetting('autoDetect', this); });
    container.querySelector('#tk-set-autoexpand') && container.querySelector('#tk-set-autoexpand').addEventListener('click', function () { toggleSetting('autoExpand', this); });
    container.querySelector('#tk-set-clipboard') && container.querySelector('#tk-set-clipboard').addEventListener('click', function () { toggleSetting('clipboardWatch', this); });
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

    container.querySelector('#tk-add-profile') && container.querySelector('#tk-add-profile').addEventListener('click', function () { addBillingProfile(container); });
    container.querySelector('#tk-export-all') && container.querySelector('#tk-export-all').addEventListener('click', function () { exportAll(container); });
    container.querySelector('#tk-clear-all') && container.querySelector('#tk-clear-all').addEventListener('click', function () { clearAll(container); });

    container.querySelectorAll('.tk-step-del').forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.del, 10);
        var profiles = window.StateManager.get('billingProfiles');
        profiles.splice(idx, 1);
        window.StateManager.set('billingProfiles', profiles);
        mount(container);
      };
    });
  }

  function toggleSetting(key, btn) {
    var val = !window.StateManager.get(key);
    window.StateManager.set(key, val);
    btn.classList.toggle('tk-on', val);
  }

  function addBillingProfile(container) {
    var i18n = window.StitchI18n.t;
    var name = prompt(i18n('settings.profileName'));
    if (!name) return;
    var country = prompt(i18n('settings.countryCode')) || '';
    var address = prompt(i18n('settings.address')) || '';
    var postal = prompt(i18n('settings.postalCode')) || '';

    var profiles = window.StateManager.get('billingProfiles') || [];
    profiles.unshift({ name: name, country: country, address: address, postal: postal });
    window.StateManager.set('billingProfiles', profiles);
    mount(container);
    window.NotificationService.success(i18n('settings.profileSaved'));
  }

  function exportAll(container) {
    var data = {
      version: '0.6.1',
      exported: new Date().toISOString(),
      cardHistory: window.StateManager.get('cardHistory'),
      billingProfiles: window.StateManager.get('billingProfiles'),
      settings: {
        theme: window.StateManager.get('theme'),
        autoDetect: window.StateManager.get('autoDetect'),
        autoExpand: window.StateManager.get('autoExpand'),
        clipboardWatch: window.StateManager.get('clipboardWatch'),
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
