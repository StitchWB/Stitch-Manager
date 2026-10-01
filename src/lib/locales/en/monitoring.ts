import type { MonitoringTranslations } from '../../i18n/types/monitoring';

export const monitoring: MonitoringTranslations = {
  monitoring: {
    title: "Monitoring",
    subtitle: "Stitch services health",
    refresh: "Refresh",
    generatedAt: "Generated",
    noProxies: "No proxies configured",
    alerts: "Alerts",
    silence1h: "Silence 1h",
    silenced: "Silenced until {time}",
    noAlerts: "No active alerts",
    sections: {
      bot: "Bot",
      proxies: "Proxies",
      server: "Server",
      web: "Web",
      external: "External"
    },
    statuses: {
      up: "Up",
      down: "Down",
      stale: "Stale",
      unknown: "Unknown"
    },
    fields: {
      latency: "Latency",
      lastCheck: "Last check",
      route: "Route",
      age: "Age",
      uptime: "Uptime",
      pollingErrors: "Polling errors",
      detail: "Detail",
      url: "URL",
      status: "Status",
      dbOk: "Database",
      candidates: "Candidates",
      lastHeartbeat: "Last heartbeat",
      secondsAgo: "{count}s ago"
    },
    errors: {
      loadFailed: "Failed to load monitoring data",
      unreachable: "Monitoring server unreachable",
      rejected: "Monitoring server rejected the request",
      noAccess: "You don't have access to monitoring",
      disabled: "Monitoring is disabled or not configured"
    },
    servicePlugins: {
      title: "Service plugins",
      empty: "No service plugins installed",
      plugin: "Plugin",
      version: "Version",
      restarts: "Restarts",
      statusRunning: "Running",
      statusStopped: "Stopped",
      statusError: "Error"
    }
  }
};
