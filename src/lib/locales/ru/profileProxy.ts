import type { ProfileProxyTranslations } from '../../i18n/types/profileProxy';

export const profileProxy: ProfileProxyTranslations = {
  profileProxy: {
    addProxyButton: "Добавить прокси",
    addProxyInputLabel: "Ввод прокси",
    addProxyInputPlaceholder: "host:port[:user:pass] или scheme://user:pass@host:port",
    addProxyLockHint: "После разбора host/type/port зафиксированы. Чтобы сменить endpoint, выполните разбор заново.",
    addProxyModalTitle: "Добавить прокси из ввода",
    addProxyParse: "Разобрать",
    addProxyParseError: "Некорректный формат прокси",
    addProxyParsing: "Разбор…",
    addProxySaveError: "Не удалось добавить прокси",
    addProxySaveUse: "Сохранить и использовать",
    addProxySuccess: "Прокси подключен из библиотеки",
    addProxyTest: "Проверить",
    addProxyTestError: "Не удалось проверить прокси",
    addProxyTestRequiredLabel: "Требовать успешный тест перед «Сохранить и использовать»",
    addProxyTestRequiredMessage: "Перед «Сохранить и использовать» выполните успешную проверку прокси.",
    addProxyTesting: "Проверка…",
    disabledHint: "Прокси отключён",
    enabledToggle: "Включено",
    libraryProxy: "Прокси из библиотеки",
    loading: "Загрузка…",
    noEnabledProxies: "В библиотеке нет включённых прокси",
    selectProxy: "Выберите прокси",
    source: "Источник прокси",
    sourceDisabled: "Отключено",
    sourceLibrary: "Библиотека прокси",
    testFail: "FAIL",
    testOk: "OK",
    using: "Используется"
  }
};
