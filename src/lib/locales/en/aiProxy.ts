import type { AiProxyTranslations } from '../../i18n/types/aiProxy';

export const aiProxy: AiProxyTranslations = {
  aiProxy: {
    oAuthModal: {
      authCodeWaitingHint: "Complete the OAuth flow in your browser",
      authMismatchError: "AI Proxy auth mismatch detected. Restart AI Proxy from Settings and retry OAuth.",
      authorizationUrlLabel: "Authorization URL",
      browserOpenedSuccess: "Browser opened. Please complete authorization.",
      codeCopiedSuccess: "Code copied to clipboard",
      completedSuccess: "OAuth completed successfully!",
      copyCodeFailedError: "Failed to copy code",
      copyCodeTitle: "Copy Code",
      copyUrlFailedError: "Failed to copy URL",
      copyUrlTitle: "Copy URL",
      deviceCodeWaitingHint: "Enter the code on the verification page and sign in",
      failedError: "OAuth failed: {error}",
      loading: "Loading",
      openAuthorizationPage: "Open Authorization Page",
      openBrowserFailedError: "Failed to open browser: {error}",
      openVerificationPage: "Open Verification Page",
      startFailedError: "Failed to start OAuth: {error}",
      timeoutError: "OAuth timeout. Please try again.",
      title: "Connect {provider}",
      unknownError: "Unknown error",
      urlCopiedSuccess: "URL copied to clipboard",
      verificationPageOpenedSuccess: "Verification page opened. Enter the code above to authorize.",
      verificationUrlLabel: "Verification URL",
      waitingForAuthorization: "Waiting for authorization ({pollAttempts}/{maxPollAttempts})"
    },
    secretMaskedHint: "Secret is masked — leave as-is to keep it unchanged"
  }
};
