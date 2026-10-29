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
      'app.version': 'Stitch Toolkit v{version}',

      // Tabs
      'tab.recorder': 'Recorder',
      'tab.settings': 'Settings',

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
      'recorder.saved': 'Scenario saved ({count} steps)',
      'recorder.replay': '⏵ Replay last',
      'recorder.replayStarted': 'Replay started',
      'recorder.replayFailed': 'Replay failed',
      'recorder.controlledExternally': 'Recording is controlled by Stitch app.',
      'recorder.sessionActive': 'Another session is already active',
      'recorder.liveSteps': 'Live steps',
      'recorder.replayProgress': 'Replay progress',
      'recorder.savedScenarios': 'Saved scenarios',
      'recorder.deleteScenario': 'Delete scenario',
      'recorder.confirmDelete': 'Delete scenario "{name}"? This cannot be undone.',
      'recorder.deleted': 'Scenario deleted',

      // Overlay (record/replay HUD)
      'overlay.record': 'Record',
      'overlay.replay': 'Replay',
      'overlay.idle': 'Idle',
      'overlay.noSession': 'No active session',
      'overlay.statusRunning': 'running',
      'overlay.statusPaused': 'paused',
      'overlay.statusManualPaused': 'manual-paused',
      'overlay.statusStopped': 'stopped',
      'overlay.steps': 'Steps: {count}',
      'overlay.manualStepNow': '⚠️ Manual step {count} — do it now',
      'overlay.manualRequired': '⚠️ Manual action required — do it then continue',
      'overlay.failed': '❌ Failed: {error}',
      'overlay.stepProgress': 'Step {current}/{total}',
      'overlay.reasonResume': 'Click Resume when done',
      'overlay.reasonContinue': 'Complete the action manually, then click Continue',
      'overlay.collapse': 'Collapse',
      'overlay.expand': 'Expand',
      'overlay.btnManual': 'Manual ⏸',
      'overlay.btnPause': 'Pause',
      'overlay.btnResume': 'Resume',
      'overlay.btnContinue': 'Continue',
      'overlay.btnStop': 'Stop',

      // Settings — Stitch bridge
      'settings.bridgeTitle': 'Stitch Bridge',
      'settings.bridgeHint': 'WebSocket connection to the Stitch app (record/replay/health).',
      'settings.bridgeRecord': 'Record',
      'settings.bridgeReplay': 'Replay',
      'settings.bridgeHealth': 'Health',
      'settings.bridgeOnline': 'online',
      'settings.bridgeOffline': 'offline',

      // Settings
      'settings.language': 'Language',
      'settings.languageDesc': 'Interface language',
      'settings.general': 'General',
      'settings.soundEffects': 'Sound effects',
      'settings.soundEffectsDesc': 'Play sound on success/error',
      'settings.appearance': 'Appearance',
      'settings.theme': 'Theme',
      'settings.themeAuto': 'Auto (system)',
      'settings.themeDark': 'Dark',
      'settings.themeLight': 'Light',
      'settings.data': 'Data',
      'settings.exportAll': '📤 Export All',
      'settings.clearAll': '🗑 Clear All',
      'settings.confirmClearAll': 'Clear ALL data? This cannot be undone.',
      'settings.configExported': 'Config exported',
      'settings.allDataCleared': 'All data cleared',

      // Context menu
      'ctx.toggleRecorder': '⏺ Toggle Recorder',
      'ctx.exportScenario': '📤 Export Scenario',
      'ctx.recorder': '⏺ Recorder',
      'ctx.expand': 'Expand',
      'ctx.collapse': 'Collapse',

      // Tooltip
      'tooltip.toggleTheme': 'Toggle theme',
      'tooltip.settings': 'Settings',
      'tooltip.close': 'Collapse (⌘⇧S)',
    },

    ru: {
      // General
      'app.title': 'Stitch Toolkit',
      'app.ready': 'Готов',
      'app.version': 'Stitch Toolkit v{version}',

      // Tabs
      'tab.recorder': 'Запись',
      'tab.settings': 'Настройки',

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
      'recorder.saved': 'Сценарий сохранён ({count} шагов)',
      'recorder.replay': '⏵ Проиграть',
      'recorder.replayStarted': 'Воспроизведение запущено',
      'recorder.replayFailed': 'Ошибка воспроизведения',
      'recorder.controlledExternally': 'Запись управляется приложением Stitch.',
      'recorder.sessionActive': 'Уже активна другая сессия',
      'recorder.liveSteps': 'Шаги в реальном времени',
      'recorder.replayProgress': 'Прогресс воспроизведения',
      'recorder.savedScenarios': 'Сохранённые сценарии',
      'recorder.deleteScenario': 'Удалить сценарий',
      'recorder.confirmDelete': 'Удалить сценарий "{name}"? Это необратимо.',
      'recorder.deleted': 'Сценарий удалён',

      // Overlay (record/replay HUD)
      'overlay.record': 'Запись',
      'overlay.replay': 'Реплей',
      'overlay.idle': 'Ожидание',
      'overlay.noSession': 'Нет активной сессии',
      'overlay.statusRunning': 'идёт',
      'overlay.statusPaused': 'пауза',
      'overlay.statusManualPaused': 'ручной шаг',
      'overlay.statusStopped': 'остановлен',
      'overlay.steps': 'Шагов: {count}',
      'overlay.manualStepNow': '⚠️ Ручной шаг {count} — выполните сейчас',
      'overlay.manualRequired': '⚠️ Требуется ручное действие — выполните и продолжите',
      'overlay.failed': '❌ Ошибка: {error}',
      'overlay.stepProgress': 'Шаг {current}/{total}',
      'overlay.reasonResume': 'Нажмите «Продолжить» по завершении',
      'overlay.reasonContinue': 'Выполните действие вручную, затем нажмите «Дальше»',
      'overlay.collapse': 'Свернуть',
      'overlay.expand': 'Развернуть',
      'overlay.btnManual': 'Ручной ⏸',
      'overlay.btnPause': 'Пауза',
      'overlay.btnResume': 'Продолжить',
      'overlay.btnContinue': 'Дальше',
      'overlay.btnStop': 'Стоп',

      // Settings — Stitch bridge
      'settings.bridgeTitle': 'Stitch-бридж',
      'settings.bridgeHint': 'WebSocket-соединение с приложением Stitch (запись/реплей/health).',
      'settings.bridgeRecord': 'Запись',
      'settings.bridgeReplay': 'Реплей',
      'settings.bridgeHealth': 'Health',
      'settings.bridgeOnline': 'онлайн',
      'settings.bridgeOffline': 'офлайн',

      // Settings
      'settings.language': 'Язык',
      'settings.languageDesc': 'Язык интерфейса',
      'settings.general': 'Основные',
      'settings.soundEffects': 'Звуковые эффекты',
      'settings.soundEffectsDesc': 'Воспроизводить звук при успехе/ошибке',
      'settings.appearance': 'Внешний вид',
      'settings.theme': 'Тема',
      'settings.themeAuto': 'Авто (системная)',
      'settings.themeDark': 'Тёмная',
      'settings.themeLight': 'Светлая',
      'settings.data': 'Данные',
      'settings.exportAll': '📤 Экспорт всего',
      'settings.clearAll': '🗑 Очистить всё',
      'settings.confirmClearAll': 'Очистить ВСЕ данные? Это необратимо.',
      'settings.configExported': 'Настройки экспортированы',
      'settings.allDataCleared': 'Все данные очищены',

      // Context menu
      'ctx.toggleRecorder': '⏺ Переключить запись',
      'ctx.exportScenario': '📤 Экспорт сценария',
      'ctx.recorder': '⏺ Запись',
      'ctx.expand': 'Развернуть',
      'ctx.collapse': 'Свернуть',

      // Tooltip
      'tooltip.toggleTheme': 'Переключить тему',
      'tooltip.settings': 'Настройки',
      'tooltip.close': 'Свернуть (⌘⇧S)',
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
