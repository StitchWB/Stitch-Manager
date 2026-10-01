import type { AutomationTranslations } from '../../i18n/types/automation';

export const automation: AutomationTranslations = {
  automation: {
    replenishment: {
      label: "Replenishment",
      subtitle: "Maintain target number of active accounts per IDE."
    },
    title: "Automation",
    tabs: {
      schedule: "Schedule",
      scenarios: "Scenarios",
      replenishment: "Replenishment"
    },
    schedule: {
      subtitle: "Scheduled tasks: token refresh, registrations, custom scripts."
    },
    scenarios: {
      subtitle: "Recorded browser scenarios for replay."
    },
    kpi: {
      tasksRunning: "Tasks enabled",
      nextRun: "Next",
      autoReplenish: "Auto-Replenish",
      autoSwitch: "Auto-Switch",
      on: "On",
      off: "Off",
      noNextRun: "—"
    }
  }
};
