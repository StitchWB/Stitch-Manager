import type { PrivilegesTranslations } from '../../i18n/types/privileges';

export const privileges: PrivilegesTranslations = {
  privileges: {
    title: "Привилегии",
    subtitle: "Выдача и отзыв прав на разделы и действия для каждой роли",
    adminImmutable: "Роль admin всегда имеет все права и не может быть изменена",
    sections: "Разделы",
    actions: "Действия",
    updated: "Право обновлено",
    error: "Не удалось обновить право",
    key: {
      section: {
        autoreg: "Регистрация",
        ai_hub: "AI Hub",
        automation: "Автоматика",
        mail: "Почта",
        tools: "Инструменты",
        totp: "2FA",
        scenarios: "Сценарии",
        settings: "Настройки",
        logs: "Логи",
      },
      action: {
        export_accounts: "Экспорт аккаунтов",
        bulk_delete: "Массовое удаление",
        claim: "Забирать общее",
      },
    },
  }
};
