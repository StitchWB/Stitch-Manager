import type { PluginUiTranslations } from '../../i18n/types/pluginUi';

export const pluginUi: PluginUiTranslations = {
  pluginUi: {
    actionFailed: "Action failed",
    actionSucceeded: "Action succeeded",
    copied: "Copied",
    confirmRowAction: "Execute this action?",
    toggleActionFailed: "Failed to switch",
    confirmToggle: "Switch this setting?",
    pluginNotInstalled: "Plugin not installed",
    pluginNotInstalledDescription: "The plugin is not installed or is unavailable.",
    noData: "No data",
    emptyHint: "Data will appear here once it becomes available.",
    runtime: {
      enabled: "Enabled",
      enable: "Enable",
      disable: "Disable",
      restart: "Restart",
      disabled: "Disabled",
      enabledToast: "Plugin enabled",
      disabledToast: "Plugin disabled",
      restartedToast: "Plugin restarted",
      actionFailedToast: "Plugin action failed",
      disabledBannerTitle: "Plugin is disabled",
      disabledBannerDescription: "This plugin was disabled by an administrator. Its package and data are kept, but the runtime is stopped.",
      pid: "PID",
      uptime: "Uptime",
      restarts: "Restarts",
    },
  }
};
