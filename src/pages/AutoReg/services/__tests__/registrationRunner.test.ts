import { describe, it, expect } from '@jest/globals';
import { validateAliasConfiguration } from '../aliasValidation';
import { DEFAULT_CONFIG, type RegistrationConfig } from '../../../../stores/registration/types';

function cloneConfig(): RegistrationConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as RegistrationConfig;
}

describe('validateAliasConfiguration', () => {
  it('returns error when 33mail enabled without username', () => {
    const config = cloneConfig();
    config.imap.thirtyThreeMailEnabled = true;
    config.imap.thirtyThreeMailUsername = '';

    const result = validateAliasConfiguration('33mail', config);
    expect(result).toBe('33mail username is required when 33mail alias generation is enabled');
  });

  it('passes when 33mail enabled with username', () => {
    const config = cloneConfig();
    config.imap.thirtyThreeMailEnabled = true;
    config.imap.thirtyThreeMailUsername = 'my33user';

    const result = validateAliasConfiguration('33mail', config);
    expect(result).toBeNull();
  });

  it('returns error when addy.io enabled without token', () => {
    const config = cloneConfig();
    config.imap.addyioEnabled = true;
    config.imap.addyioApiToken = '';

    const result = validateAliasConfiguration('addyio', config);
    expect(result).toBe('Addy.io API token is required when addy.io alias generation is enabled');
  });

  it('passes when addy.io enabled with token', () => {
    const config = cloneConfig();
    config.imap.addyioEnabled = true;
    config.imap.addyioApiToken = 'token123';

    const result = validateAliasConfiguration('addyio', config);
    expect(result).toBeNull();
  });
});
