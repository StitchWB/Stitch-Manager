import type { AiProxyTranslations } from '../../i18n/types/aiProxy';

export const aiProxy: AiProxyTranslations = {
  aiProxy: {
    oAuthModal: {
      authCodeWaitingHint: "Завершите OAuth-процесс в браузере",
      authMismatchError: "Обнаружено несоответствие авторизации AI Proxy. Перезапустите AI Proxy из настроек и повторите OAuth.",
      authorizationUrlLabel: "URL авторизации",
      browserOpenedSuccess: "Браузер открыт. Завершите авторизацию.",
      codeCopiedSuccess: "Код скопирован в буфер обмена",
      completedSuccess: "OAuth завершён успешно!",
      copyCodeFailedError: "Не удалось скопировать код",
      copyCodeTitle: "Копировать код",
      copyUrlFailedError: "Не удалось скопировать URL",
      copyUrlTitle: "Копировать URL",
      deviceCodeWaitingHint: "Введите код на странице верификации и войдите",
      failedError: "OAuth не удался: {error}",
      loading: "Загрузка",
      openAuthorizationPage: "Открыть страницу авторизации",
      openBrowserFailedError: "Не удалось открыть браузер: {error}",
      openVerificationPage: "Открыть страницу верификации",
      startFailedError: "Не удалось запустить OAuth: {error}",
      timeoutError: "Время ожидания OAuth истекло. Попробуйте снова.",
      title: "Подключить {provider}",
      unknownError: "Неизвестная ошибка",
      urlCopiedSuccess: "URL скопирован в буфер обмена",
      verificationPageOpenedSuccess: "Страница верификации открыта. Введите код выше для авторизации.",
      verificationUrlLabel: "URL верификации",
      waitingForAuthorization: "Ожидание авторизации ({pollAttempts}/{maxPollAttempts})"
    },
    secretMaskedHint: "Секрет скрыт — оставьте поле как есть, чтобы не менять его"
  }
};
