/**
 * Internationalization (i18n) module for the Stitch Manager application.
 * Provides type-safe localization with English translations.
 */

// ============================================
// Type Definitions
// ============================================

export interface Translations {
  common: {
    save: string;
    cancel: string;
    close: string;
    confirm: string;
    delete: string;
    add: string;
    edit: string;
    search: string;
    refresh: string;
    export: string;
    import: string;
    loading: string;
    error: string;
    success: string;
    warning: string;
    info: string;
    yes: string;
    no: string;
    ok: string;
    back: string;
    next: string;
    previous: string;
    start: string;
    stop: string;
    restart: string;
    browse: string;
    select: string;
    all: string;
    none: string;
    selected: string;
    total: string;
    actions: string;
    status: string;
    settings: string;
    dismiss: string;
    cleared: string;
    clear: string;
    copy: string;
    preview: string;
  };

  status: {
    active: string;
    banned: string;
    limitHit: string;
    expired: string;
    unknown: string;
    online: string;
    offline: string;
    running: string;
    stopped: string;
    pending: string;
    processing: string;
    completed: string;
    failed: string;
    idle: string;
    patched: string;
    notPatched: string;
    valid: string;
    invalid: string;
    notConfigured: string;
    notFound: string;
  };
  header: {
    systemOnline: string;
    serverOffline: string;
    notifications: string;
    noNotifications: string;
    clearAll: string;
    changeLanguage: string;
    notificationsList: string;
    selectLanguage: string;
  };
  sidebar: {
    dashboard: string;
    accounts: string;
    autoReg: string;
    idePatch: string;
    apiServer: string;
    chat: string;
    system: string;
    settings: string;
    logs: string;
    adminUser: string;
    localMode: string;
  };
  accounts: {
    title: string;
    addAccount: string;
    searchPlaceholder: string;
    refreshAll: string;
    exportCsv: string;
    noAccounts: string;
    noAccountsSubtitle: string;
    account: string;
    usage: string;
    expires: string;
    provider: string;
    email: string;
    password: string;
    token: string;
    tokenOptional: string;
    tokenOptionalHint: string;
    copyToken: string;
    deleteConfirm: string;
    addingAccount: string;
    filterAll: string;
    tokenCopied: string;
    emailCopied: string;
    jsonCopied: string;
    accountsSelected: string;
    noAccountsFound: string;
    addFirstAccount: string;
    syncComplete: string;
    syncPartial: string;
    syncing: string;
    tagPlaceholder: string;
    select: string;

    deselect: string;
    selectAll: string;
    deselectAll: string;
    activate: string;
    deactivate: string;
    moreActions: string;
    tableRegion: string;
    accountsTable: string;
    accountActions: string;
    pagination: string;
    previousPage: string;
    nextPage: string;
    providers: string;
    allAccounts: string;
    awsBuilderId: string;
    statusHeader: string;
    // Account Drawer

    accountDetails: string;
    inUse: string;
    usageQuota: string;
    liveStatus: string;
    checkNow: string;
    checking: string;
    plan: string;
    quotaUsage: string;
    flowCredits: string;
    rawData: string;
    copyJson: string;
    created: string;
    authToken: string;
    lastUsed: string;
    importToken: string;
    importing: string;
    pasteTokenHere: string;
    noToken: string;
    clickCheckNow: string;
    clearSelection: string;
    // Machine ID Management
    machineId: string;
    machineIdCopied: string;
    notAssigned: string;
    activations: string;
    logins: string;
    successRate: string;
    registrationInfo: string;
    registrationMethod: string;
    registrationDate: string;
    registrationMetadata: string;
    browserProfilePath: string;
    sessionData: string;
    notes: string;
    tags: string;
    lastLoginAt: string;
    accountRegion: string;
    lastError: string;
    errorCount: string;
    // Health status
    healthGood: string;
    healthFair: string;
    healthPoor: string;
    // Confirmation dialogs
    deleteAccountTitle: string;
    deleteAccountMessage: string;
    deleteBulkTitle: string;
    deleteBulkMessage: string;
    deleteBulkPreview: string;
    confirmDelete: string;
    deleting: string;
    expiredWarning: string;
    refreshAllExpired: string;
    noAccountsFoundDesc: string;
  };

  accountsTable: {
    account: string;
    status: string;
    usage: string;
    expires: string;
    registrationDate: string;
    created: string;
    refresh: string;
    copyToken: string;
    delete: string;
    confirm: string;
    accounts: string;
    activate: string;
    deactivate: string;
    active: string;
    last: string;
    checkStatus: string;
    loading: string;
    noAccounts: string;
    uses: string;
    lastLogin: string;
    success: string;
    openBrowser: string;
  };

  autoReg: {
    title: string;
    subtitle: string;
    config: string;
    liveTerminal: string;
    provider: string;
    selectProvider: string;
    emailStrategy: string;
    mode: string;
    imap: string;
    imapSettings: string;
    proxy: string;
    proxySettings: string;
    headless: string;
    headlessDescription: string;
    accounts: string;
    count: string;
    identitySystem: string;
    emailGeneration: string;
    ready: string;
    customDomain: string;
    gmailAlias: string;
    masterGmail: string;
    aliasPattern: string;
    counter: string;
    rnd: string;
    time: string;
    name: string;
    clickToRefresh: string;
    appPassword: string;
    testConnection: string;
    appPasswordHint: string;
    network: string;
    networkSettings: string;
    proxyEnabled: string;
    proxyUrl: string;
    useProxy: string;
    username: string;
    directConnection: string;
    proxyUrlRequired: string;
    imapCredentials: string;
    host: string;
    port: string;
    emailPattern: string;
    paymentMethod: string;
    billingInformation: string;
    phoneVerification: string;
    smsService: string;
    placeholders: {
      gmailEmail: string;
      gmailAlias: string;
      prefix: string;
      imapHost: string;
      email: string;
      proxyUrl: string;
      optional: string;
    };
    staticAliasWarning: string;
    saving: string;
    saved: string;
    saveFailed: string;
    error: string;
    testing: string;
    connected: string;
    connectionFailed: string;
    success: string;
    retry: string;
    copyResults: string;
    exportResults: string;
    noLogs: string;
    noLogsSubtitle: string;
    filter: string;
    entries: string;
    progress: string;
    startRegistration: string;
    stopRegistration: string;
    registrationHistory: string;
    noHistory: string;
    comingSoon: string;
    step: string;
    start: string;
    stop: string;
    readyToStart: string;
    configureMailFirst: string;
    consoleOutput: string;
    liveRegistrationLogs: string;
    speed: string;
    slow: string;
    fast: string;
    delay: string;
    timeouts: string;
    verification: string;
    oauth: string;
    allowAccess: string;
    pageLoad: string;
    elementWait: string;
    imapPoll: string;
    behavior: string;
    passwordLength: string;
    realisticTyping: string;
    humanDelays: string;
    screenshots: string;
    registrationModes: {
      webview: string;
      automated: string;
      auto: string;
    };
    emailStrategies: {
      single: string;
      plusAlias: string;
      catchAll: string;
      pool: string;
    };
    strategies: {
      single: string;
      plusAlias: string;
      catchAll: string;
      pool: string;
    };
    results: {
      total: string;
      success: string;
      failed: string;
    };
    tooltips: {
      verification: string;
      oauth: string;
      allowAccess: string;
      pageLoad: string;
      elementWait: string;
      imapPoll: string;
      speed: string;
      delay: string;
      passwordLength: string;
      realisticTyping: string;
      humanDelays: string;
      screenshots: string;
    };
    emailAliases: string;
    configureAddyio: string;
    configure33mail: string;

    addyio: {
      title: string;
      subtitle: string;
      testConnection: string;
      testing: string;
      connectionSuccess: string;
      connectionError: string;
      accountStatus: string;
      subscription: string;
      activeAliases: string;
      recipients: string;
      bandwidth: string;
      domain: string;
      domainPlaceholder: string;
      domainHint: string;
      domainHintLoaded: string;
      recipient: string;
      recipientPlaceholder: string;
      recipientHint: string;
      aliasFormat: string;
      formatUuid: string;
      formatWords: string;
      formatChars: string;
      descriptionTemplate: string;
      descriptionPlaceholder: string;
      descriptionHint: string;
      fromName: string;
      fromNamePlaceholder: string;
      fromNameHint: string;
      autoDelete: string;
      howItWorks: string;
    };
  };
  dashboard: {
    title: string;
    totalAccounts: string;
    activeTokens: string;
    quotaUsage: string;
    llmServer: string;
    accountsNearLimit: string;
    clickToFilter: string;
    allAccountsHealthy: string;
    inactive: string;
    clickToStart: string;
    startRegistration: string;
    refreshAllTokens: string;
    openLlmServer: string;
    startLlmServer: string;
    selectProviderBelow: string;
    recentActivity: string;
    lastRegistrationAttempts: string;
    viewFullActivityLog: string;
    accountsByProvider: string;
    noAccountsToDisplay: string;
    noDataToDisplay: string;
    providerSelection: string;
    manageProviders: string;
    systemReady: string;
    noRecentActivity: string;
    noProviderSelected: string;
    selectProviderFirst: string;
    registrationStarted: string;
    registrationFailed: string;
    across: string;
    providers: string;
    port: string;
    activityCleared: string;
    clearActivityLog: string;
    failedToClearActivity: string;
  };
  server: {
    title: string;
    subtitle: string;
    serverControl: string;
    manageLocalServer: string;
    endpoint: string;
    copyUrl: string;
    openInBrowser: string;
    configuration: string;
    stopServerToEdit: string;
    port: string;
    host: string;
    maxConnections: string;
    timeout: string;
    loadBalancing: string;
    loadBalancingOptions: {
      roundRobin: string;
      leastConnections: string;
      random: string;
    };
    stats: {
      uptime: string;
      requests: string;
      connections: string;
      latency: string;
      status: string;
    };
    tabs: {
      liveLogs: string;
      apiUsage: string;
      tokenPool: string;
    };
    logs: {
      waitingForLogs: string;
      startServerToSeeLogs: string;
    };
    api: {
      chatCompletions: string;
      streamingResponse: string;
      pythonExample: string;
    };
    live: string;
    poll: string;
    // Coming Soon banner
    comingSoon: string;
    comingSoonDescription: string;
    simulatedMode: string;
    simulatedModeDescription: string;
    notAvailable: string;
    startFailed: string;
    stopFailed: string;
    restartFailed: string;
    saveConfigFailed: string;
  };
  patcher: {
    title: string;
    subtitle: string;
    detectedIdes: string;
    scanDescription: string;
    backupOnPatch: string;
    restoreOnUnpatch: string;
    scanForIdes: string;
    scanning: string;
    scanningForIdes: string;
    noIdesDetected: string;
    applyPatch: string;
    removePatch: string;
    backups: string;
    backup: string;
    allIdes: string;
    loadingBackups: string;
    noBackups: string;
    noBackupsForIde: string;
    backupsCreatedWhenPatching: string;
    restore: string;
    patchInformation: string;
    information: string;
    patchSettings: string;
    currentVersion: string;
    patchedIdes: string;
    totalBackups: string;
    ideNotDetected: string;
    configurePathInSettings: string;
    patching: string;
    unpatching: string;
    restoring: string;
    settings: string;
    settingsMenu: string;
    advancedSettings: string;
    strategy: string;
    patchFailed: string;
    patchTraeFailed: string;
    unpatchFailed: string;
    restoreFailed: string;
    deleteFailed: string;
    // Patch options
    patchOptions: string;
    patchVersion: string;
    globalSettings: string;
    machineIdSpoofing: string;
    machineIdSpoofingDesc: string;
    blockTelemetry: string;
    blockTelemetryDesc: string;
    bypassRateLimits: string;
    bypassRateLimitsDesc: string;
    osSpoofing: string;
    osSpoofingDesc: string;
    commandSpoofing: string;
    commandSpoofingDesc: string;
    constantPatching: string;
    constantPatchingDesc: string;
    authWatcher: string;
    authWatcherDesc: string;
    customPrompts: string;
    customPromptsDesc: string;
    requestSpy: string;
    requestSpyDesc: string;
    errorSuppression: string;
    errorSuppressionDesc: string;
    unlockPro: string;
    unlockProDesc: string;
    removeWatermark: string;
    removeWatermarkDesc: string;
    // Trae
    traeProPatch: string;
    traeProFull: string;
    traeProDescription: string;
    traeNotInstalled: string;
    traeFullPatch: string;
    traeStorage: string;
    traeExtension: string;
    traeWorkbench: string;
    traePro: string;
    traeFree: string;
    traePatched: string;
    traeOriginal: string;
  };
  settings: {
    title: string;
    subtitle: string;
    categories: {
      general: string;
      automation: string;
      connectivity: string;
      patcher: string;
      tokenPool: string;
      imap: string;
      proxy: string;
      idePaths: string;
      database: string;
    };
    general: {
      appearance: string;
      appearanceDescription: string;
      light: string;
      dark: string;
      system: string;
      language: string;
      languageDescription: string;
      uiScale: string;
      uiScaleDescription: string;
      scale: string;
      scaleSmall: string;
      scaleLarge: string;
      scaleReset: string;
    };

    imap: {
      title: string;
      description: string;
      server: string;
      port: string;
      emailAddress: string;
      password: string;
    };
    proxy: {
      title: string;
      description: string;
      enableProxy: string;
      proxyUrl: string;
      proxyUrlHint: string;
    };
    idePaths: {
      title: string;
      description: string;
      pathExample: string;
    };
    database: {
      title: string;
      description: string;
      location: string;
      type: string;
      sqliteDescription: string;
      exportData: string;
      importData: string;
    };
    loadingSettings: string;
    saveSettings: string;
    settingsSaved: string;
    failedToSave: string;
    loadFailed: string;
    folderDialogFailed: string;
    patcher: {
      title: string;
      description: string;
      autoRotate: string;
      autoRotateDescription: string;
      spoofMachineId: string;
      spoofMachineIdDescription: string;
      note: string;
      noteDescription: string;
    };
  };
  logs: {
    title: string;
    subtitle: string;
    refresh: string;
    export: string;
    clear: string;
    allLevels: string;
    info: string;
    warning: string;
    error: string;
    debug: string;
    success: string;
    searchPlaceholder: string;
    time: string;
    level: string;
    source: string;
    message: string;
    noLogs: string;
    showing: string;
    of: string;
    entries: string;
    lastUpdated: string;
    allSources: string;
    resetFilters: string;
    loadMore: string;
    scrollHint: string;
    clearConfirmTitle: string;
    clearConfirmMessage: string;
    clearLogs: string;
  };
  notifications: {
    registrationComplete: string;
    registrationFailed: string;
    copied: string;
    resultsCopiedToClipboard: string;
    accountActivated: string;
    accountDeactivated: string;
    activationFailed: string;
    tokenWritten: string;
    accountAdded: string;
    addFailed: string;
    refreshFailed: string;
    refreshComplete: string;
    deleteFailed: string;
  };
  time: {
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysAgo: string;
    monthsAgo: string;
    inMinutes: string;
    inHours: string;
    inDays: string;
    inMonths: string;
    soon: string;
    now: string;
    never: string;
  };
  validation: {
    required: string;
    invalidEmail: string;
    invalidUrl: string;
    invalidPort: string;
    invalidHostname: string;
    testConnection: string;
    testing: string;
    connectionSuccess: string;
    connectionFailed: string;
  };
  quickSwitch: {
    title: string;
    active: string;
    noActiveAccounts: string;
    deactivate: string;
    noActiveAccount: string;
    clickProviderTab: string;
    activeAccountsPerProvider: string;
    activationFailed: string;
  };
  tokenPool: {
    // Tab and titles
    title: string;
    subtitle: string;

    // Stats
    totalTokens: string;
    available: string;
    banned: string;
    quotaLeft: string;

    // Current token section
    currentToken: string;
    noActiveToken: string;
    forceSwitch: string;

    // Token list
    allTokens: string;
    noTokensInPool: string;
    active: string;
    refreshToken: string;
    refreshAll: string;
    reloadPool: string;

    // Token status
    statusAvailable: string;
    statusBanned: string;
    statusExpired: string;
    statusLowQuota: string;
    statusWarning: string;

    // Events
    recentEvents: string;
    noRecentEvents: string;
    clearEvents: string;

    // Event types
    eventSwitched: string;
    eventQuotaLow: string;
    eventTokenError: string;
    eventTokenBanned: string;
    eventRefreshed: string;
    eventTokenUsed: string;

    // Token details
    quota: string;
    reset: string;
    requests: string;
    errors: string;
    region: string;
    unknown: string;
    expired: string;
    lowQuota: string;
    warning: string;

    // Tooltips
    forceSwitchTooltip: string;
    refreshTokenTooltip: string;
    refreshAllTooltip: string;
    reloadPoolTooltip: string;
    clearEventsTooltip: string;
  };
  liveStatus: {
    idle: string;
    processing: string;
    connecting: string;
    scanningInbox: string;
    launchingBrowser: string;
    navigating: string;
    typingEmail: string;
    typingPassword: string;
    typingCode: string;
    waitingCode: string;
    verifying: string;
    gettingToken: string;
    success: string;
    error: string;
    clickToStart: string;
    configureFirst: string;
  };
  successCard: {
    accountCreated: string;
    token: string;
    copyEmail: string;
    copyToken: string;
  };
  logFeed: {
    activityLog: string;
    waitingForActivity: string;
    debug: string;
    authTokenData: string;
    copied: string;
  };
  terminal: {
    liveFeed: string;
    readyToLaunch: string;
    logsWillAppear: string;
    debugDetails: string;
  };
  settingsTokenPool: {
    changesWillBeSaved: string;
    switchStrategy: string;
    switchStrategyDescription: string;
    strategyThresholds: string;
    strategyThresholdsDescription: string;
    behavior: string;
    behaviorDescription: string;
    autoRefresh: string;
    autoRefreshDescription: string;
    strategies: {
      aggressive: string;
      aggressiveDescription: string;
      balanced: string;
      balancedDescription: string;
      conservative: string;
      conservativeDescription: string;
      custom: string;
      customDescription: string;
    };
    customThreshold: string;
    tokensRemaining: string;
    tokens: string;
    switchOnError: string;
    switchOnErrorDescription: string;
    switchOnRateLimit: string;
    switchOnRateLimitDescription: string;
    maxErrorsBeforeBan: string;
    maxErrorsBeforeBanDescription: string;
    cooldownPeriod: string;
    cooldownPeriodDescription: string;
    minutes: string;
    enableAutoRefresh: string;
    enableAutoRefreshDescription: string;
    refreshBeforeExpiry: string;
    refreshBeforeExpiryDescription: string;
    currentStrategy: string;
    activeTokens: string;
    totalQuotaRemaining: string;
    requestsUnit: string;
    unsavedChanges: string;
    saveNow: string;
    default: string;
    saveFailed: string;
  };
  timeline: {
    init: string;
    mail: string;
    browser: string;
    auth: string;
    verify: string;
    token: string;
    done: string;
  };
  commandPalette: {
    placeholder: string;
    noResults: string;
    navigation: string;
    actions: string;
    refreshAllAccounts: string;
  };
  notFoundPage: {
    title: string;
    description: string;
    goHome: string;
  };
  filters: {
    any: string;
    anyStatus: string;
    active: string;
    banned: string;
    limitHit: string;
    anyQuota: string;
    hasQuota: string;
    empty: string;
    full: string;
    lowQuota: string;
    status: string;
    quota: string;
    minRemaining: string;
    reset: string;
    done: string;
    pcs: string;
    registrationMethod: string;
    all: string;
    manual: string;
    auto: string;
    oauth: string;
    unknown: string;
    health: string;
    good: string;
    fair: string;
    poor: string;
  };

  usageBar: {
    errorBanned: string;
    unlimited: string;
    used: string;
  };
  chat: {
    title: string;
    subtitle: string;
    placeholder: string;
    clear: string;
    settings: string;
    error: string;
    retry: string;
    apiUrl: string;
    model: string;
    emptyTitle: string;
    emptyDescription: string;
    you: string;
    assistant: string;
    thinking: string;
    typing: string;
  };
  kiroPatch: {
    title: string;
    subtitle: string;
    statusTitle: string;
    statusDescription: string;
    statusInstalled: string;
    statusNotInstalled: string;
    statusChecking: string;
    machineIdTitle: string;
    machineIdDescription: string;
    currentMachineId: string;
    defaultMachineId: string;
    accountSpecificId: string;
    generateNew: string;
    importFromFile: string;
    copyId: string;
    idCopied: string;
    bindingsTitle: string;
    bindingsDescription: string;
    bindingsEmpty: string;
    bindingsEmptyHint: string;
    accountId: string;
    machineId: string;
    bindNewAccount: string;
    unbind: string;
    currentAccount: string;
    bindModalTitle: string;
    bindModalAccountId: string;
    bindModalAccountIdPlaceholder: string;
    bindModalMachineId: string;
    bindModalMachineIdPlaceholder: string;
    bindModalGenerate: string;
    bindModalBind: string;
    bindModalCancel: string;
    modulesTitle: string;
    modulesDescription: string;
    machineIdSpoofing: string;
    machineIdSpoofingDesc: string;
    telemetryBlocking: string;
    telemetryBlockingDesc: string;
    rateLimitBypass: string;
    rateLimitBypassDesc: string;
    errorSuppression: string;
    errorSuppressionDesc: string;
    osSpoofing: string;
    osSpoofingDesc: string;
    commandSpoofing: string;
    commandSpoofingDesc: string;
    authWatcher: string;
    authWatcherDesc: string;
    constantPatching: string;
    constantPatchingDesc: string;
    customPrompts: string;
    customPromptsDesc: string;
    requestSpy: string;
    requestSpyDesc: string;
    logLevelTitle: string;
    logLevelDescription: string;
    logLevelDebug: string;
    logLevelInfo: string;
    logLevelWarn: string;
    logLevelError: string;
    applyPatch: string;
    applyPatchDesc: string;
    saveConfig: string;
    saveConfigDesc: string;
    removePatch: string;
    removePatchDesc: string;
    resetDefaults: string;
    resetDefaultsDesc: string;
    applySuccess: string;
    applyError: string;
    saveSuccess: string;
    saveError: string;
    removeSuccess: string;
    removeError: string;
    resetSuccess: string;
    bindSuccess: string;
    bindError: string;
    unbindSuccess: string;
    unbindError: string;
    generateSuccess: string;
    confirmRemove: string;
    confirmReset: string;
    confirmUnbind: string;
    advancedTitle: string;
    advancedSubtitle: string;
    constantsTitle: string;
    writeLimit: string;
    maxTokens: string;
    promptEditorTitle: string;
    copyDefaults: string;
    collapse: string;
    expand: string;
    loadError: string;
  };
}

// ============================================
// Translations Registry
// ============================================

import { ru } from './locales/ru';
import { en } from './locales/en';

export const translations: Record<string, Translations> = {
  en,
  ru,
};

// ============================================
// State Management
// ============================================

let currentLocale = 'en';

/**
 * Get the current locale
 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * Set the current locale
 * @param locale - The locale code (e.g., 'en', 'ru', 'zh')
 */
export function setLocale(locale: string): void {
  if (translations[locale]) {
    currentLocale = locale;
  } else {
    console.warn(`Locale "${locale}" not found, falling back to "en"`);
    currentLocale = 'en';
  }
}

// ============================================
// Translation Helper Function
// ============================================

/**
 * Get a translation by dot-notation key path
 * @param key - Dot-notation path to the translation (e.g., 'accounts.title')
 * @param params - Optional parameters for interpolation (e.g., { count: 5 })
 * @returns The translated string or the key if not found
 *
 * @example
 * t('common.save') // Returns 'Save'
 * t('accounts.deleteConfirm', { count: 5 }) // Returns 'Delete 5 accounts?'
 * t('time.minutesAgo', { count: 10 }) // Returns '10m ago'
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const keys = key.split('.');
  let value: unknown = translations[currentLocale];

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      console.warn(`Translation key "${key}" not found for locale "${currentLocale}"`);
      return key;
    }
  }

  if (typeof value !== 'string') {
    console.warn(`Translation key "${key}" does not resolve to a string`);
    return key;
  }

  // Handle parameter interpolation
  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, paramKey) => {
      return params[paramKey]?.toString() ?? `{${paramKey}}`;
    });
  }

  return value;
}

// ============================================
// Type-safe Translation Keys Helper
// ============================================

type PathsToStringProps<T> = T extends string
  ? []
  : {
      [K in Extract<keyof T, string>]: [K, ...PathsToStringProps<T[K]>];
    }[Extract<keyof T, string>];

type Join<T extends string[], D extends string> = T extends []
  ? never
  : T extends [infer F]
    ? F
    : T extends [infer F, ...infer R]
      ? F extends string
        ? `${F}${D}${Join<Extract<R, string[]>, D>}`
        : never
      : string;

export type TranslationKey = Join<PathsToStringProps<Translations>, '.'>;

/**
 * Type-safe translation function
 * Use this when you want TypeScript to validate your translation keys
 */
export function tt(key: TranslationKey, params?: Record<string, string | number>): string {
  return t(key, params);
}

// ============================================
// Exports
// ============================================

export default { translations, t, tt, getLocale, setLocale };
