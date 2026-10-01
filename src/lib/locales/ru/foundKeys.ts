import type { FoundKeysTranslations } from '../../i18n/types/foundKeys';

export const foundKeys: FoundKeysTranslations = {
  foundKeys: {
    title: "Найденные ключи",
    subtitle: "Утечки, обнаруженные AiApiRadar в публичных репозиториях",
    empty: "Пока ничего не найдено",
    error: "Не удалось загрузить ключи",
    notConfigured: "Не настроен AIRADAR_ADMIN_TOKEN в .env",
    copy: "Копировать",
    copied: "Скопировано",
    provider: "Провайдер",
    status: "Статус",
    source: "Источник",
    firstSeen: "Найден",
    key: "Ключ",
    refresh: "Обновить",
    tokenRejected: "AiApiRadar отклонил токен — проверьте AIRADAR_ADMIN_TOKEN",
    clipboardWarning:
      "Скопированный ключ остаётся в истории буфера обмена, пока вы не скопируете что-то другое.",
  }
};
