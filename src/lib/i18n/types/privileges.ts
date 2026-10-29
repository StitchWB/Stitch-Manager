export interface PrivilegesTranslations {
  privileges: {
    title: string;
    subtitle: string;
    adminImmutable: string;
    sections: string;
    actions: string;
    updated: string;
    error: string;
    key: {
      section: {
        autoreg: string;
        ai_hub: string;
        automation: string;
        mail: string;
        tools: string;
        totp: string;
        scenarios: string;
        settings: string;
        logs: string;
      };
      action: {
        export_accounts: string;
        bulk_delete: string;
        claim: string;
      };
    };
  };
}
