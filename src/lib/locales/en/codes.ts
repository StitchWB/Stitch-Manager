import type { CodesTranslations } from '../../i18n/types/codes';

export const codes: CodesTranslations = {
  codes: {
    title: "Codes",
    subtitle: "Distribution server activation codes",
    stats: {
      total: "Total",
      unused: "Unused",
      used: "Used",
      revoked: "Revoked",
      expired: "Expired"
    },
    filter: {
      all: "All codes",
      unusedOnly: "Unused only",
    },
    columns: {
      id: "ID",
      hashPrefix: "Hash prefix",
      entitlements: "Entitlements",
      status: "Status",
      tgUser: "Telegram user",
      label: "Label",
      createdAt: "Created",
      expiresAt: "Expires",
      usedAt: "Used at",
      actions: "Actions"
    },
    statuses: {
      unused: "Unused",
      used: "Used",
      revoked: "Revoked",
      expired: "Expired"
    },
    issue: {
      title: "Issue new codes",
      count: "Count",
      countHint: "1–100 codes per batch",
      ttl: "TTL",
      ttl60min: "60 minutes",
      ttl24h: "24 hours",
      ttl7d: "7 days",
      ttlNoExpiry: "No expiry",
      label: "Label",
      labelPlaceholder: "Optional batch label",
      submit: "Issue",
      submitting: "Issuing...",
    },
    issued: {
      title: "Issued codes",
      warning: "These codes will not be shown again. Copy them now.",
      copyAll: "Copy all",
      copied: "Codes copied to clipboard",
      copyFailed: "Failed to copy codes",
      close: "Close"
    },
    revoke: {
      title: "Revoke code",
      message: "Revoke activation code #{codeId}? This cannot be undone.",
      confirm: "Revoke",
    },
    toasts: {
      issued: "Codes issued",
      revoked: "Code revoked",
      issueFailed: "Failed to issue codes",
      loadFailed: "Failed to load codes",
      errorUnknown: "Unknown code",
      errorUsed: "Code already used",
      errorRejected: "Distribution server rejected the admin key",
      errorUnreachable: "Distribution server unreachable",
      errorDisabled: "Distribution server disabled",
      errorNoKey: "Distribution admin key not configured"
    },
    empty: "No codes yet",
    loading: "Loading codes...",
    retry: "Retry",
    entitlementsNote: "Entitlements are now managed via role grants on the Plugins page."
  }
};
