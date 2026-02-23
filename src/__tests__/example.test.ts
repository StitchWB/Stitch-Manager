/**
 * Example test file demonstrating testing patterns
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  mockTauriInvoke,
  clearTauriMocks,
  createMockSettings,
  createMockAccount,
  createSuccessMockHandler,
} from './utils/mockTauri';

describe('Example Test Suite', () => {
  beforeEach(() => {
    // Setup mocks before each test
    mockTauriInvoke(createSuccessMockHandler());
  });

  afterEach(() => {
    // Clean up after each test
    clearTauriMocks();
  });

  it('should create mock settings', () => {
    const settings = createMockSettings({
      emailStrategy: 'addyio_imap',
      headless: false,
    });

    expect(settings.emailStrategy).toBe('addyio_imap');
    expect(settings.headless).toBe(false);
    expect(settings.imapHost).toBe('imap.gmail.com');
  });

  it('should create mock account', () => {
    const account = createMockAccount({
      provider: 'kiro',
      email: 'custom@example.com',
    });

    expect(account.provider).toBe('kiro');
    expect(account.email).toBe('custom@example.com');
    expect(account.status).toBe('active');
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve('test');
    expect(result).toBe('test');
  });
});
