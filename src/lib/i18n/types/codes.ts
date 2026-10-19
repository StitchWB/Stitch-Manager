export interface CodesTranslations {
  codes: {
    title: string;
    subtitle: string;
    stats: {
      total: string;
      unused: string;
      used: string;
      revoked: string;
      expired: string;
    };
    filter: {
      all: string;
      unusedOnly: string;
    };
    columns: {
      id: string;
      hashPrefix: string;
      entitlements: string;
      status: string;
      tgUser: string;
      label: string;
      createdAt: string;
      expiresAt: string;
      usedAt: string;
      actions: string;
    };
    statuses: {
      unused: string;
      used: string;
      revoked: string;
      expired: string;
    };
    issue: {
      title: string;
      count: string;
      countHint: string;
      ttl: string;
      ttl60min: string;
      ttl24h: string;
      ttl7d: string;
      ttlNoExpiry: string;
      label: string;
      labelPlaceholder: string;
      submit: string;
      submitting: string;
    };
    issued: {
      title: string;
      warning: string;
      copyAll: string;
      copied: string;
      copyFailed: string;
      close: string;
    };
    revoke: {
      title: string;
      message: string;
      confirm: string;
    };
    toasts: {
      issued: string;
      revoked: string;
      issueFailed: string;
      loadFailed: string;
      errorUnknown: string;
      errorUsed: string;
      errorRejected: string;
      errorUnreachable: string;
      errorDisabled: string;
      errorNoKey: string;
    };
    empty: string;
    loading: string;
    retry: string;
    entitlementsNote: string;
  };
}
