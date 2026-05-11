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
      'app.version': 'v{version} · Stitch Toolkit',
      'app.ready': 'Ready',
      'app.loading': 'Loading...',

      // Tabs
      'tab.stripe': 'Stripe',
      'tab.recorder': 'Recorder',
      'tab.settings': 'Settings',

      // Stripe Filler
      'stripe.cardDetails': 'Card Details',
      'stripe.cardNumber': 'Card number|MM|YYYY|CVC',
      'stripe.recentCards': '— recent —',
      'stripe.saveCard': 'Save card',
      'stripe.billingInfo': 'Billing Info',
      'stripe.autoFillBilling': 'Auto-fill billing',
      'stripe.profile': '— profile —',
      'stripe.cardholderName': 'Cardholder name',
      'stripe.country': 'US',
      'stripe.address': 'Address',
      'stripe.postalCode': 'Postal code',
      'stripe.fillCard': 'Fill Card',
      'stripe.detect': 'Detect',
      'stripe.formatHint': 'Format: number|MM|YYYY|CVC',
      'stripe.saved': 'Saved!',
      'stripe.invalidFormat': 'Invalid format',
      'stripe.enterCardFirst': 'Enter a card first',
      'stripe.filledFrames': 'Filled {count} frame(s)',
      'stripe.detectedFrames': 'Stripe detected in {count} frame(s)',
      'stripe.notDetected': 'Stripe fields not detected',
      'stripe.fillFailed': 'Fill failed',
      'stripe.noLastCard': 'No last card',
      'stripe.invalidLastCard': 'Invalid last card',
      'stripe.filledLastCard': 'Filled last card ({count} frame(s))',
      'stripe.shortcuts': '⌘⇧F — quick fill · ⌘⇧S — toggle panel',

      // Recorder
      'recorder.title': 'Scenario Recorder',
      'recorder.noSteps': 'No steps recorded yet.\nPress Start to begin.',
      'recorder.start': '▶ Start',
      'recorder.pause': '⏸ Pause',
      'recorder.resume': '▶ Resume',
      'recorder.clear': '🗑 Clear',
      'recorder.import': '📥 Import',
      'recorder.export': '📤 Export',
      'recorder.stepsCount': 'Steps: {count}',
      'recorder.shortcuts': '⌘⇧R toggle · ⌘⇧E export',
      'recorder.cleared': 'Steps cleared',
      'recorder.confirmClear': 'Clear all recorded steps?',
      'recorder.exported': 'Exported as {format}',
      'recorder.imported': 'Imported {count} steps',
      'recorder.noStepsToExport': 'No steps to export',
      'recorder.invalidJson': 'Invalid JSON file',

      // Export modal
      'export.title': '📤 Export Scenario',
      'export.json': '📄 JSON (raw data)',
      'export.playwright': '🎭 Playwright script',
      'export.puppeteer': '🎪 Puppeteer script',
      'export.curl': '🌐 cURL commands',
      'export.cancel': 'Cancel',

      'settings.language': 'Language',
      'settings.languageDesc': 'Interface language',

      // Settings
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
      'notif.noStepsToExport': 'No steps to export',
      'notif.stepsCleared': 'Steps cleared',
      'notif.configExported': 'Config exported',
      'notif.allDataCleared': 'All data cleared',
      'notif.profileSaved': 'Profile saved',

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
      'tooltip.floatBtn': 'Stitch Toolkit (⌘⇧S)',

      // Status
      'status.filling': '⏳ Filling...',
      'status.done': '✅ Done!',
    },

    ru: {
      // General
      'app.title': 'Stitch Toolkit',
      'app.version': 'v{version} · Stitch Toolkit',
      'app.ready': 'Готов',
      'app.loading': 'Загрузка...',

      // Tabs
      'tab.stripe': 'Stripe',
      'tab.recorder': 'Запись',
      'tab.settings': 'Настройки',

      // Stripe Filler
      'stripe.cardDetails': 'Данные карты',
      'stripe.cardNumber': 'номер|ММ|ГГГГ|CVC',
      'stripe.recentCards': '— недавние —',
      'stripe.saveCard': 'Сохранить карту',
      'stripe.billingInfo': 'Платёжные данные',
      'stripe.autoFillBilling': 'Автозаполнение данных',
      'stripe.profile': '— профиль —',
      'stripe.cardholderName': 'Имя держателя карты',
      'stripe.country': 'RU',
      'stripe.address': 'Адрес',
      'stripe.postalCode': 'Индекс',
      'stripe.fillCard': '⚡ Заполнить',
      'stripe.detect': 'Найти',
      'stripe.formatHint': 'Формат: номер|ММ|ГГГГ|CVC',
      'stripe.saved': 'Сохранено!',
      'stripe.invalidFormat': 'Неверный формат',
      'stripe.enterCardFirst': 'Сначала введите карту',
      'stripe.filledFrames': 'Заполнено {count} фрейм(ов)',
      'stripe.detectedFrames': 'Stripe найден в {count} фрейм(ах)',
      'stripe.notDetected': 'Поля Stripe не найдены',
      'stripe.fillFailed': 'Ошибка заполнения',
      'stripe.noLastCard': 'Нет последней карты',
      'stripe.invalidLastCard': 'Неверная последняя карта',
      'stripe.filledLastCard': 'Заполнена последняя карта ({count} фрейм(ов))',
      'stripe.shortcuts': '⌘⇧F — быстрое заполнение · ⌘⇧S — свернуть/развернуть',

      // Recorder
      'recorder.title': 'Запись сценария',
      'recorder.noSteps': 'Нет записанных шагов.\nНажмите Старт для начала.',
      'recorder.start': '▶ Старт',
      'recorder.pause': '⏸ Пауза',
      'recorder.resume': '▶ Продолжить',
      'recorder.clear': '🗑 Очистить',
      'recorder.import': '📥 Импорт',
      'recorder.export': '📤 Экспорт',
      'recorder.stepsCount': 'Шагов: {count}',
      'recorder.shortcuts': '⌘⇧R старт/пауза · ⌘⇧E экспорт',
      'recorder.cleared': 'Шаги очищены',
      'recorder.confirmClear': 'Очистить все записанные шаги?',
      'recorder.exported': 'Экспортировано как {format}',
      'recorder.imported': 'Импортировано {count} шагов',
      'recorder.noStepsToExport': 'Нет шагов для экспорта',
      'recorder.invalidJson': 'Неверный JSON файл',

      // Export modal
      'export.title': '📤 Экспорт сценария',
      'export.json': '📄 JSON (сырые данные)',
      'export.playwright': '🎭 Playwright скрипт',
      'export.puppeteer': '🎪 Puppeteer скрипт',
      'export.curl': '🌐 cURL команды',
      'export.cancel': 'Отмена',

      'settings.language': 'Язык',
      'settings.languageDesc': 'Язык интерфейса',

      // Settings
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
      'notif.noStepsToExport': 'Нет шагов для экспорта',
      'notif.stepsCleared': 'Шаги очищены',
      'notif.configExported': 'Настройки экспортированы',
      'notif.allDataCleared': 'Все данные очищены',
      'notif.profileSaved': 'Профиль сохранён',

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
      'tooltip.floatBtn': 'Stitch Toolkit (⌘⇧S)',

      // Status
      'status.filling': '⏳ Заполнение...',
      'status.done': '✅ Готово!',
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
      // Emit event for UI refresh
      if (typeof window !== 'undefined' && window.StitchI18nEventBus) {
        window.StitchI18nEventBus.emit('locale:changed', _locale);
      }
    },

    getLocale: function () { return _locale; },

    getAvailableLocales: function () { return Object.keys(TRANSLATIONS); },

    getLocaleNames: function () {
      return { en: 'English', ru: 'Русский' };
    }
  };

})();