// Stitch Toolkit — Localization
// Simple i18n system compatible with classic scripts (no ES modules)

(function () {
  'use strict';
  if (window.__stitchI18nLoaded) return;
  window.__stitchI18nLoaded = true;

  // Default locale detection
  function detectLocale() {
    try {
      var nav = navigator.language || navigator.userLanguage || 'en';
      var lang = nav.split('-')[0].toLowerCase();
      return lang === 'ru' ? 'ru' : 'en';
    } catch (e) { return 'en'; }
  }

  // Translations dictionary
  var TRANSLATIONS = {
    en: {
      // General
      'app.title': 'Stitch Toolkit',
      'app.ready': 'Ready',

      // Tabs
      'tab.stripe': 'Stripe',
      'tab.recorder': 'Recorder',
      'tab.settings': 'Settings',

      // Stripe Filler
      'stripe.cardDetails': 'Card Details',
      'stripe.saveCard': 'Save card',
      'stripe.address': 'Address',
      'stripe.fillCard': 'Fill Card',
      'stripe.formatHint': 'Format: number|MM|YYYY|CVC',
      'stripe.saved': 'Saved!',
      'stripe.invalidFormat': 'Invalid format',
      'stripe.enterCardFirst': 'Enter a card first',
      'stripe.filledFrames': 'Filled {count} frame(s)',
      'stripe.fillFailed': 'Fill failed',
      'stripe.noLastCard': 'No last card',
      'stripe.invalidLastCard': 'Invalid last card',
      'stripe.filledLastCard': 'Filled last card ({count} frame(s))',
      'stripe.shortcuts': '⌘⇧F — quick fill · ⌘⇧S — toggle panel',
      'stripe.billing': 'Billing',
      'stripe.name': 'Name',
      'stripe.city': 'City',
      'stripe.state': 'State',
      'stripe.postal': 'ZIP',
      'stripe.history': '— history —',

      // Recorder
      'recorder.title': 'Scenario Recorder',
      'recorder.start': '▶ Start',
      'recorder.export': '📤 Export',
      'recorder.imported': 'Imported {count} steps',
      'recorder.noStepsToExport': 'No steps to export',
      'recorder.idle': 'Idle — not recording.',
      'recorder.importFailed': 'Import failed',
      'recorder.stopFailed': 'Failed to stop recording',
      'recorder.startFailed': 'Failed to start recording',
      'recorder.namePlaceholder': 'Scenario name (optional)',
      'recorder.stop': '■ Stop',
      'recorder.hint': 'Click Start, then interact with the page. Click Stop to save.',

      // Settings
      'settings.language': 'Language',
      'settings.languageDesc': 'Interface language',
      'settings.general': 'General',
      'settings.autoDetectStripe': 'Auto-detect Stripe',
      'settings.autoDetectStripeDesc': 'Switch to Stripe tab when Stripe form detected',
      'settings.autoExpand': 'Auto-expand panel',
      'settings.autoExpandDesc': 'Expand panel when Stripe detected',
      'settings.clipboardWatch': 'Clipboard watcher',
      'settings.clipboardWatchDesc': 'Show toast when card copied to clipboard',
      'settings.soundEffects': 'Sound effects',
      'settings.soundEffectsDesc': 'Play sound on fill success/error',
      'settings.appearance': 'Appearance',
      'settings.theme': 'Theme',
      'settings.themeAuto': 'Auto (system)',
      'settings.themeDark': 'Dark',
      'settings.themeLight': 'Light',
      'settings.billingProfiles': 'Billing Profiles',
      'settings.addProfile': '+ Add Profile',
      'settings.profileName': 'Profile name (e.g., "Personal", "Business"):',
      'settings.countryCode': 'Country code (e.g., US, GB):',
      'settings.address': 'Address:',
      'settings.postalCode': 'Postal code:',
      'settings.data': 'Data',
      'settings.exportAll': '📤 Export All',
      'settings.clearAll': '🗑 Clear All',
      'settings.confirmClearAll': 'Clear ALL data (cards, profiles, settings)? This cannot be undone.',
      'settings.profileSaved': 'Profile saved',
      'settings.configExported': 'Config exported',
      'settings.allDataCleared': 'All data cleared',

      // Notifications
      'notif.cardDetected': 'Card detected',
      'notif.fillNow': 'Fill now',

      // Context menu
      'ctx.quickFill': '⚡ Quick Fill',
      'ctx.toggleRecorder': '⏺ Toggle Recorder',
      'ctx.exportScenario': '📤 Export Scenario',
      'ctx.stripeFiller': '💳 Stripe Filler',
      'ctx.recorder': '⏺ Recorder',
      'ctx.expand': 'Expand',
      'ctx.collapse': 'Collapse',

      // Tooltip
      'tooltip.toggleTheme': 'Toggle theme',
      'tooltip.settings': 'Settings',
      'tooltip.close': 'Collapse (⌘⇧S)',

      // Status
      'status.filling': '⏳ Filling...',
    },

    ru: {
      // General
      'app.title': 'Stitch Toolkit',
      'app.ready': 'Готов',

      // Tabs
      'tab.stripe': 'Stripe',
      'tab.recorder': 'Запись',
      'tab.settings': 'Настройки',

      // Stripe Filler
      'stripe.cardDetails': 'Данные карты',
      'stripe.saveCard': 'Сохранить карту',
      'stripe.address': 'Адрес',
      'stripe.fillCard': '⚡ Заполнить',
      'stripe.formatHint': 'Формат: номер|ММ|ГГГГ|CVC',
      'stripe.saved': 'Сохранено!',
      'stripe.invalidFormat': 'Неверный формат',
      'stripe.enterCardFirst': 'Сначала введите карту',
      'stripe.filledFrames': 'Заполнено {count} фрейм(ов)',
      'stripe.fillFailed': 'Ошибка заполнения',
      'stripe.noLastCard': 'Нет последней карты',
      'stripe.invalidLastCard': 'Неверная последняя карта',
      'stripe.filledLastCard': 'Заполнена последняя карта ({count} фрейм(ов))',
      'stripe.shortcuts': '⌘⇧F — быстрое заполнение · ⌘⇧S — свернуть/развернуть',
      'stripe.billing': 'Биллинг',
      'stripe.name': 'Имя',
      'stripe.city': 'Город',
      'stripe.state': 'Область',
      'stripe.postal': 'Индекс',
      'stripe.history': '— история —',

      // Recorder
      'recorder.title': 'Запись сценария',
      'recorder.start': '▶ Старт',
      'recorder.export': '📤 Экспорт',
      'recorder.imported': 'Импортировано {count} шагов',
      'recorder.noStepsToExport': 'Нет шагов для экспорта',
      'recorder.idle': 'Простой — запись не ведётся.',
      'recorder.importFailed': 'Ошибка импорта',
      'recorder.stopFailed': 'Ошибка остановки записи',
      'recorder.startFailed': 'Ошибка начала записи',
      'recorder.namePlaceholder': 'Название сценария (необязательно)',
      'recorder.stop': '■ Стоп',
      'recorder.hint': 'Нажмите Старт, затем взаимодействуйте со страницей. Нажмите Стоп для сохранения.',

      // Settings
      'settings.language': 'Язык',
      'settings.languageDesc': 'Язык интерфейса',
      'settings.general': 'Основные',
      'settings.autoDetectStripe': 'Автодетект Stripe',
      'settings.autoDetectStripeDesc': 'Переключаться на вкладку Stripe при обнаружении формы',
      'settings.autoExpand': 'Авторазворот панели',
      'settings.autoExpandDesc': 'Разворачивать панель при обнаружении Stripe',
      'settings.clipboardWatch': 'Мониторинг буфера',
      'settings.clipboardWatchDesc': 'Показывать уведомление при копировании карты',
      'settings.soundEffects': 'Звуковые эффекты',
      'settings.soundEffectsDesc': 'Воспроизводить звук при успехе/ошибке',
      'settings.appearance': 'Внешний вид',
      'settings.theme': 'Тема',
      'settings.themeAuto': 'Авто (системная)',
      'settings.themeDark': 'Тёмная',
      'settings.themeLight': 'Светлая',
      'settings.billingProfiles': 'Платёжные профили',
      'settings.addProfile': '+ Добавить профиль',
      'settings.profileName': 'Название профиля (например, "Личный", "Рабочий"):',
      'settings.countryCode': 'Код страны (например, RU, KZ):',
      'settings.address': 'Адрес:',
      'settings.postalCode': 'Индекс:',
      'settings.data': 'Данные',
      'settings.exportAll': '📤 Экспорт всего',
      'settings.clearAll': '🗑 Очистить всё',
      'settings.confirmClearAll': 'Очистить ВСЕ данные (карты, профили, настройки)? Это необратимо.',
      'settings.profileSaved': 'Профиль сохранён',
      'settings.configExported': 'Настройки экспортированы',
      'settings.allDataCleared': 'Все данные очищены',

      // Notifications
      'notif.cardDetected': 'Карта обнаружена',
      'notif.fillNow': 'Заполнить',

      // Context menu
      'ctx.quickFill': '⚡ Быстрое заполнение',
      'ctx.toggleRecorder': '⏺ Переключить запись',
      'ctx.exportScenario': '📤 Экспорт сценария',
      'ctx.stripeFiller': '💳 Stripe заполнитель',
      'ctx.recorder': '⏺ Запись',
      'ctx.expand': 'Развернуть',
      'ctx.collapse': 'Свернуть',

      // Tooltip
      'tooltip.toggleTheme': 'Переключить тему',
      'tooltip.settings': 'Настройки',
      'tooltip.close': 'Свернуть (⌘⇧S)',

      // Status
      'status.filling': '⏳ Заполнение...',
    }
  };

  // Private locale variable (avoids "this" binding issues)
  var _locale = detectLocale();

  // Restore saved locale
  try {
    var saved = localStorage.getItem('tk:locale');
    if (saved && TRANSLATIONS[saved]) _locale = saved;
  } catch (e) {}

  // I18n API — no "this" dependency
  window.StitchI18n = {
    t: function (key, vars) {
      var dict = TRANSLATIONS[_locale] || TRANSLATIONS.en;
      var text = dict[key] || TRANSLATIONS.en[key] || key;
      if (vars) {
        for (var k in vars) {
          if (vars.hasOwnProperty(k)) {
            text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
          }
        }
      }
      return text;
    },

    setLocale: function (lang) {
      _locale = lang === 'ru' ? 'ru' : 'en';
      try { localStorage.setItem('tk:locale', _locale); } catch (e) {}
    },

    getLocale: function () { return _locale; },

    getLocaleNames: function () { return { en: 'English', ru: 'Русский' }; },
  };
})();
