import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';

// Mock stores
const addNotification = jest.fn();
jest.mock('../../stores/app', () => ({
  useAppStore: () => ({ addNotification }),
}));

const addLog = jest.fn();
const addHistoryEntry = jest.fn();
jest.mock('../../stores/registration', () => ({
  useRegistrationStore: () => ({ addLog, addHistoryEntry }),
}));

jest.mock('../../lib/tauri', () => ({
  testImapConnection: jest.fn(async () => 'ok'),
  stopRegistration: jest.fn(async () => undefined),
}));

const runRegistration = jest.fn();
jest.mock('../../pages/AutoReg/services', () => ({
  runRegistration: (...args: any[]) => runRegistration(...args),
}));

import { useRegistrationFlow } from '../../pages/AutoReg/hooks/useRegistrationFlow';

describe('useRegistrationFlow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (runRegistration as any).mockResolvedValue({ successCount: 1, skipCount: 0, failCount: 0 });
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

    expect(runRegistration).toHaveBeenCalledTimes(1);
    expect(addNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Provider not supported' })
    );
  });
});
