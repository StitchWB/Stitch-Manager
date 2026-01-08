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
    delete: string;
    add: string;
    edit: string;
    refresh: string;
    export: string;
    import: string;
    copy: string;
    clear: string;
    confirm: string;
    close: string;
    search: string;
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
    copied: string;
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
    notFound: string;
  };
  header: {
    systemOnline: string;
    serverOffline: string;
    notifications: string;
    noNotifications: string;
    clearAll: string;
  };
  sidebar: {
    dashboard: string;
    accounts: string;
    autoReg: string;
    idePatch: string;
    apiServer: string;
    system: string;
    settings: string;
    logs: string;
    adminUser: string;
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
  };
  accountsTable: {
    account: string;
    status: string;
    usage: string;
    expires: string;
    registrationDate: string;
    refresh: string;
    copyToken: string;
    delete: string;
    confirm: string;
    accounts: string;
    activate: string;
    deactivate: string;
    active: string;
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
    accounts: string;
    count: string;
    saving: string;
    saved: string;
    error: string;
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
  };
  dashboard: {
    title: string;
    totalAccounts: string;
    activeTokens: string;
    quotaUsage: string;
    llmServer: string;
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
    currentVersion: string;
    patchedIdes: string;
    totalBackups: string;
    ideNotDetected: string;
    configurePathInSettings: string;
    patching: string;
    unpatching: string;
    restoring: string;
    settings: string;
    strategy: string;
    logRequests: string;
  };
  settings: {
    title: string;
    subtitle: string;
    categories: {
      general: string;
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
  };
  notifications: {
    registrationComplete: string;
    accountRegistrationFinished: string;
    registrationFailed: string;
    copied: string;
    resultsCopiedToClipboard: string;
    accountActivated: string;
    accountDeactivated: string;
    activationFailed: string;
    tokenWritten: string;
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
  };
  validation: {
    required: string;
    invalidEmail: string;
    invalidUrl: string;
    invalidPort: string;
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
