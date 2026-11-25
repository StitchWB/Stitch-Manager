import type { PluginUiTranslations } from '../../i18n/types/pluginUi';

export const pluginUi: PluginUiTranslations = {
  pluginUi: {
    actionFailed: "Действие не удалось",
    actionSucceeded: "Действие выполнено",
    copied: "Скопировано",
    confirmRowAction: "Выполнить это действие?",
    toggleActionFailed: "Не удалось переключить",
    confirmToggle: "Переключить этот параметр?",
    pluginNotInstalled: "Плагин не установлен",
    pluginNotInstalledDescription: "Плагин не установлен или недоступен.",
    noData: "Нет данных",
    emptyHint: "Данные появятся здесь, когда станут доступны.",
    runtime: {
      enabled: "Включён",
      enable: "Включить",
      disable: "Выключить",
      restart: "Перезапустить",
      disabled: "Выключен",
      enabledToast: "Плагин включён",
      disabledToast: "Плагин выключен",
      restartedToast: "Плагин перезапущен",
      actionFailedToast: "Не удалось выполнить действие с плагином",
      disabledBannerTitle: "Плагин выключен",
      disabledBannerDescription: "Этот плагин выключен администратором. Пакет и данные сохранены, но среда выполнения остановлена.",
      pid: "PID",
      uptime: "Время работы",
      restarts: "Перезапусков",
    },
  }
};
