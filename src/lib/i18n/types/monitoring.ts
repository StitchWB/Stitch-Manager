export interface MonitoringTranslations {
  monitoring: {
    title: string;
    subtitle: string;
    refresh: string;
    generatedAt: string;
    noProxies: string;
    alerts: string;
    silence1h: string;
    silenced: string;
    noAlerts: string;
    sections: {
      bot: string;
      proxies: string;
      server: string;
      web: string;
      external: string;
    };
    statuses: {
      up: string;
      down: string;
      stale: string;
      unknown: string;
    };
    fields: {
      latency: string;
      lastCheck: string;
      route: string;
      age: string;
      uptime: string;
      pollingErrors: string;
      detail: string;
      url: string;
      status: string;
      dbOk: string;
      candidates: string;
      lastHeartbeat: string;
      secondsAgo: string;
    };
    errors: {
      loadFailed: string;
      unreachable: string;
      rejected: string;
      noAccess: string;
      disabled: string;
    };
    servicePlugins: {
      title: string;
      empty: string;
      plugin: string;
      version: string;
      restarts: string;
      statusRunning: string;
      statusStopped: string;
      statusError: string;
    };
  };
}
