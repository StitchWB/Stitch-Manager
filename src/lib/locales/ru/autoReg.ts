import type { AutoRegTranslations } from '../../i18n/types/autoReg';

export const autoReg: AutoRegTranslations = {
  autoReg: {
    addyio: {
      apiToken: "API-токен",
      connectionError: "Ошибка подключения",
      connectionSuccess: "Успешно подключено! Токен: {tokenName}",
      testConnection: "Проверить соединение и загрузить данные"
    },
    aliasPattern: "ШАБЛОН АЛИАСА",
    appPassword: "ПАРОЛЬ ПРИЛОЖЕНИЯ",
    automationHeaderCard: {
      statusLabel: "Статус",
      title: "Автопополнение аккаунтов",
      toggleTooltip: "Включить/выключить автопополнение"
    },
    automation_tab: {
      accounts: "Аккаунтов",
      api: "API",
      running: "Выполняется",
      v304: "v3.0.4",
      waiting: "Ожидание"
    },
    awsAccount: "AWS аккаунт",
    awsBootstrap: "AWS bootstrap",
    awsBootstrapExistingSession: "AWS bootstrap (существующая сессия)",
    awsBootstrapNewAccount: "AWS bootstrap (новый аккаунт)",
    clearContext: "Очистить контекст",
    configure33mail: "Настроить 33mail",
    configureAddyio: "Настроить Addy.io",
    configureMailFirst: "Сначала настройте почту",
    consoleOutput: "Консоль",
    dragToResize: "Потяните, чтобы изменить ширину панели",
    emailAliases: "Email Алиасы",
    emailGeneration: "Генерация email и аутентификация",
    emailGenerationDomain: "ДОМЕН ГЕНЕРАЦИИ EMAIL",
    emailPattern: "Шаблон Email",
    empty: {
      title: "Нет провайдеров",
      description: "Каждый провайдер — отдельный плагин. Установите плагины на странице «Плагины», чтобы добавить регистрации.",
      action: "Открыть Плагины",
      retry: "Повторить",
    },
    cockpit: {
      identity: "Идентификация",
      browser: "Браузер",
      network: "Сеть",
      launch: "Запуск",
      notify: "Уведомления",
    },
    engineTab: {
      auto: "Авто",
      cardsLoaded: "Карты загружены",
      generateCard: "Сгенерировать карту",
      generated: "Сгенерированная карта: ",
      logsLabel: "Логи",
      manual: "Вручную",
      openai_captcha: "OpenAI captcha",
      passwordLengthTooltip: "Длина пароля",
      rust: "Rust",
      savedCards: "Сохранённые карты",
      symbolUnit: "симв.",
      v2: "v2"
    },
    host: "Хост",
    identity_tab: {
      aws_builder_id: "AWS Builder ID",
      headless: "Headless",
      ready: "Готов",
      recommended: "Рекомендуется"
    },
    imapCredentials: "Учётные данные IMAP",
    inboxFiltersSection: {
      listButton: "Список"
    },
    inboxMessagesSection: {
      deleteButton: "Удалить",
      deleteTooltip: "Удалить сообщение",
      emptyDescription: "Сообщений пока нет",
      emptyTitle: "Пусто",
      from: "От",
      markAsReadTooltip: "Отметить как прочитанное",
      noSubject: "Без темы",
      readButton: "Открыть"
    },
    inboxProviderSection: {
      connectButton: "Подключить",
      disconnectButton: "Отключить",
      sessionLabel: "Сессия"
    },
    launchContextProfile: "Профиль запуска",
    launchContextTarget: "Цель запуска",
    launchContextTitle: "Контекст запуска",
    launch_pad: {
      python: "Python",
      python_drissionpage: "Python (DrissionPage)"
    },
    liveRegistrationLogs: "Логи регистрации в реальном времени",
    masterGmail: "ОСНОВНОЙ GMAIL",
    pause: "ПАУЗА",
    pipeline: {
      abort: "Прервать",
      done: "Готово",
      manual: "Ручной режим",
      paused: "Пауза",
      resume: "Продолжить",
      skip: "Пропустить",
      takeOver: "Взять управление",
    },
    placeholders: {
      email: "user@example.com"
    },
    port: "Порт",
    providerReplenishmentSection: {
      accountUnit: "шт.",
      activeSummary: "Активные аккаунты",
      description: "Провайдеры, участвующие в автопополнении, и их активные аккаунты.",
      minReserveLabel: "Минимальный резерв",
      minTooltip: "Минимальный порог активных аккаунтов",
      strategyLabel: "Стратегия",
      strategyTooltip: "Стратегия пополнения"
    },
    proxy: "Прокси",
    ready: "Готово",
    readyToStart: "Готов к запуску",
    requiresMachineId: "Machine ID",
    resume: "ПРОДОЛЖИТЬ",
    saveError: "Ошибка сохранения",
    saved: "сохранён",
    saving: "Сохранение",
    selectAwsAccount: "Выберите AWS аккаунт",
    soundsTab: {
      alertSoundLabel: "Звук уведомления",
      captchaSoundTooltip: "Звук при capcha",
      enableCaptchaSound: "Включить звук capcha",
      minUnit: "мин",
      selectSoundPlaceholder: "Выберите звук",
      testButton: "Тест",
      timeoutLabel: "Таймаут",
      timeoutTitle: "Таймаут capcha",
      timeoutTooltip: "Сколько ждать решения capcha",
      title: "Заголовок"
    },
    start: "СТАРТ",
    stop: "СТОП",
  }
};
