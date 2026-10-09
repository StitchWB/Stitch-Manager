export interface AiHubTranslations {
  aiHub: {
    debugTitle: string;
    auto: string;
    debugMethod: string;
    debugPath: string;
    debugStatus: string;
    debugTime: string;
    request: string;
    response: string;
    statusValue: string;
    errorValue: string;
    selectLog: string;
    loadingKeys: string;
    apiKeysTitle: string;
    keysConfigured: string;
    addKey: string;
    bulkAdd: string;
    addKeyTitle: string;
    saveKeysFailed: string;
    keyValid: string;
    keyInvalid: string;
    testFailed: string;
    keyHealth: string;
    healthHealthy: string;
    healthFlaky: string;
    healthBroken: string;
    healthExpired: string;
    healthUnknown: string;
    noData: string;
    customProviders: string;
    customProvidersDesc: string;
    healthToggle: string;
    healthToggleTip: string;
    smartPasteFromPost: string;
    addProvider: string;
    noCustom: string;
    customEmpty: string;
    providerCreatedWithKeys: string;
    failedGeneric: string;
    clipboardNoUrlKeys: string;
    existingProviderFound: string;
    providerCreateFailed: string;
    providerCreated: string;
    fmTitle: string;
    fmDesc: string;
    apiKeyLabel: string;
    fmModelsAvailable: string;
    fmAvailableModels: string;
    fmGateway: string;
    fmStatusRunning: string;
    fmStatusStopped: string;
    fmStatusError: string;
    fmBridgeNotRunning: string;
    account_modal: {
      account_name: string;
      account_type: string;
      accountType: {
        enterprise: string;
        free: string;
        pro: string;
        team: string;
      }
      account_will_be_available_for_routing: string;
      add_title: string;
      api_key: string;
      authMethod: {
        api_key: string;
        oauth: string;
        session: string;
      }
      authenticate_via_browser_recommended: string;
      authentication_method: string;
      cancel: string;
      create: string;
      created_success: string;
      credential_required: string;
      edit_title: string;
      enable_account: string;
      login_with_oauth: string;
      name_placeholder: string;
      name_required: string;
      oauth_completed: string;
      oauth_token: string;
      oauth_token_placeholder: string;
      optional_placeholder: string;
      positive_integer_error: string;
      provider: string;
      save_failed: string;
      saving: string;
      session_token: string;
      session_token_placeholder: string;
      soft_daily_request_quota: string;
      soft_daily_token_quota: string;
      update: string;
      updated_success: string;
      use_oauth_login: string;
    }
    actions: {
      addAccount: string;
      addMapping: string;
      cancel: string;
      close: string;
      configureIde: string;
      copy: string;
      download: string;
      generate: string;
      generating: string;
      import: string;
      importAllFromScan: string;
      importJson: string;
      importing: string;
      openAnalytics: string;
      openDebugChat: string;
      openDetailedAnalytics: string;
      prepareFromScan: string;
      refresh: string;
      reset: string;
      runMigration: string;
      save: string;
      saveSettings: string;
      saving: string;
      scanAuthFiles: string;
      scanningAuthFiles: string;
      startProxy: string;
      stopProxy: string;
      working: string;
    }
    ai_proxy_account_drawer: {
      advanced: string;
      connected: string;
      connection_error: string;
      cooldown: string;
      disabled: string;
      edit: string;
      id: string;
      left: string;
      loading: string;
      no_quota_fetched_yet: string;
      no_requests_yet: string;
      primary: string;
      quota: string;
      recent_requests: string;
      refresh: string;
      refresh_error: string;
      resets: string;
      test: string;
      weekly: string;
    }
    analytics: {
      durationMs: string;
      emptyDescription: string;
      emptyTitle: string;
      openMonitor: string;
      recentRequestsTitle: string;
      refreshTooltip: string;
      requestsCount: string;
      subtitle: string;
      title: string;
      todayErrors: string;
      todayRequests: string;
      tokensCount: string;
      topModelsTitle: string;
      weeklyErrors: string;
      weeklyRequests: string;
    }
    compression: {
      advancedSettings: string;
      autoTriggerThreshold: string;
      autoTriggerThresholdDescription: string;
      avgSavings: string;
      badgeStdout: string;
      badgeTokens: string;
      caveman: string;
      cavemanEnabled: string;
      enabled: string;
      inputCompression: string;
      inputCompressionEnabled: string;
      level: string;
      levelFull: string;
      levelLite: string;
      levelUltra: string;
      notConfigured: string;
      outputCompression: string;
      outputCompressionEnabled: string;
      preserveSystemPrompt: string;
      preserveSystemPromptDescription: string;
      preserveSystemPromptEnabled: string;
      rtkEnabled: string;
      rtkFilters: string;
      subtitle: string;
      title: string;
      tokensSaved: string;
      toasts: {
        configSaved: string;
        configSaveFailed: string;
      }
    }
    holone: {
      activeRules: string;
      block: string;
      blockMode: string;
      blockModeDescription: string;
      enabled: string;
      excerpt: string;
      findings: string;
      findingsLastHour: string;
      highSeverityBlocked: string;
      monitor: string;
      monitorMode: string;
      monitorModeDescription: string;
      noFindings: string;
      notConfigured: string;
      protectionDescription: string;
      protectionMode: string;
      protectionTitle: string;
      recentFindings: string;
      rule: string;
      save: string;
      saveChanges: string;
      severity: string;
      soundDescription: string;
      soundEnabled: string;
      soundNotifications: string;
      testSound: string;
      timestamp: string;
      toasts: {
        configSaved: string;
        configSaveFailed: string;
      }
      unsavedChanges: string;
      volume: string;
    }
    apiKeys: {
      errors: {
        addFailed: string;
        apiKeyRequired: string;
        loadFailed: string;
      }
      fireworks: {
        account: string;
        checkKey: string;
        checkKeyRequired: string;
        checkPlaceholder: string;
        email: string;
        historyEmpty: string;
        historyTitle: string;
        keyTail: string;
        monthlyRemaining: string;
        monthlySpendLimit: string;
        noResultYet: string;
        prepaidCreditsNote: string;
        result: string;
        statusActive: string;
        statusFrozen: string;
        statusInvalid: string;
        statusLimit: string;
        suspendState: string;
        tier: string;
        totalSpent: string;
      }
      metrics: {
        configuredKeys: string;
        linkedAccounts: string;
      }
      modals: {
        fields: {
          apiKeyLabel: string;
          baseUrlLabel: string;
          modelPrefixLabel: string;
        }
      }
      sections: {
        checkerTitle: string;
      }
      toasts: {
        keyAdded: string;
        keyCopied: string;
        keyDeleted: string;
      }
    }
    authScan: {
      failed: string;
      found: string;
    }
    cards: {
      accountCoverageTitle: string;
      errors: string;
      last20Requests: string;
      modelInventoryTitle: string;
      providerCounts: string;
      providersTitle: string;
      requestHistoryTitle: string;
    }
    controller: {
      confirm: {
        importAllFromScan: string;
        importPayload: string;
        prepareFromScan: string;
      }
      errors: {
        connectionTestFailed: string;
        deleteAccountFailed: string;
        downloadFailed: string;
        exportFailed: string;
        importFailed: string;
        importPayloadRequired: string;
        invalidImportPayload: string;
        loadAccountsFailed: string;
        migrationFailed: string;
        noScanResultsToImport: string;
        saveMappingsFailed: string;
        updateAccountFailed: string;
      }
      importValidation: {
        invalidJson: string;
        payloadAccountsRequired: string;
        payloadMustBeObject: string;
        payloadVersionRequired: string;
      }
      toasts: {
        accountDeleted: string;
        accountDisabled: string;
        accountEnabled: string;
        connectionOk: string;
        downloadStarted: string;
        exportGenerated: string;
        importedAccounts: string;
        importedAccountsWithSkipped: string;
        mappingsSaved: string;
        migrationCompleted: string;
        migrationRunning: string;
        preparedImportFromScan: string;
      }
    }
    copy: {
      empty: string;
      fail: string;
      success: string;
    }
    diagnostics: {
      healthTitle: string;
      latestReason: string;
      noRecentReasons: string;
    }
    empty: {
      capabilities: string;
      modelsNoAccounts: string;
      modelsProxyStopped: string;
      modelsUnavailable: string;
      noAuthFiles: string;
      noExportPayload: string;
      noMappings: string;
    }
    groups: {
      plugins: string;
      processing: string;
      sources: string;
      usage: string;
    }
    integrations: {
      baseUrl: string;
      apiKey: string;
    }
    labels: {
      providers: string;
      providersHint: string;
    }
    modals: {
      csvNoSecrets: string;
      expiresShort: string;
      exportDescription: string;
      exportFormatCsv: string;
      exportFormatJson: string;
      exportPayloadLabel: string;
      exportTitle: string;
      importDescription: string;
      importPayloadLabel: string;
      importPayloadPlaceholder: string;
      importTitle: string;
      importWarningDescription: string;
      importWarningTitle: string;
      includeSecrets: string;
      mappingPatternPlaceholder: string;
      mappingTargetPlaceholder: string;
      mappingsTitle: string;
      noExpiry: string;
      scanReportLabel: string;
      scanResultsTitle: string;
      transferExportTitle: string;
      transferFooter: string;
      transferImportTitle: string;
    }
    o_auth_modal: {
      click_the_button_below_to_open_the_authorization_p: string;
      device_code_authorization: string;
      enter_the_user_code_shown_above: string;
      enter_this_code_on_the_verification_page: string;
      open_the_verification_page_using_the_button_below: string;
      return_here_authorization_completes_automatically: string;
      sign_in_with_your_aws_builder_id: string;
      waiting_for_authorization: string;
    }
    oauthWizard: {
      authUrlLabel: string;
      copyUrl: string;
      failed: string;
      notConfigured: string;
      openAgain: string;
      retry: string;
      start: string;
      starting: string;
      success: string;
      timedOut: string;
      title: string;
      waiting: string;
    }
    proxy: {
      activePortLabel: string;
      autoStart: string;
      baseUrl: string;
      clientApiKey: string;
      error: string;
      errors: {
        emptyManagementKey: string;
        invalidPort: string;
        notLoaded: string;
      }
      keyPreviewLabel: string;
      managementKey: string;
      managementKeyPlaceholder: string;
      modeFull: string;
      modeLabel: string;
      modeQuota: string;
      portLabel: string;
      portPlaceholder: string;
      reachabilityLabel: string;
      reachable: string;
      routingFillFirst: string;
      routingLabel: string;
      routingRoundRobin: string;
      running: string;
      stopped: string;
      title: string;
      toasts: {
        saveFailed: string;
        saved: string;
        started: string;
        stopped: string;
      }
      unreachable: string;
      unsavedChanges: string;
    }
    readiness: {
      cooldown: string;
      enabled: string;
      ready: string;
      weeklyLimit: string;
      weeklyLimitShort: string;
    }
    rotation: {
      checkIntervalLabel: string;
      secondsUnit: string;
      switchOnZeroHint: string;
      switchOnZeroLabel: string;
      toasts: {
        saveFailed: string;
        strategySaved: string;
      }
      strategy: {
        title: string;
        description: string;
      }
      strategies: {
        roundRobin: {
          title: string;
          description: string;
        }
        random: {
          title: string;
          description: string;
        }
        leastUsed: {
          title: string;
          description: string;
        }
        priority: {
          title: string;
          description: string;
        }
      }
      priority: {
        title: string;
        description: string;
      }
    }
    topology: {
      keys: string;
    }
    healthCheck: {
      title: string;
      description: string;
      intervalLabel: string;
      intervalHint: string;
      autoDisableLabel: string;
      autoDisableHint: string;
      showAdvanced: string;
      hideAdvanced: string;
      testEndpointLabel: string;
      testEndpointHint: string;
      cooldownLabel: string;
      cooldownHint: string;
      exponentialBackoffLabel: string;
      exponentialBackoffHint: string;
    }
    search: {
      placeholder: string;
    }
    sections: {
      monitor: {
        subtitle: string;
        title: string;
      }
      providers: {
        subtitle: string;
        title: string;
      }
      routing: {
        title: string;
      }
      holone: {
        subtitle: string;
        title: string;
      }
    }
    table: {
      delete: string;
      edit: string;
      emptyValue: string;
      requestsLine: string;
      status: string;
      testConnection: string;
    }
    tabs: {
      compression: string;
      tools: string;
      holone: string;
      chat: string;
      integrations: string;
      monitor: string;
      notebooklm: string;
      providers: string;
      routing: string;
    }
    warnings: {
      copySensitiveConfirm: string;
      serverOffline: string;
    }
    wizard: {
      actions: {
        applyConfiguration: string;
        back: string;
        done: string;
        next: string;
        restoreBackup: string;
        runSmoke: string;
      }
      alreadyConfigured: string;
      applying: string;
      autoImport: {
        dryRun: string;
        hint: string;
        importNow: string;
        imported: string;
        modeDryRun: string;
        modeLabel: string;
        modeWrite: string;
        noDiscovered: string;
        scanned: string;
        skipped: string;
        title: string;
      }
      detecting: string;
      errors: {
        autoImportFailed: string;
        autoSmokeFailed: string;
        configurationFailed: string;
        detectFailed: string;
        previewFailed: string;
        restoreFailed: string;
        smokeFailed: string;
        startProxyFailed: string;
      }
      manual: {
        copied: string;
        copyButton: string;
        copyFailed: string;
        hint: string;
        openaiApiKey: string;
        openaiBaseUrl: string;
        title: string;
      }
      nextSteps: {
        ensureProxy: string;
        restartIde: string;
        runSmoke: string;
        testRequest: string;
        title: string;
      }
      noIdesHint: string;
      noIdesTitle: string;
      opencodeLabel: string;
      previewHint: string;
      previewTitle: string;
      providerProfile: string;
      proxyStoppedHint: string;
      results: {
        configuredPending: string;
        configuredVerified: string;
        restored: string;
        restoredVerified: string;
        smokeAttention: string;
        smokeOk: string;
      }
      runningAutoSmoke: string;
      selectDescription: string;
      smoke: {
        noModels: string;
        notConfigured: string;
        passed: string;
        proxyNotRunning: string;
      }
      title: string;
    }
  };
}
