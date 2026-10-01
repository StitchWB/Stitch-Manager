import type { CodesTranslations } from '../../i18n/types/codes';

export const codes: CodesTranslations = {
  codes: {
    title: "Коды",
    subtitle: "Коды активации сервера распространения",
    stats: {
      total: "Всего",
      unused: "Не использованы",
      used: "Использованы",
      revoked: "Отозваны",
      expired: "Истекли"
    },
    filter: {
      all: "Все коды",
      unusedOnly: "Только неиспользованные",
    },
    columns: {
      id: "ID",
      hashPrefix: "Префикс хэша",
      entitlements: "Права",
      status: "Статус",
      tgUser: "Telegram-пользователь",
      label: "Метка",
      createdAt: "Создан",
      expiresAt: "Истекает",
      usedAt: "Использован",
      actions: "Действия"
    },
    statuses: {
      unused: "Не использован",
      used: "Использован",
      revoked: "Отозван",
      expired: "Истёк"
    },
    issue: {
      title: "Выпустить новые коды",
      count: "Количество",
      countHint: "1–100 кодов на партию",
      ttl: "Срок действия",
      ttl60min: "60 минут",
      ttl24h: "24 часа",
      ttl7d: "7 дней",
      ttlNoExpiry: "Без срока",
      label: "Метка",
      labelPlaceholder: "Необязательная метка партии",
      submit: "Выпустить",
      submitting: "Выпуск...",
    },
    issued: {
      title: "Выпущенные коды",
      warning: "Эти коды больше не будут показаны. Скопируйте их сейчас.",
      copyAll: "Скопировать все",
      copied: "Коды скопированы в буфер обмена",
      copyFailed: "Не удалось скопировать коды",
      close: "Закрыть"
    },
    revoke: {
      title: "Отозвать код",
      message: "Отозвать код активации #{codeId}? Это действие нельзя отменить.",
      confirm: "Отозвать",
    },
    toasts: {
      issued: "Коды выпущены",
      revoked: "Код отозван",
      issueFailed: "Не удалось выпустить коды",
      loadFailed: "Не удалось загрузить коды",
      errorUnknown: "Неизвестный код",
      errorUsed: "Код уже использован",
      errorRejected: "Сервер распространения отклонил ключ администратора",
      errorUnreachable: "Сервер распространения недоступен",
      errorDisabled: "Сервер распространения отключён",
      errorNoKey: "Ключ администратора распространения не настроен"
    },
    empty: "Кодов пока нет",
    loading: "Загрузка кодов...",
    retry: "Повторить",
    entitlementsNote: "Права теперь управляются через роли на странице «Плагины»."
  }
};
