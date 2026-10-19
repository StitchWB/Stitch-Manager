export interface DashboardTranslations {
  dashboard: {
    activity: {
      title: string;
      empty: string;
      filters: {
        all: string;
        newAccounts: string;
        registrations: string;
        scheduler: string;
        proxy: string;
      }
      newAccount: {
        description: string;
      }
    }
    cc: {
      health: {
        ariaLabel: string;
        title: string;
        partFleet: string;
        partQuota: string;
        partServices: string;
        partErrors: string;
        detailFleet: string;
        detailFleetNone: string;
        detailQuota: string;
        detailQuotaNone: string;
        detailServices: string;
        detailServicesNone: string;
        detailErrors: string;
      }
      stats: {
        totalAccounts: string;
        activeShare: string;
        nearLimit: string;
        plugins: string;
      }
      queue: {
        ariaLabel: string;
        quotaNear: string;
        serviceDown: string;
        fleetUnreachable: string;
        proxiesDead: string;
        schedulerStopped: string;
        fleetGap: string;
        fleetGapEta: string;
        openAccounts: string;
        openPlugins: string;
        openAutoreg: string;
        openSettings: string;
        openAutomation: string;
        register: string;
      }
      heat: {
        title: string;
        registrations: string;
        okRate: string;
        tooltip: string;
        empty: string;
      }
      matrix: {
        fleet: string;
        services: string;
        subsystems: string;
        collapse: string;
        expand: string;
        colActiveTarget: string;
        colAvgQuota: string;
        colReg7d: string;
        colSuccessDelta: string;
        fleetSummary: string;
        servicesSummary: string;
      }
      fleet: {
        statusOk: string;
        statusGap: string;
        statusEmpty: string;
        statusNoTarget: string;
        editTarget: string;
        decrement: string;
        increment: string;
        avgQuota: string;
        quotaNoData: string;
        reg7d: string;
        successDelta: string;
        refreshTokens: string;
        register: string;
        pin: string;
        unpin: string;
        saveFailed: string;
      }
      services: {
        uptime: string;
        notRunning: string;
        restart: string;
        logs: string;
        unitMinutes: string;
        unitHours: string;
        unitDays: string;
      }
      subsystems: {
        plugins: string;
        mail: string;
        totp: string;
        scheduler: string;
        nextRun: string;
        friends: string;
        radar: string;
      }
      park: {
        title: string;
        summary: string;
        distribution: string;
        nearLimit: string;
        recent: string;
        empty: string;
        share: string;
        openAccounts: string;
      }
    }
    fleetGrid: {
      noAccountsToRefresh: string;
    }
    quotaUsage: string;
    systemStrip: {
      ariaLabel: string;
      stateOn: string;
      stateOff: string;
      proxy: {
        label: string;
        running: string;
        runningAt: string;
        stopped: string;
        tooltipStart: string;
        tooltipStop: string;
        toggleFailed: string;
      }
      replenish: {
        label: string;
        tooltip: string;
        toggleFailed: string;
      }
      autoSwitch: {
        label: string;
        tooltip: string;
        tooltipDisabled: string;
        toggleFailed: string;
      }
      scheduler: {
        label: string;
        runningWithNext: string;
        runningNoNext: string;
        stopped: string;
        unknown: string;
        noNextRun: string;
        due: string;
        tooltipStart: string;
        tooltipStop: string;
        toggleFailed: string;
      }
      bridge: {
        label: string;
        online: string;
        offline: string;
        tooltip: string;
      }
    }
    title: string;
  };
}
