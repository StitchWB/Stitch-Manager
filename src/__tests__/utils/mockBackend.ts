/**
 * Mock utilities for Backend commands
 * Use these to mock Backend invoke calls in tests
 */

import type { SettingsData, Account, RegistrationConfig } from '@/types/generated';

type InvokeHandler = (cmd: string, args?: any) => Promise<any>;

let mockInvokeHandler: InvokeHandler | null = null;

/**
 * Mock the Backend invoke function
 * @param handler - Function to handle invoke calls
 */
export function mockBackendInvoke(handler: InvokeHandler) {
  mockInvokeHandler = handler;
}

/**
 * Clear all Backend mocks
 */
export function clearBackendMocks() {
  mockInvokeHandler = null;
}

/**
 * Mock invoke implementation
 */
export async function invoke<T>(cmd: string, args?: any): Promise<T> {
  if (mockInvokeHandler) {
    return mockInvokeHandler(cmd, args);
  }
  throw new Error(`Unmocked Backend command: ${cmd}`);
}

/**
 * Create a mock settings response
 */
export function createMockSettings(overrides?: Partial<SettingsData>): SettingsData {
  return {
    emailStrategy: 'static_imap',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapUser: 'test@example.com',
    imapPassword: 'password',
    headless: true,
    speedMultiplier: 1.0,
    verificationCodeTimeout: 120,
    oauthCallbackTimeout: 300,
    pageLoadTimeout: 30,
    passwordLength: 16,
    ...overrides,
  };
}

/**
 * Create a mock account
 */
export function createMockAccount(overrides?: Partial<Account>): Account {
  return {
    id: 1,
    provider: 'github',
    email: 'test@example.com',
    password: 'password123',
    status: 'active',
    quotaUsed: 0,
    quotaLimit: 100,
    createdAt: new Date().toISOString(),
    lastUsed: null,
    useCount: 0,
    errorCount: 0,
    successRate: 0,
    loginCount: 0,
    metadata: null,
    ...overrides,
  };
}

/**
 * Create a mock registration config
 */
export function createMockRegistrationConfig(
  overrides?: Partial<RegistrationConfig>
): RegistrationConfig {
  return {
    provider: 'github',
    email: 'test@example.com',
    password: 'password123',
    headless: true,
    imapServer: 'imap.gmail.com',
    imapPort: 993,
    imapUser: 'test@example.com',
    imapPassword: 'password',
    ...overrides,
  };
}

/**
 * Mock successful command responses
 */
export const mockSuccessResponses = {
  get_settings: () => Promise.resolve(createMockSettings()),
  save_settings: () => Promise.resolve(undefined),
  get_accounts: () => Promise.resolve([createMockAccount()]),
  get_account: () => Promise.resolve(createMockAccount()),
  delete_account: () => Promise.resolve(undefined),
  start_registration: () => Promise.resolve({ taskId: 'test-task-id' }),
};

/**
 * Mock error responses
 */
export const mockErrorResponses = {
  get_settings: () => Promise.reject(new Error('Failed to load settings')),
  save_settings: () => Promise.reject(new Error('Failed to save settings')),
  get_accounts: () => Promise.reject(new Error('Failed to load accounts')),
  delete_account: () => Promise.reject(new Error('Failed to delete account')),
};

/**
 * Create a mock invoke handler that returns success responses
 */
export function createSuccessMockHandler(): InvokeHandler {
  return async (cmd: string, _args?: any) => {
    const handler = mockSuccessResponses[cmd as keyof typeof mockSuccessResponses];
    if (handler) {
      return handler();
    }
    throw new Error(`No mock handler for command: ${cmd}`);
  };
}

/**
 * Create a mock invoke handler that returns error responses
 */
export function createErrorMockHandler(): InvokeHandler {
  return async (cmd: string, _args?: any) => {
    const handler = mockErrorResponses[cmd as keyof typeof mockErrorResponses];
    if (handler) {
      return handler();
    }
    throw new Error(`No mock handler for command: ${cmd}`);
  };
}
