import { describe, it, expect, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react';

// babel-jest hoists jest.mock() above imports and forbids referencing
// out-of-scope variables inside the factory unless they are prefixed with
// `mock`. mockListen satisfies that rule and is used in assertions below.
const mockListen = jest.fn(async () => () => undefined);
jest.mock('../../lib/events', () => ({
  listen: (...args: any[]) => (mockListen as any)(...args),
}));

jest.mock('../../stores/registration', () => ({
  useRegistrationStore: {
    getState: () => ({
      addLog: jest.fn(),
      addResult: jest.fn(),
      loadSettings: jest.fn(),
    }),
  },
}));

import { useEventListeners } from '../../pages/AutoReg/hooks/useEventListeners';

describe('useEventListeners', () => {
  it('registers SETTINGS_UPDATED listener but does not reload on window focus', async () => {
    const addWindowListenerSpy = jest.spyOn(window, 'addEventListener');

    renderHook(() => useEventListeners({}));

    // No focus listener should be attached anymore.
    expect(addWindowListenerSpy).not.toHaveBeenCalledWith('focus', expect.any(Function));

    const registeredEvents = (mockListen.mock.calls as unknown as any[][]).map(
      (call: any[]) => call[0]
    );
    expect(registeredEvents).toContain('SETTINGS_UPDATED');

    addWindowListenerSpy.mockRestore();
  });
});
