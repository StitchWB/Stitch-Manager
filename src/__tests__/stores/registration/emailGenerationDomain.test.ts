import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  loadEmailGenerationDomain,
  saveEmailGenerationDomain,
} from '../../../stores/registration/utils/migration';

describe('emailGenerationDomain persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and loads emailGenerationDomain', () => {
    saveEmailGenerationDomain('customdomain.com');
    expect(loadEmailGenerationDomain()).toBe('customdomain.com');
  });

  it('returns empty string when not set', () => {
    expect(loadEmailGenerationDomain()).toBe('');
  });

  it('returns empty string when localStorage throws', () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('localStorage error');
    };
    expect(loadEmailGenerationDomain()).toBe('');
    Storage.prototype.getItem = originalGetItem;
  });

  it('handles empty string save correctly', () => {
    saveEmailGenerationDomain('customdomain.com');
    saveEmailGenerationDomain('');
    expect(loadEmailGenerationDomain()).toBe('');
  });
});
