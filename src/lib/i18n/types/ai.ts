export interface AiTranslations {
  ai: {
    groups: {
      title: string;
      tabAccounts: string;
      accountsEmpty: string;
      accountsHint: string;
      removeShare: string;
      search: {
        placeholder: string;
      };
      empty: {
        title: string;
        desc: string;
      };
      create: {
        title: string;
        nameLabel: string;
        namePh: string;
        cta: string;
        success: string;
        failed: string;
      };
      actions: {
        rename: string;
        leave: string;
        delete: string;
        deleteViaSettings: string;
      };
      role: {
        owner: string;
        member: string;
      };
      meta: string;
      invite: {
        placeholder: string;
        send: string;
        sent: string;
        duplicate: string;
        accepted: string;
        declined: string;
        revoked: string;
        notFound: string;
        notPending: string;
        revokeForbidden: string;
        banner: {
          title: string;
          from: string;
          accept: string;
          decline: string;
        };
        pending: string;
        revoke: string;
      };
      members: {
        title: string;
        remove: string;
        leaveConfirm: {
          title: string;
          body: string;
          confirm: string;
          soleOwner: string;
        };
        removeConfirm: {
          title: string;
          body: string;
          confirm: string;
        };
        transfer: {
          action: string;
          confirmTitle: string;
          confirmBody: string;
          success: string;
        };
      };
      usage: {
        title: string;
        today: string;
        week: string;
        requests: string;
        tokens: string;
        empty: string;
        history30: string;
      };
      quotas: {
        title: string;
        empty: string;
        addRule: string;
        scopeMember: string;
        scopePool: string;
        everyone: string;
        wholePool: string;
        modelLabel: string;
        modelPh: string;
        unitLabel: string;
        unitRequests: string;
        unitTokens: string;
        amountLabel: string;
        amountPh: string;
        periodLabel: string;
        periodDaily: string;
        periodTotal: string;
        unlimited: string;
        allModels: string;
        deleteRule: string;
        saved: string;
        deleted: string;
        invalidAmount: string;
      };
      pool: {
        title: string;
        empty: string;
        addedBy: string;
        unshareFromGroup: string;
        addKey: string;
        added: string;
        enable: string;
        disable: string;
        toggled: string;
        unshared: string;
        selectEndpoint: string;
        noEndpoints: string;
      };
      settings: {
        nameLabel: string;
        save: string;
        saved: string;
        deleteConfirm: {
          title: string;
          body: string;
          confirm: string;
        };
      };
      share: {
        action: string;
        pickerTitle: string;
        pickerTitleProxy: string;
        hint: string;
        apply: string;
        consent: {
          title: string;
          body: string;
          canUse: string;
          cannotSee: string;
          cannotEdit: string;
          acknowledge: string;
          confirm: string;
        };
        success: string;
        failed: string;
      };
      unshare: {
        confirm: {
          title: string;
          body: string;
          confirm: string;
        };
      };
      loadFailed: string;
      detailLoadFailed: string;
      selectGroup: string;
    };
    proxy: {
      title: string;
      baseUrl: string;
      defaultKey: string;
      poolLabel: string;
      pool: {
        personal: string;
        legacy: string;
      };
      createKey: string;
      regenerate: string;
      revoke: string;
      rawKeyHint: string;
      regenerateConfirm: {
        title: string;
        body: string;
        confirm: string;
      };
      revokeConfirm: {
        title: string;
        body: string;
      };
      created: string;
      empty: string;
    };
  };
}
