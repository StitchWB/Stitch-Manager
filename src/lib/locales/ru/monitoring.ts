import type { MonitoringTranslations } from '../../i18n/types/monitoring';

export const monitoring: MonitoringTranslations = {
  monitoring: {
    title: "Мониторинг",
    subtitle: "Здоровье сервисов Stitch",
    refresh: "Обновить",
    generatedAt: "Сгенерировано",
    noProxies: "Прокси не настроены",
    alerts: "Алерты",
    silence1h: "Тишина 1ч",
    silenced: "Тишина до {time}",
    noAlerts: "Нет активных алертов",
    sections: {
      bot: "Бот",
      proxies: "Прокси",
      server: "Сервер",
      web: "Веб",
      external: "Внешние сервисы"
    },
    statuses: {
      up: "Работает",
      down: "Недоступен",
      stale: "Устарел",
      unknown: "Неизвестно"
    },
    fields: {
      latency: "Задержка",
      lastCheck: "Последняя проверка",
      route: "Маршрут",
      age: "Возраст",
      uptime: "Время работы",
      pollingErrors: "Ошибки опроса",
      detail: "Детали",
      url: "URL",
      status: "Статус",
      dbOk: "База данных",
      candidates: "Кандидаты",
      lastHeartbeat: "Последний heartbeat",
      secondsAgo: "{count} с назад"
    },
    errors: {
      loadFailed: "Не удалось загрузить данные мониторинга",
      unreachable: "Сервер мониторинга недоступен",
      rejected: "Сервер мониторинга отклонил запрос",
      noAccess: "У вас нет доступа к мониторингу",
      disabled: "Мониторинг отключён или не настроен"
    },
    servicePlugins: {
      title: "Сервисные плагины",
      empty: "Сервисные плагины не установлены",
      plugin: "Плагин",
      version: "Версия",
      restarts: "Рестарты",
      statusRunning: "Работает",
      statusStopped: "Остановлен",
      statusError: "Ошибка"
    }
  }
};
