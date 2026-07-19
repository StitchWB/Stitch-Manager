import type { RegistrationConfig } from '../../../stores/registration/types';

export type PythonAliasStrategy = 'gmail' | 'addyio' | '33mail' | 'mailtm' | 'icloud_pool' | 'custom' | 'cf-to-imap';

export function validateAliasConfiguration(
  strategy: PythonAliasStrategy,
  config: RegistrationConfig
): string | null {
  if (strategy === '33mail') {
    if (!config.imap.thirtyThreeMailEnabled) {
      return '33mail strategy selected but 33mail is disabled in configuration';
    }
    if (!config.imap.thirtyThreeMailUsername?.trim()) {
      return '33mail username is required when 33mail alias generation is enabled';
    }
    return null;
  }

  if (strategy === 'addyio') {
    if (!config.imap.addyioEnabled) {
      return 'addy.io strategy selected but addy.io is disabled in configuration';
    }
    if (!config.imap.addyioApiToken?.trim()) {
      return 'Addy.io API token is required when addy.io alias generation is enabled';
    }
    return null;
  }

  if (strategy === 'mailtm' && !config.imap.mailtmEnabled) {
    return 'Mail.tm strategy selected but Mail.tm is disabled in configuration';
  }

  if (strategy === 'icloud_pool' && !config.imap.icloudEnabled) {
    return 'iCloud pool strategy selected but iCloud is disabled in configuration';
  }

  return null;
}
