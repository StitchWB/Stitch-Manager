import type { ProfileProxyTranslations } from '../../i18n/types/profileProxy';

export const profileProxy: ProfileProxyTranslations = {
  profileProxy: {
    addProxyButton: "Add proxy",
    addProxyInputLabel: "Proxy input",
    addProxyInputPlaceholder: "host:port[:user:pass] or scheme://user:pass@host:port",
    addProxyLockHint: "Host/type/port are locked after parse. Re-parse to change source endpoint.",
    addProxyModalTitle: "Add proxy from input",
    addProxyParse: "Parse",
    addProxyParseError: "Invalid proxy format",
    addProxyParsing: "Parsing…",
    addProxySaveError: "Failed to add proxy",
    addProxySaveUse: "Save & Use",
    addProxySuccess: "Proxy linked from library",
    addProxyTest: "Test",
    addProxyTestError: "Failed to test proxy",
    addProxyTestRequiredLabel: "Require successful test before Save & Use",
    addProxyTestRequiredMessage: "Run a successful proxy test before Save & Use.",
    addProxyTesting: "Testing…",
    disabledHint: "Proxy is disabled",
    enabledToggle: "Enabled",
    libraryProxy: "Library proxy",
    loading: "Loading…",
    noEnabledProxies: "No enabled proxies in library",
    selectProxy: "Select proxy",
    source: "Proxy source",
    sourceDisabled: "Disabled",
    sourceLibrary: "Proxy Library",
    testFail: "FAIL",
    testOk: "OK",
    using: "Using"
  }
};
