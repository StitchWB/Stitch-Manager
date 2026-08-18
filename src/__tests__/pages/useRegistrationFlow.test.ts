import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';

// babel-jest hoists jest.mock() above imports and forbids referencing
// out-of-scope variables inside the factory unless prefixed with `mock`.
const mockAddNotification = jest.fn();
jest.mock('../../stores/app', () => ({
  useAppStore: () => ({ addNotification: mockAddNotification }),
}));

jest.mock('../../stores/registration', () => ({
  useRegistrationStore: (selector?: any) => {
    const store = {
      addLog: jest.fn(),
      addHistoryEntry: jest.fn(),
      setActiveThreads: jest.fn(),
      setIsStopping: jest.fn(),
      setPipelineJobId: jest.fn(),
      activeThreads: [],
      isStopping: false,
    };
    return selector ? selector(store) : store;
  },
}));

jest.mock('../../lib/backend', () => ({
  testImapConnection: jest.fn(async () => 'ok'),
  stopRegistration: jest.fn(async () => undefined),
}));

const mockRunRegistration = jest.fn();
jest.mock('../../pages/AutoReg/services', () => ({
  runRegistration: (...args: any[]) => mockRunRegistration(...args),
}));

import { useRegistrationFlow } from '../../pages/AutoReg/hooks/useRegistrationFlow';

describe('useRegistrationFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockRunRegistration as any).mockResolvedValue({ successCount: 1, skipCount: 0, failCount: 0 });
  });

  it('allows openai provider and calls registration runner', async () => {
    const config: any = {
      provider: 'openai',
      count: 1,
      imap: { strategy: 'custom' },
      advanced: { delayBetweenAccounts: 1 },
    };

    const { result } = renderHook(() =>
      useRegistrationFlow({
        config,
        emailDomain: 'example.com',
        useRegistrationV2: false,
        canStart: true,
        onThreadsChange: () => undefined,
      })
    );

    await act(async () => {
      await result.current.handleStart();
    });

    expect(mockRunRegistration).toHaveBeenCalledTimes(1);
    expect(mockAddNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Provider not supported' })
    );
  });
});
