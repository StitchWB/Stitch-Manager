export interface AuthTranslations {
  auth: {
    title: string;
    subtitle: string;
    username: string;
    usernamePlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    submit: string;
    submitting: string;
    error: string;
    errorNetwork: string;
    logout: string;
    sessionExpired: string;
    back: string;
    role: {
      admin: string;
      user: string;
      vip: string;
      premium: string;
      elite: string;
    };
    preview: {
      title: string;
      banner: string;
      myRole: string;
      exit: string;
      error: string;
    };
    guest: {
      title: string;
      subtitle: string;
      continue: string;
      createLocal: string;
      login: string;
      loginPassword: string;
      noAccountHint: string;
      badge: string;
      hint: string;
    };
    tg: {
      title: string;
      description: string;
      codePlaceholder: string;
      submit: string;
      back: string;
      errorGeneric: string;
      openBot: string;
      oidc: {
        button: string;
        orCode: string;
        errorGeneric: string;
      };
      deepLink: {
        cta: string;
        waiting: string;
        cancel: string;
        expired: string;
        orCode: string;
      };
      guide: {
        title: string;
        step1: {
          title: string;
          text: string;
        };
        step2: {
          title: string;
          text: string;
        };
        step3: {
          title: string;
          text: string;
        };
        botLink: string;
        channelLink: string;
        fallback: string;
        toggle: string;
      };
    };
    login: {
      tgLink: string;
    };
    setup: {
      title: string;
      subtitle: string;
      username: string;
      usernamePlaceholder: string;
      password: string;
      passwordPlaceholder: string;
      confirmPassword: string;
      confirmPasswordPlaceholder: string;
      submit: string;
      submitting: string;
      errorMismatch: string;
      errorExists: string;
      errorValidation: string;
      adminBadge: string;
    };
    users: {
      title: string;
      subtitle: string;
      addUser: string;
      username: string;
      usernamePlaceholder: string;
      password: string;
      passwordPlaceholder: string;
      role: string;
      roleAdmin: string;
      roleUser: string;
      roleVip: string;
      rolePremium: string;
      roleElite: string;
      create: string;
      creating: string;
      delete: string;
      deleteTitle: string;
      deleteMessage: string;
      deleteConfirm: string;
      empty: string;
      colUsername: string;
      colRole: string;
      colActions: string;
      errorSelfDelete: string;
      errorLastAdmin: string;
      errorDuplicate: string;
      errorValidation: string;
      created: string;
      deleted: string;
      updated: string;
      createFailed: string;
      deleteFailed: string;
      loadFailed: string;
    };
  };
}
