import type { AutomationTranslations } from '../../i18n/types/automation';

export const automation: AutomationTranslations = {
  automation: {
    replenishment: {
      label: "Пополнение",
      subtitle: "Поддер��ивайте целевое количество активных аккаунтов на каждый IDE."
    },
    title: "Автоматика",
    tabs: {
      schedule: "Расписание",
      scenarios: "Сценарии",
      replenishment: "Пополнение"
    },
    schedule: {
      subtitle: "Запланированные задачи: refresh токенов, регистрации, кастомные скрипты."
    },
    scenarios: {
      subtitle: "Записанные браузерные сценарии для повторного запуска."
    },
    kpi: {
      tasksRunning: "Задач включено",
      nextRun: "Следующая",
      autoReplenish: "Автопополнение",
      autoSwitch: "Авто-переключение",
      on: "ВКЛ",
      off: "ВЫКЛ",
      noNextRun: "—"
    }
  }
};
