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
    retry: string;
    saved: string;
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
    record: string;
    replay: string;
    more: string;
    installRuntime: string;
    install: string;
    name: string;
    history: string;
    rollback: string;
    expand: string;
    collapse: string;
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
    scheduler: string;
    idePatch: string;
    aiHub: string;
    apiServer: string;
    mail: string;
    chat: string;
    scenarios: string;
    system: string;
    settings: string;
    logs: string;
    adminUser: string;
    localMode: string;
  };

  mail: {
    title: string;
    subtitle: string;
    navigationTitle: string;
    sourceLabel: string;
    sourceImap: string;
    sourceMailTm: string;
    accountIdLabel: string;
    mailboxLabel: string;
    connect: string;
    connecting: string;
    disconnect: string;
    sessionActive: string;
    sessionIdle: string;
    foldersTitle: string;
    foldersDisconnectedHint: string;
    folderInbox: string;
    folderSent: string;
    folderDrafts: string;
    folderAllMail: string;
    folderSpam: string;
    folderTrash: string;
    sourceExtensionsTitle: string;
    sourceExtensionsPlaceholder: string;
    profilesTitle: string;
    profilesLoading: string;
    noProfilesYet: string;
    activeProfileLabel: string;
    manualProfileMode: string;
    renameProfileLabel: string;
    renameProfileAction: string;
    renameProfileDialogTitle: string;
    renameProfileDialogDescription: string;
    deleteProfileAction: string;
    deleteProfileDialogTitle: string;
    deleteProfileDialogDescription: string;
    profileSyncUnknown: string;
    profileSyncIdle: string;
    profileSyncSyncing: string;
    profileSyncError: string;
    providerHost: string;
    providerPort: string;
    providerUsername: string;
    providerPassword: string;
    providerUseTls: string;
    providerAddress: string;
    providerBaseUrl: string;
    manualConnectionAction: string;
    manualConnectionTitle: string;
    manualConnectionDescription: string;
    readOnlyHint: string;
    syncTitle: string;
    syncExpand: string;
    syncCollapse: string;
    fromLabel: string;
    toLabel: string;
    subjectLabel: string;
    bodyLabel: string;
    unreadOnly: string;
    sinceLabel: string;
    limitLabel: string;
    timeoutLabel: string;
    pollIntervalLabel: string;
    dedupeKeyLabel: string;
    listAction: string;
    waitAction: string;
    waitingAction: string;
    toolbarSearchPlaceholder: string;
    keyboardHint: string;
    lastSyncLabel: string;
    capabilitiesTitle: string;
    capabilityDelete: string;
    capabilityMarkAsRead: string;
    capabilitySearchBody: string;
    capabilityAttachments: string;
    selectedCountLabel: string;
    selectAllLabel: string;
    clearSelectionAction: string;
    bulkMarkReadAction: string;
    bulkDeleteAction: string;
    messagesTitle: string;
    noMessagesTitle: string;
    noMessagesDescription: string;
    readStateRead: string;
    readStateUnread: string;
    markReadAction: string;
    deleteAction: string;
    viewerTitle: string;
    noSelectionTitle: string;
    noSelectionDescription: string;
    fromField: string;
    toField: string;
    ccField: string;
    bccField: string;
    receivedAtField: string;
    plainTextLabel: string;
    htmlLabel: string;
    attachmentsLabel: string;
    loadMessageAction: string;
    rawSourceTitle: string;
    rawSourceCollapsedHint: string;
    secondaryLabel: string;
    mailboxNotSelectedTitle: string;
    mailboxNotSelectedHint: string;
    openRawSourceAction: string;
    accountsRailTitle: string;
    currentSessionTitle: string;
    currentSessionEmpty: string;
    saveSessionAsProfileAction: string;
    providersCatalogTitle: string;
    providerAvailable: string;
    providerUnavailable: string;
  };

  scenarios: {
    title: string;
    subtitle: string;
    selectProfile: string;
    noProfiles: string;
    missingProfile: string;
    profileHint: string;
    emptyTitle: string;
    emptyDescription: string;
    libraryTitle: string;
    librarySubtitle: string;
    searchPlaceholder: string;
    favoritesOnly: string;
    tagsFilterLabel: string;
    viewCards: string;
    viewList: string;
    noScenarios: string;
    noScenariosHint: string;
    missingFile: string;
    stepsCount: string;
    lastPlayed: string;
    playCount: string;
    healthScore: string;
    lastRun: string;
    lastStatus: string;
    lastDuration: string;
    editScenario: string;
    duplicateScenario: string;
    toggleFavorite: string;
    openFolder: string;
    copyPath: string;
    update: string;
    description: string;
    tags: string;
    tagsHint: string;
    deleteArmedHint: string;
    deleteArmedLabel: string;
  };
  accounts: {
    title: string;
    addAccount: string;
    searchPlaceholder: string;
    refreshAll: string;
    importAccounts: string;
    exportCsv: string;
    viewList: string;
    viewGraph: string;
    viewSheets: string;
    allProviders: string;
    proxyLabel: string;
    selectedCountLabel: string;
    tokenCopiedAutoClear: string;
    tokenCopyFailed: string;
    copyTokenSensitiveConfirm: string;
    sheetsIntegration: string;
    sheetsSpreadsheetId: string;
    sheetsServiceAccountJson: string;
    sheetsExplorerTitle: string;
    loadAccountsErrorPrefix: string;
    expiredCountLabel: string;
    selectAccountAria: string;
    actionsMenuAria: string;
    profileIdLabel: string;
    columnsMenuLabel: string;
    columnsMenuTitle: string;
    columnLastLogin: string;
    columnProxy: string;
    columnTags: string;
    columnQuota: string;
    columnsReset: string;
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
    addFirstAccountToStart: string;
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
    profileSession: string;
    profileSessionReady: string;
    profileSessionPending: string;
    profileSessionDisabled: string;
    profileSessionOpen: string;
    profileSessionConfirm: string;
    profileSessionClear: string;
    profileSessionsTitle: string;
    profileSessionsSubtitle: string;
    profileSessionsSelectionHint: string;
    batchResultSummary: string;
    batchResultWithErrors: string;
    mobileTagFilterLabel: string;
    relationLabel: string;
    relationVia: string;
    relationRegisteredFor: string;
    relationCanLoginTo: string;
    relationLinkedTo: string;
    relationNoLinks: string;
    relationGraphTitle: string;
    relationQuickActionsTitle: string;
    relationLinkToKiro: string;
    relationLinkToWindsurf: string;
    relationLinkToTrae: string;
    relationMarkRegisteredForKiro: string;
    relationMarkRegisteredForWindsurf: string;
    relationMarkRegisteredForTrae: string;
    relationFilterLabel: string;
    relationFilterAll: string;
    relationFilterHasAny: string;
    relationFilterLinkedOnly: string;
    relationFilterOauthCapable: string;
    relationTagApplied: string;
    relationTagAlreadyExists: string;
    relationExistingLinksTitle: string;
    relationTagRemove: string;
    relationTagRemoved: string;
    profilesCreateButton: string;
    profileCreateSuccess: string;
    profileCreateFailed: string;
    entityFilterLabel: string;
    entityAccounts: string;
    entityProfiles: string;
    entityBrowserProfiles: string;
    entityAll: string;
    noProfilesFound: string;
    noProfilesFoundDesc: string;
    profileAlias: string;
    profileKind: string;
    profileKindStandalone: string;
    profileKindLinked: string;
    deleteProfile: string;
    deleteProfileConfirm: string;
    profileDeleteSuccess: string;
    profileDeleteFailed: string;
    openProfile: string;
    openProfileAt: string;
    profileOpenSuccess: string;
    profileOpenFailed: string;
    profileOpenTarget: string;
    profileOpenTargetCustom: string;
    profileOpenUrlPlaceholder: string;
    startAutoregFromProfile: string;
    startAutoregFromProfileDesc: string;
    startAutoregKiroViaAws: string;
    profilesFilterLabel: string;
    profilesFilterAll: string;
    profilesFilterStandalone: string;
    profilesFilterLinked: string;
    profilesFilterUsedForKiro: string;
    profileDestinationLabel: string;
    profileDestinationCustom: string;
    launchContextHintSelectAws: string;
    launchContextHintNoAwsSessionPath: string;
    profileHealthReady: string;
    profileHealthNeedsAws: string;
    profileHealthNeedsLink: string;
    profileHealthNoSession: string;
    profileSettingsTitle: string;
    profileSummaryTitle: string;
    profileHardwareTab: string;
    profileGeoTab: string;
    profileSettingsGenerateFingerprint: string;
    profileSettingsHardwareTab: string;
    profileSettingsGeoTab: string;
    profileSettingsUserAgent: string;
    profileSettingsUserAgentPlaceholder: string;
    profileSettingsProxyUrlPlaceholder: string;
    profileSettingsPlatformLabel: string;
    profileSettingsHardwareConcurrency: string;
    profileSettingsHardwareMemory: string;
    profileSettingsScreenWidth: string;
    profileSettingsScreenHeight: string;
    profileSettingsLocaleLabel: string;
    profileSettingsTimezoneLabel: string;
    profileSettingsLatitudeLabel: string;
    profileSettingsLongitudeLabel: string;
    profileSettingsNotesLabel: string;
    profileSettingsNotesPlaceholder: string;
    profileSettingsCookiesLabel: string;
    profileSettingsCookiesPlaceholder: string;
    profileSettingsSummaryTitle: string;
    profileSettingsSummaryUserAgent: string;
    profileSettingsSummaryScreen: string;
    profileSettingsUnsaved: string;
    profileSettingsSaved: string;
    profileSettingsAliasPlaceholder: string;
    profileSettingsAliasRequired: string;
    profileSettingsAliasTooLong: string;
    profileSettingsAliasInvalidChars: string;
    profileSettingsAliasInvalidNewlines: string;
    profileSettingsAliasConflict: string;
    profileSettingsDiscardTitle: string;
    profileSettingsDiscardMessage: string;
    profileSettingsDiscardConfirm: string;
    profileSettingsDeleteConfirmMessage: string;
    profileSettingsResetAllTitle: string;
    profileSettingsResetAllMessage: string;
    profileSettingsResetAllConfirm: string;
    profileSettingsExportDialogTitle: string;
    profileSettingsExportSuccess: string;
    profileSettingsExportFailed: string;
    profileSettingsImportDialogTitle: string;
    profileSettingsImportFileLabel: string;
    profileSettingsImportTargetLabel: string;
    profileSettingsImportTargetCurrent: string;
    profileSettingsImportTargetNew: string;
    profileSettingsImportNewAliasLabel: string;
    profileSettingsImportOverwriteLabel: string;
    profileSettingsImportConfirm: string;
    profileSettingsAliasMakeSafe: string;
    profileSettingsAliasMakeSafeTooltip: string;
    profileSettingsAliasMakeSafeApplied: string;
    profileSettingsImportPickFailed: string;
    profileSettingsImportSuccess: string;
    profileSettingsImportFailed: string;
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
    openingBrowser: string;
    browserOpened: string;
    browserOpenFailed: string;
    openProfileSession: string;
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
    logVerbosity: string;
    logVerbosityDescription: string;
    logVerbosityTooltip: string;
    accounts: string;
    count: string;
    identitySystem: string;
    emailGeneration: string;
    ready: string;
    customDomain: string;
    cfToImap: string;
    emailGenerationDomain: string;
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
    proxyType: string;
    proxyList: string;
    proxyListFormat: string;
    useProxy: string;
    useProxyList: string;
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
    pause: string;
    resume: string;
    readyToStart: string;
    configureMailFirst: string;
    consoleOutput: string;
    liveRegistrationLogs: string;
    pipelineSteps: string;
    stepEnabled: string;
    stepDisabled: string;
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

    pipeline: {
      resume: string;
      skip: string;
      abort: string;
      takeOver: string;
      done: string;
      paused: string;
      manual: string;
      stepWaiting: string;
      setPause: string;
      unsetPause: string;
    };

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
    urlCopied: string;
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
  aiHub: {
    tabs: {
      overview: string;
      providers: string;
      integrations: string;
      usage: string;
      diagnostics: string;
      antigravity: string;
      apiKeys: string;
    };
    sections: {
      overview: {
        title: string;
        subtitle: string;
      };
      providers: {
        title: string;
        subtitle: string;
      };
      integrations: {
        title: string;
        subtitle: string;
      };
      usage: {
        title: string;
        subtitle: string;
      };
      diagnostics: {
        title: string;
        subtitle: string;
      };
      antigravity: {
        title: string;
        subtitle: string;
      };
      apiKeys: {
        title: string;
        subtitle: string;
      };
    };
    analytics: {
      title: string;
      subtitle: string;
      loading: string;
      emptyTitle: string;
      emptyDescription: string;
      totalRequests: string;
      tokensUsed: string;
      avgDuration: string;
      estCost: string;
      weeklyActivity: string;
      modelUsage: string;
      requestsCount: string;
      tokensCount: string;
      durationMs: string;
      costValue: string;
    };
    desktopOnly: {
      actionUnavailable: string;
      proxyControlsUnavailable: string;
    };
    authScan: {
      found: string;
      failed: string;
    };
    quota: {
      title: string;
      retry: string;
      empty: string;
      unavailableTauri: string;
      usageUnavailable: string;
      refreshUsage: string;
      refreshQuotas: string;
      detected: string;
      exactLimitsUnavailable: string;
      used: string;
      left: string;
      usageTitle: string;
      totalRequests: string;
      totalTokens: string;
      topModel: string;
      noModelBreakdown: string;
      loadUsageHint: string;
      refreshing: string;
    };
    search: {
      placeholder: string;
    };
    proxy: {
      title: string;
      statusLabel: string;
      running: string;
      runningWithPort: string;
      stopped: string;
      summary: string;
      modeLabel: string;
      modeFull: string;
      modeQuota: string;
      routingLabel: string;
      routingRoundRobin: string;
      routingFillFirst: string;
      portLabel: string;
      portPlaceholder: string;
      managementKey: string;
      managementKeyPlaceholder: string;
      autoStart: string;
      baseUrl: string;
      clientApiKey: string;
      activePortLabel: string;
      keyPreviewLabel: string;
      error: string;
      unsavedChanges: string;
      errors: {
        notLoaded: string;
        invalidPort: string;
        emptyManagementKey: string;
      };
      toasts: {
        saved: string;
        saveFailed: string;
        started: string;
        stopped: string;
      };
    };
    actions: {
      addAccount: string;
      apiKeys: string;
      configureIde: string;
      import: string;
      export: string;
      openDebugChat: string;
      runMigration: string;
      openProviders: string;
      openIntegrations: string;
      openUsage: string;
      openDiagnostics: string;
      openAntigravity: string;
      openApiKeys: string;
      openAnalytics: string;
      openDetailedAnalytics: string;
      openWizard: string;
      openImport: string;
      openExport: string;
      reset: string;
      saveSettings: string;
      saving: string;
      startProxy: string;
      stopProxy: string;
      working: string;
      refresh: string;
      scanAuthFiles: string;
      scanningAuthFiles: string;
      prepareFromScan: string;
      importJson: string;
      importing: string;
      importAllFromScan: string;
      generate: string;
      generating: string;
      download: string;
      copy: string;
      addMapping: string;
      cancel: string;
      save: string;
      close: string;
      open: string;
      editMappings: string;
    };

    antigravity: {
      actions: {
        loginOAuth: string;
        refresh: string;
        openUrl: string;
        checkStatus: string;
        checking: string;
      };
      empty: {
        noCredentialsTitle: string;
        noCredentialsDescription: string;
      };
      list: {
        detectedTitle: string;
        expiresLabel: string;
        unknownExpiry: string;
      };
      modal: {
        oauthTitle: string;
        oauthInstructions: string;
        authUrlLabel: string;
      };
      toasts: {
        loginCompletedRefreshing: string;
        oauthFailedGeneric: string;
        oauthTimedOut: string;
      };
      errors: {
        scanAuthFilesFailed: string;
        startLoginFailed: string;
        oauthPollFailed: string;
      };
    };

    apiKeys: {
      loading: string;
      providers: {
        geminiDescription: string;
        openaiDescription: string;
        antigravityDescription: string;
      };
      empty: {
        title: string;
        description: string;
      };
      summary: {
        noneConfigured: string;
        configuredCount: string;
      };
      actions: {
        addKey: string;
        reveal: string;
        hide: string;
        createAccount: string;
        delete: string;
        cancel: string;
        saveKey: string;
      };
      modals: {
        addTitle: string;
        deleteTitle: string;
        deleteMessage: string;
        deleteMessageFallback: string;
        fields: {
          apiKeyLabel: string;
          baseUrlLabel: string;
          modelPrefixLabel: string;
          apiKeyPlaceholder: string;
          baseUrlPlaceholder: string;
          modelPrefixPlaceholder: string;
        };
      };
      toasts: {
        keyAdded: string;
        keyDeleted: string;
        accountAlreadyExists: string;
        accountCreated: string;
        cannotDeleteLinkedAccount: string;
      };
      errors: {
        loadFailed: string;
        apiKeyRequired: string;
        addFailed: string;
        deleteFailed: string;
        createAccountFailed: string;
      };
    };
    cards: {
      accountCoverageTitle: string;
      accountCoverageHint: string;
      modelInventoryTitle: string;
      modelInventoryHint: string;
      requestHistoryTitle: string;
      requestHistoryHint: string;
      providerCounts: string;
      last20Requests: string;
      errors: string;
    };
    readiness: {
      enabled: string;
      ready: string;
      cooldown: string;
      weeklyLimit: string;
    };
    empty: {
      modelsProxyStopped: string;
      modelsNoAccounts: string;
      modelsUnavailable: string;
      capabilities: string;
      noMappings: string;
      noAccountsFound: string;
      noAccountsHint: string;
      noAuthFiles: string;
      noExportPayload: string;
    };
    table: {
      provider: string;
      account: string;
      status: string;
      quota: string;
      today: string;
      lastUsed: string;
      actions: string;
      requestsLine: string;
      never: string;
      testConnection: string;
      edit: string;
      delete: string;
      badges: {
        cooldown: string;
        refreshError: string;
        connectionError: string;
        quotaError: string;
      };
      quotaPrimary: string;
      quotaWeekly: string;
      resetsIn: string;
      emptyValue: string;
    };
    modals: {
      transferImportTitle: string;
      transferExportTitle: string;
      transferFooter: string;
      importTitle: string;
      importDescription: string;
      importPayloadLabel: string;
      importPayloadPlaceholder: string;
      importWarningTitle: string;
      importWarningDescription: string;
      scanResultsTitle: string;
      scanReportLabel: string;
      noExpiry: string;
      expiresShort: string;
      exportTitle: string;
      exportDescription: string;
      includeSecrets: string;
      csvNoSecrets: string;
      exportFormatJson: string;
      exportFormatCsv: string;
      exportPayloadLabel: string;
      mappingsTitle: string;
      mappingPatternPlaceholder: string;
      mappingTargetPlaceholder: string;
    };
    warnings: {
      includeSecretsConfirm: string;
      copySensitiveConfirm: string;
    };
    copy: {
      empty: string;
      success: string;
      fail: string;
    };
    diagnostics: {
      toolsTitle: string;
      toolsDescription: string;
      healthTitle: string;
      healthHint: string;
      latestReason: string;
      latestReasonHint: string;
      noRecentReasons: string;
    };
    wizard: {
      title: string;
      detecting: string;
      selectDescription: string;
      proxyStoppedHint: string;
      providerProfile: string;
      noIdesTitle: string;
      noIdesHint: string;
      alreadyConfigured: string;
      previewTitle: string;
      previewHint: string;
      applying: string;
      runningAutoSmoke: string;
      errors: {
        detectFailed: string;
        previewFailed: string;
        configurationFailed: string;
        autoSmokeFailed: string;
        restoreFailed: string;
        smokeFailed: string;
        startProxyFailed: string;
        autoImportFailed: string;
      };
      smoke: {
        passed: string;
        notConfigured: string;
        proxyNotRunning: string;
        noModels: string;
      };
      results: {
        configuredVerified: string;
        configuredPending: string;
        restoredVerified: string;
        restored: string;
        smokeOk: string;
        smokeAttention: string;
      };
      actions: {
        runSmoke: string;
        restoreBackup: string;
        next: string;
        back: string;
        applyConfiguration: string;
        done: string;
      };
      nextSteps: {
        title: string;
        restartIde: string;
        ensureProxy: string;
        runSmoke: string;
        testRequest: string;
      };
      manual: {
        title: string;
        copyButton: string;
        hint: string;
        copied: string;
        copyFailed: string;
      };
      autoImport: {
        title: string;
        dryRun: string;
        importNow: string;
        hint: string;
        modeLabel: string;
        modeDryRun: string;
        modeWrite: string;
        scanned: string;
        imported: string;
        skipped: string;
        noDiscovered: string;
      };
    };
    integrations: {
      title: string;
      description: string;
      mappingsTitle: string;
      mappingsHint: string;
    };
    usage: {
      summaryTitle: string;
      summaryHint: string;
    };
    labels: {
      providers: string;
      providersHint: string;
    };
    controller: {
      importValidation: {
        payloadMustBeObject: string;
        payloadVersionRequired: string;
        payloadAccountsRequired: string;
        invalidJson: string;
      };
      confirm: {
        deleteAccount: string;
        importPayload: string;
        prepareFromScan: string;
        importAllFromScan: string;
      };
      toasts: {
        accountDeleted: string;
        accountEnabled: string;
        accountDisabled: string;
        migrationRunning: string;
        migrationCompleted: string;
        connectionOk: string;
        mappingsSaved: string;
        downloadStarted: string;
        exportGenerated: string;
        importedAccounts: string;
        importedAccountsWithSkipped: string;
        preparedImportFromScan: string;
      };
      errors: {
        loadAccountsFailed: string;
        deleteAccountFailed: string;
        updateAccountFailed: string;
        migrationFailed: string;
        connectionTestFailed: string;
        saveMappingsFailed: string;
        downloadFailed: string;
        exportFailed: string;
        importPayloadRequired: string;
        invalidImportPayload: string;
        importFailed: string;
        noScanResultsToImport: string;
      };
    };
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
      googleSheets: string;
      extension: string;
      patcher: string;
      tokenPool: string;
      imap: string;
      proxy: string;
      idePaths: string;
      database: string;
      aiProxy: string;
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
      on: string;
      off: string;
    };

    imap: {
      title: string;
      description: string;
      server: string;
      port: string;
      emailAddress: string;
      password: string;
      emailGenerationDomain: string;
    };
    proxy: {
      title: string;
      description: string;
      enableProxy: string;
      proxyUrl: string;
      proxyUrlHint: string;
    };
    emailCounter: {
      title: string;
      description: string;
      counterValue: string;
      nextRegistration: string;
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
    googleSheets: {
      title: string;
      description: string;
      spreadsheetId: string;
      spreadsheetIdHint: string;
      serviceAccountJson: string;
      testConnection: string;
      testing: string;
      initSchema: string;
      initializing: string;
      refreshDataset: string;
      refreshing: string;
      required: string;
      connectionOk: string;
      connectionOkWithWarnings: string;
      schemaInited: string;
      schemaInitedWithWarnings: string;
      datasetLoaded: string;
      securityHint: string;
    };
    extension: {
      title: string;
      description: string;
      installTitle: string;
      installStep1: string;
      installStep2: string;
      installStep3: string;
      installStep4: string;
      extensionPath: string;
      pathHint: string;
      openChromeExtensions: string;
      openExtensionFolder: string;
      copyPath: string;
      copyChecklist: string;
      checklistCopied: string;
      lastPingLabel: string;
      latencyLabel: string;
      bridgeHint: string;
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
    channel: string;
    source: string;
    message: string;
    noLogs: string;
    showing: string;
    of: string;
    entries: string;
    lastUpdated: string;
    allSources: string;
    allChannels: string;
    selectAllSources: string;
    sourceCountSelected: string;
    filtersApplied: string;
    presetOnlyErrors: string;
    presetPythonRunner: string;
    presetRegistration: string;
    groupByStage: string;
    autoCollapseSuccess: string;
    expandAll: string;
    collapseAll: string;
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
    warning: string;
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

  automation: {
    title: string;
    healthReplenishment: string;
    healthReplenishmentDesc: string;
    enableReplenishment: string;
    enableReplenishmentDesc: string;
    minActiveAccounts: string;
    minActiveAccountsTooltip: string;
    registrationStrategies: string;
    registrationStrategiesDesc: string;
    kiroStrategy: string;
    windsurfStrategy: string;
    traeStrategy: string;
    rotationRules: string;
    rotationRulesDesc: string;
    legacySettings: string;
    legacyAutoSwitching: string;
    checkInterval: string;
    proxyPort: string;
    switchThreshold: string;
    maxErrors: string;
    cooldown: string;
    rateLimitTrigger: string;
    rateLimitTriggerDesc: string;
    minSpareAccounts: string;
    replenishment: string;
    providerConfig: string;
  };

  recorder: {
    started: string;
    stopping: string;
    saved: string;
    runtimeMissing: string;
    failed: string;
    noSavedScenarioPath: string;
    proxySwitchRestartWarningRecord: string;
    proxySwitchRestartWarningReplay: string;
    recordWithoutOverlayLabel: string;
    recordWithoutOverlayDescription: string;
    fieldCapturePrivacyNote: string;
    extensionRunnerBridgeHint: string;
    extensionBridgeStatusLabel: string;
    extensionBridgeConnected: string;
    extensionBridgeDisconnected: string;
    extensionBridgeChecking: string;
    extensionBridgeRefresh: string;
    replay: {
      profile: string;
      statusLabel: string;
      statusIdle: string;
      statusStarting: string;
      statusRunning: string;
      statusManualPause: string;
      statusStopping: string;
      statusDone: string;
      statusError: string;
      manualPauseNeedsAction: string;
      manualPauseReason: string;
      runtimeLabel: string;
      runtimeReady: string;
      runtimeMissing: string;
      runtimeChecking: string;
      runtimeMissingNote: string;
      startHotkeyHint: string;
      quickRunTitle: string;
      quickRunAction: string;
      reasonMissingProfile: string;
      reasonMissingScenario: string;
      reasonRuntimeMissing: string;
      reasonInvalidPreflight: string;
      reasonAlreadyRunning: string;
      retryFromFailedStep: string;
      retryFromStepAction: string;
      retryFromStepUnavailable: string;
      retryFromStepSelected: string;
      versionTitle: string;
      versionSelect: string;
      versionCurrent: string;
      versionSelected: string;
      versionRunAction: string;
      versionRollbackAction: string;
      versionLoadError: string;
      presetsTitle: string;
      presetDefaultName: string;
      presetNamePlaceholder: string;
      presetSaveAction: string;
      presetApplyAction: string;
      presetApplyRunAction: string;
      presetRenameAction: string;
      presetLastUsed: string;
      presetDeleteTitle: string;
      presetDeleteMessage: string;
      presetSaved: string;
      presetSaveFailed: string;
      presetsEmpty: string;
      runtimeSection: string;
      runtimeInstalled: string;
      runtimeNotInstalled: string;
      runtimeUnknown: string;
      savedScenarios: string;
      pickScenario: string;
      searchPlaceholder: string;
      sortRecent: string;
      sortHealth: string;
      sortSteps: string;
      healthFilterAll: string;
      healthFilterValid: string;
      healthFilterErrors: string;
      compactEnabled: string;
      compactDisabled: string;
      tagsFilterLabel: string;
      noMatches: string;
      emptySaved: string;
      indexLoadFailed: string;
      seedCurrent: string;
      currentAdded: string;
      seedFailed: string;
      reindex: string;
      reindexing: string;
      reindexSuccess: string;
      reindexFailed: string;
      scenarioPath: string;
      scenarioPathPlaceholder: string;
      recentScenarios: string;
      selectRecent: string;
      runHealth: string;
      validating: string;
      validLabel: string;
      stepsLabel: string;
      droppedLabel: string;
      healthScoreLabel: string;
      issuesLabel: string;
      noScenarioLoaded: string;
      startUrl: string;
      continueOnError: string;
      runnerConfig: string;
      loadingSettings: string;
      fromProfile: string;
      progressLabel: string;
      progressEmpty: string;
      manualPause: string;
      resume: string;
      abort: string;
      steps: string;
      healthShort: string;
      missingFile: string;
      defaultScenarioName: string;
      scenarioLabel: string;
      invalidScenarioFile: string;
      cannotParseScenario: string;
      tabOverview: string;
      tabDetails: string;
      tabDiagnostics: string;
      selectedScenario: string;
      selectedPinnedHint: string;
      recentRunsTitle: string;
      runsFilterAll: string;
      runsFilterErrors: string;
      recentRunsError: string;
      recentRunsEmpty: string;
      runDurationLabel: string;
      openRunDetails: string;
      lastEvent: string;
      advancedToggle: string;
      jobId: string;
      correlationId: string;
      pythonStderr: string;
      failureDetails: string;
      failureStep: string;
      failureSelector: string;
      failureUrl: string;
      failureError: string;
      failureRunner: string;
      failureReport: string;
      copyReportPath: string;
      openReportFolder: string;
      reportPathCopied: string;
      reportPathCopyFailed: string;
      openReportFolderFailed: string;
      timelineTitle: string;
      timelineEmpty: string;
      refreshing: string;
    };
  };

  proxyLibrary: {
    title: string;
    description: string;
    importBulk: string;
    showPasswords: string;
    hidePasswords: string;
    pasteProxies: string;
    defaultType: string;
    importedEnabled: string;
    importing: string;
    import: string;
    importedStat: string;
    skippedStat: string;
    totalLinesStat: string;
    andMore: string;
    label: string;
    type: string;
    host: string;
    port: string;
    username: string;
    password: string;
    notes: string;
    enabled: string;
    cancel: string;
    saving: string;
    addProxy: string;
    save: string;
    entries: string;
    loading: string;
    noEntries: string;
    statusEnabled: string;
    statusDisabled: string;
    edit: string;
    ready: string;
    loadError: string;
    createError: string;
    updateError: string;
    deleteError: string;
    importError: string;
    batchEnable: string;
    batchDisable: string;
    batchDelete: string;
    forceDeleteConfirm: string;
    forceDeletePrompt: string;
    referencesProfiles: string;
    referencesScenarios: string;
    stepRestartBoundary: string;
    quickAddTitle: string;
    quickInputLabel: string;
    quickInputPlaceholder: string;
    quickParse: string;
    bulkPreview: string;
    addOrLinkProxy: string;
    testDraft: string;
    testingDraft: string;
    testEntry: string;
    testingEntry: string;
    testStatusOk: string;
    testStatusFail: string;
    testStatusNone: string;
    parseError: string;
    testError: string;
  };

  profileProxy: {
    source: string;
    sourceDisabled: string;
    sourceLibrary: string;
    libraryProxy: string;
    loading: string;
    selectProxy: string;
    noEnabledProxies: string;
    using: string;
    disabledHint: string;
    enabledToggle: string;
    addProxyButton: string;
    addProxyModalTitle: string;
    addProxyInputLabel: string;
    addProxyInputPlaceholder: string;
    addProxyParse: string;
    addProxyParsing: string;
    addProxyParseError: string;
    addProxyTest: string;
    addProxyTesting: string;
    addProxyTestError: string;
    addProxySaveUse: string;
    addProxySaveError: string;
    addProxySuccess: string;
    testOk: string;
    testFail: string;
    addProxyLockHint: string;
    addProxyTestRequiredLabel: string;
    addProxyTestRequiredMessage: string;
    addProxyGuardFailed: string;
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
