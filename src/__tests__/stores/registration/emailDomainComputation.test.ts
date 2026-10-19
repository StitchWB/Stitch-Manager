import { describe, it, expect } from '@jest/globals';
import { computeEmailDomain } from '../../../pages/AutoReg';

describe('computeEmailDomain', () => {
  it('returns gmail.com for gmail strategy', () => {
    expect(computeEmailDomain({ strategy: 'gmail' })).toBe('gmail.com');
  });

  it('returns emailGenerationDomain for cf-to-imap strategy', () => {
    expect(
      computeEmailDomain({
        strategy: 'cf-to-imap',
        emailGenerationDomain: 'customdomain.com',
      })
    ).toBe('customdomain.com');
  });

  it('returns imap email domain for custom strategy ignoring emailGenerationDomain', () => {
    expect(
      computeEmailDomain({
        strategy: 'custom',
        email: 'user@yandex.ru',
        emailGenerationDomain: 'shouldbeignored.com',
      })
    ).toBe('yandex.ru');
  });

  it('emailGenerationDomain takes precedence over imap email domain for cf-to-imap', () => {
    expect(
      computeEmailDomain({
        strategy: 'cf-to-imap',
        emailGenerationDomain: 'customdomain.com',
        email: 'user@yandex.ru',
      })
    ).toBe('customdomain.com');
  });

  it('returns example.com when no domain sources available', () => {
    expect(computeEmailDomain({ strategy: 'custom' })).toBe('example.com');
  });

  it('returns gmail.com even when emailGenerationDomain is set for gmail strategy', () => {
    expect(
      computeEmailDomain({
        strategy: 'gmail',
        emailGenerationDomain: 'customdomain.com',
      })
    ).toBe('gmail.com');
  });

  it('handles email without @ symbol gracefully', () => {
    expect(
      computeEmailDomain({
        strategy: 'custom',
        email: 'invalid-email',
      })
    ).toBe('example.com');
  });
});
