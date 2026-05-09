import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { generateEmail } from '../../../../pages/AutoReg/services/emailGenerator';
import type { IMAPConfig } from '../../../../stores/registration/types';

const mockGetNextCounter = jest.fn() as jest.MockedFunction<
  typeof import('../../../../lib/tauri').getNextCounter
>;
jest.mock('../../../../lib/tauri', () => ({
  getNextCounter: (...args: Parameters<typeof mockGetNextCounter>) =>
    mockGetNextCounter(...args),
}));

describe('emailGenerator', () => {
  beforeEach(() => {
    mockGetNextCounter.mockReset();
    mockGetNextCounter.mockResolvedValue(1);
  });

  it('uses emailDomain parameter for custom strategy (cf-to-imap decoupling)', async () => {
    const imapConfig: IMAPConfig = {
      strategy: 'custom',
      server: 'imap.yandex.ru',
      port: 993,
      email: 'user@yandex.ru',
      password: '',
      useTLS: true,
      emailCustomPrefix: '',
      gmailBase: '',
      gmailAlias: '',
      gmailAppPassword: '',
      emailGenerationDomain: 'customdomain.com',
    };

    const result = await generateEmail({
      provider: 'kiro',
      imapConfig,
      emailPattern: 'provider_timestamp',
      emailDomain: 'customdomain.com',
    });

    expect(result.email).toMatch(/@customdomain\.com$/);
    expect(result.strategy).toBe('custom');
    expect(result.shouldGenerateInPython).toBe(false);
  });

  it('falls back to imap email domain when emailGenerationDomain is empty', async () => {
    const imapConfig: IMAPConfig = {
      strategy: 'custom',
      server: 'imap.yandex.ru',
      port: 993,
      email: 'user@yandex.ru',
      password: '',
      useTLS: true,
      emailCustomPrefix: '',
      gmailBase: '',
      gmailAlias: '',
      gmailAppPassword: '',
      emailGenerationDomain: '',
    };

    const result = await generateEmail({
      provider: 'kiro',
      imapConfig,
      emailPattern: 'provider_timestamp',
      emailDomain: 'yandex.ru',
    });

    expect(result.email).toMatch(/@yandex\.ru$/);
    expect(result.strategy).toBe('custom');
    expect(result.shouldGenerateInPython).toBe(false);
  });

  it('uses custom prefix pattern with provided domain', async () => {
    const imapConfig: IMAPConfig = {
      strategy: 'custom',
      server: 'imap.yandex.ru',
      port: 993,
      email: 'user@yandex.ru',
      password: '',
      useTLS: true,
      emailCustomPrefix: 'test_{rnd}',
      gmailBase: '',
      gmailAlias: '',
      gmailAppPassword: '',
    };

    const result = await generateEmail({
      provider: 'kiro',
      imapConfig,
      emailPattern: 'custom_prefix',
      emailCustomPrefix: 'test_{rnd}',
      emailDomain: 'customdomain.com',
    });

    expect(result.email).toMatch(/^test_[a-z0-9]+@customdomain\.com$/);
  });

  it('generates gmail strategy regardless of emailGenerationDomain', async () => {
    const imapConfig: IMAPConfig = {
      strategy: 'gmail',
      server: '',
      port: 993,
      email: '',
      password: '',
      useTLS: true,
      emailCustomPrefix: '',
      gmailBase: 'user@gmail.com',
      gmailAlias: 'alias_{rnd}',
      gmailAppPassword: '',
      emailGenerationDomain: 'customdomain.com',
    };

    const result = await generateEmail({
      provider: 'kiro',
      imapConfig,
      emailPattern: 'provider_timestamp',
      emailDomain: 'gmail.com',
    });

    expect(result.email).toMatch(/^user\+alias_[a-z0-9]+@gmail\.com$/);
    expect(result.strategy).toBe('gmail');
  });
});
