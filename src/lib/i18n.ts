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
    emailStrategy: string;
    mode: string;
    imap: string;
    proxy: string;
    headless: string;
    accounts: string;
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
  };
  settings: {
    title: string;
    subtitle: string;
    categories: {
      general: string;
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
}

// ============================================
// English Translations
// ============================================

const en: Translations = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    add: 'Add',
    edit: 'Edit',
    refresh: 'Refresh',
    export: 'Export',
    import: 'Import',
    copy: 'Copy',
    clear: 'Clear',
    confirm: 'Confirm',
    close: 'Close',
    search: 'Search',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    info: 'Info',
    yes: 'Yes',
    no: 'No',
    ok: 'OK',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
    browse: 'Browse',
    select: 'Select',
    all: 'All',
    none: 'None',
    selected: 'selected',
    total: 'Total',
    actions: 'Actions',
    status: 'Status',
    settings: 'Settings',
    dismiss: 'Dismiss',
    copied: 'Copied!',
  },
  status: {
    active: 'Active',
    banned: 'Banned',
    limitHit: 'Limit',
    expired: 'Expired',
    unknown: 'Unknown',
    online: 'Online',
    offline: 'Offline',
    running: 'Running',
    stopped: 'Stopped',
    pending: 'Pending',
    processing: 'Processing',
    completed: 'Completed',
    failed: 'Failed',
    idle: 'Idle',
    patched: 'Patched',
    notPatched: 'Not Patched',
    valid: 'Valid',
    invalid: 'Invalid',
    notFound: 'Not Found',
  },
  header: {
    systemOnline: 'System Online',
    serverOffline: 'Server Offline',
    notifications: 'Notifications',
    noNotifications: 'No notifications',
    clearAll: 'Clear all',
  },
  sidebar: {
    dashboard: 'Dashboard',
    accounts: 'Accounts',
    autoReg: 'Auto-Reg',
    idePatch: 'IDE Patch',
    apiServer: 'API Server',
    system: 'System',
    settings: 'Settings',
    logs: 'Logs',
    adminUser: 'Admin User',
  },
  accounts: {
    title: 'Accounts',
    addAccount: 'Add Account',
    searchPlaceholder: 'Search...',
    refreshAll: 'Refresh All',
    exportCsv: 'Export',
    noAccounts: 'No accounts',
    noAccountsSubtitle: 'Add one to get started',
    account: 'Account',
    usage: 'Usage',
    expires: 'Expires',
    provider: 'Provider',
    email: 'Email',
    password: 'Password',
    token: 'Token',
    tokenOptional: 'optional, for manual add',
    tokenOptionalHint: 'If provided, the token will be used directly instead of logging in.',
    copyToken: 'Copy Token',
    deleteConfirm: 'Delete {count} accounts?',
    addingAccount: 'Adding...',
    filterAll: 'All',
  },
  accountsTable: {
    account: 'Account',
    status: 'Status',
    usage: 'Usage',
    expires: 'Expires',
    refresh: 'Refresh',
    copyToken: 'Copy Token',
    delete: 'Delete',
    confirm: 'Confirm',
    accounts: 'accounts',
    activate: 'Activate',
    deactivate: 'Deactivate',
    active: 'Active',
  },
  autoReg: {
    title: 'Auto Registration',
    subtitle: 'Automated account registration with browser automation',
    config: 'Config',
    liveTerminal: 'Live Terminal',
    provider: 'Provider',
    emailStrategy: 'Email Strategy',
    mode: 'Mode',
    imap: 'IMAP',
    proxy: 'Proxy',
    headless: 'Headless',
    accounts: 'Accounts',
    saving: 'Saving',
    saved: 'Saved',
    error: 'Error',
    copyResults: 'Copy results',
    exportResults: 'Export results',
    noLogs: 'No logs yet',
    noLogsSubtitle: 'Start a registration to see logs here',
    filter: 'Filter:',
    entries: 'entries',
    progress: 'Progress',
    registrationModes: {
      webview: 'WebView',
      automated: 'Automated',
      auto: 'Auto',
    },
    emailStrategies: {
      single: 'Single Email',
      plusAlias: 'Plus Alias',
      catchAll: 'Catch-All',
      pool: 'Email Pool',
    },
    results: {
      total: 'Total',
      success: 'Success',
      failed: 'Failed',
    },
  },
  dashboard: {
    title: 'Dashboard Overview',
    totalAccounts: 'Total Accounts',
    activeTokens: 'Active Tokens',
    quotaUsage: 'Quota Usage',
    llmServer: 'LLM Server',
    inactive: 'inactive',
    clickToStart: 'Click to start',
    startRegistration: 'Start Registration',
    refreshAllTokens: 'Refresh All Tokens',
    openLlmServer: 'Open LLM Server',
    startLlmServer: 'Start LLM Server',
    selectProviderBelow: 'Select a provider below',
    recentActivity: 'Recent Activity',
    lastRegistrationAttempts: 'Last registration attempts',
    viewFullActivityLog: 'View Full Activity Log',
    accountsByProvider: 'Accounts by Provider',
    noAccountsToDisplay: 'No accounts to display',
    providerSelection: 'Provider Selection',
    manageProviders: 'Manage Providers',
    systemReady: 'System Ready',
    noRecentActivity: 'No recent registration activity',
    noProviderSelected: 'No Provider Selected',
    selectProviderFirst: 'Please select a provider first',
    registrationStarted: 'Registration Started',
    registrationFailed: 'Registration Failed',
    across: 'Across',
    providers: 'providers',
    port: 'Port',
  },
  server: {
    title: 'LLM API Server',
    subtitle: 'OpenAI-compatible API endpoint',
    serverControl: 'Server Control',
    manageLocalServer: 'Manage the local LLM API server',
    endpoint: 'Endpoint',
    copyUrl: 'Copy URL',
    openInBrowser: 'Open in Browser',
    configuration: 'Configuration',
    stopServerToEdit: 'Stop server to edit',
    port: 'Port',
    host: 'Host',
    maxConnections: 'Max Connections',
    timeout: 'Timeout (ms)',
    loadBalancing: 'Load Balancing',
    loadBalancingOptions: {
      roundRobin: 'Round Robin',
      leastConnections: 'Least Connections',
      random: 'Random',
    },
    stats: {
      uptime: 'Uptime',
      requests: 'Requests',
      connections: 'Connections',
      latency: 'Latency',
    },
    tabs: {
      liveLogs: 'Live Logs',
      apiUsage: 'API Usage',
    },
    logs: {
      waitingForLogs: 'Waiting for logs...',
      startServerToSeeLogs: 'Start the server to see logs',
    },
    api: {
      chatCompletions: 'Chat Completions',
      streamingResponse: 'Streaming Response',
      pythonExample: 'Python Example',
    },
    live: 'Live',
    poll: 'Poll',
  },
  patcher: {
    title: 'IDE Patcher Module',
    subtitle: 'Manage IDE patches and extensions',
    detectedIdes: 'Detected IDEs',
    scanDescription: 'Scan your system to detect installed IDEs and manage patches',
    backupOnPatch: 'Backup on patch',
    restoreOnUnpatch: 'Restore on unpatch',
    scanForIdes: 'Scan for IDEs',
    scanning: 'Scanning...',
    scanningForIdes: 'Scanning for installed IDEs...',
    noIdesDetected: 'No IDEs detected. Click "Scan for IDEs" to search your system.',
    applyPatch: 'Apply Patch',
    removePatch: 'Remove Patch',
    backups: 'Backups',
    backup: 'backup',
    allIdes: 'All IDEs',
    loadingBackups: 'Loading backups...',
    noBackups: 'No backups available',
    noBackupsForIde: 'No backups for selected IDE',
    backupsCreatedWhenPatching: 'Backups are created when patching IDEs',
    restore: 'Restore',
    patchInformation: 'Patch Information',
    currentVersion: 'Current Version',
    patchedIdes: 'Patched IDEs',
    totalBackups: 'Total Backups',
    ideNotDetected: 'IDE not detected. Configure path in Settings.',
    configurePathInSettings: 'Configure path in Settings',
    patching: 'Patching',
    unpatching: 'Unpatching',
    restoring: 'Restoring',
  },
  settings: {
    title: 'Settings',
    subtitle: 'Configure application preferences',
    categories: {
      general: 'General',
      imap: 'IMAP',
      proxy: 'Proxy',
      idePaths: 'IDE Paths',
      database: 'Database',
    },
    general: {
      appearance: 'Appearance',
      appearanceDescription: 'Choose your preferred theme for the application.',
      light: 'Light',
      dark: 'Dark',
      system: 'System',
      language: 'Language',
      languageDescription: 'Choose your preferred language for the interface.',
    },
    imap: {
      title: 'IMAP Configuration',
      description: 'Configure your email server for account verification.',
      server: 'IMAP Server',
      port: 'Port',
      emailAddress: 'Email Address',
      password: 'Password',
    },
    proxy: {
      title: 'Proxy Settings',
      description: 'Configure proxy for network requests.',
      enableProxy: 'Enable Proxy',
      proxyUrl: 'Proxy URL',
      proxyUrlHint: 'Supports HTTP, HTTPS, and SOCKS5 proxies.',
    },
    idePaths: {
      title: 'IDE Extension Paths',
      description: 'Manually specify paths to IDE extension folders if auto-detection doesn\'t work.',
      pathExample: 'Example: S:\\Kiro\\resources\\app\\extensions\\kiro.kiro-agent',
    },
    database: {
      title: 'Database',
      description: 'Database information and management.',
      location: 'Location',
      type: 'Type',
      sqliteDescription: 'SQLite database for storing accounts and settings.',
      exportData: 'Export Data',
      importData: 'Import Data',
    },
    loadingSettings: 'Loading settings...',
    saveSettings: 'Save Settings',
    settingsSaved: 'Settings saved successfully',
    failedToSave: 'Failed to save',
  },
  logs: {
    title: 'Application Logs',
    subtitle: 'View and manage application logs',
    refresh: 'Refresh',
    export: 'Export',
    clear: 'Clear',
    allLevels: 'All Levels',
    info: 'Info',
    warning: 'Warning',
    error: 'Error',
    debug: 'Debug',
    searchPlaceholder: 'Search logs...',
    time: 'Time',
    level: 'Level',
    source: 'Source',
    message: 'Message',
    noLogs: 'No logs to display',
    showing: 'Showing',
    of: 'of',
    entries: 'entries',
    lastUpdated: 'Last updated:',
  },
  notifications: {
    registrationComplete: 'Registration Complete',
    accountRegistrationFinished: 'Account registration finished',
    registrationFailed: 'Registration Failed',
    copied: 'Copied',
    resultsCopiedToClipboard: 'Results copied to clipboard',
    accountActivated: 'Account Activated',
    accountDeactivated: 'Account Deactivated',
    activationFailed: 'Activation Failed',
    tokenWritten: 'Token written to Kiro',
  },
  time: {
    justNow: 'Just now',
    minutesAgo: '{count}m ago',
    hoursAgo: '{count}h ago',
    daysAgo: '{count}d ago',
    monthsAgo: '{count}mo ago',
    inMinutes: 'in {count}m',
    inHours: 'in {count}h',
    inDays: 'in {count}d',
    inMonths: 'in {count}mo',
    soon: 'soon',
    now: 'Now',
  },
  validation: {
    required: 'This field is required',
    invalidEmail: 'Please enter a valid email address',
    invalidUrl: 'Please enter a valid URL',
    invalidPort: 'Please enter a valid port number',
  },
};

// ============================================
// Translations Registry
// ============================================

import { ru } from './locales/ru';

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

export { en };
export default { translations, t, tt, getLocale, setLocale };
