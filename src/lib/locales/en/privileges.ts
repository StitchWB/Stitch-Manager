import type { PrivilegesTranslations } from '../../i18n/types/privileges';

export const privileges: PrivilegesTranslations = {
  privileges: {
    title: "Privileges",
    subtitle: "Grant or revoke section and action permissions per role",
    adminImmutable: "The admin role always has every permission and cannot be changed",
    sections: "Sections",
    actions: "Actions",
    updated: "Permission updated",
    error: "Failed to update permission",
    key: {
      section: {
        autoreg: "Registration",
        ai_hub: "AI Hub",
        automation: "Automation",
        mail: "Mail",
        tools: "Tools",
        totp: "2FA",
        scenarios: "Scenarios",
        settings: "Settings",
        logs: "Logs",
      },
      action: {
        export_accounts: "Export accounts",
        bulk_delete: "Bulk delete",
        claim: "Claim shared items",
      },
    },
  }
};
