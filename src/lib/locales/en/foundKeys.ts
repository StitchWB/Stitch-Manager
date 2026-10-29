import type { FoundKeysTranslations } from '../../i18n/types/foundKeys';

export const foundKeys: FoundKeysTranslations = {
  foundKeys: {
    title: "Found keys",
    subtitle: "Leaks discovered by AiApiRadar in public repositories",
    empty: "Nothing found yet",
    error: "Failed to load keys",
    notConfigured: "AIRADAR_ADMIN_TOKEN is not set in .env",
    copy: "Copy",
    copied: "Copied",
    provider: "Provider",
    status: "Status",
    source: "Source",
    firstSeen: "Found",
    key: "Key",
    refresh: "Refresh",
    tokenRejected: "AiApiRadar admin token rejected — check AIRADAR_ADMIN_TOKEN",
    clipboardWarning:
      "Copied keys stay in your clipboard history until you copy something else.",
  }
};
