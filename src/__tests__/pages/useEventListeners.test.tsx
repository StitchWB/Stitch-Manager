import { describe, it, expect, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react';

const listenMock = jest.fn(async () => () => undefined);
jest.mock('@tauri-apps/api/event', () => ({
  listen: (...args: any[]) => (listenMock as any)(...args),
}));

const loadSettingsSpy = jest.fn();
const addLogSpy = jest.fn();
const addResultSpy = jest.fn();

jest.mock('../../stores/registration', () => ({
  useRegistrationStore: {
    getState: () => ({
      addLog: addLogSpy,
      addResult: addResultSpy,
      loadSettings: loadSettingsSpy,
    }),
  },
}));

import { useEventListeners } from '../../pages/AutoReg/hooks/useEventListeners';

describe('useEventListeners', () => {
  it('registers SETTINGS_UPDATED listener but does not reload on window focus', async () => {
    const addWindowListenerSpy = jest.spyOn(window, 'addEventListener');

    renderHook(() => useEventListeners({ onThreadsChange: () => undefined }));

    // No focus listener should be attached anymore.
    expect(addWindowListenerSpy).not.toHaveBeenCalledWith('focus', expect.any(Function));

    const registeredEvents = (listenMock.mock.calls as unknown as any[][]).map(call => call[0]);
    expect(registeredEvents).toContain('SETTINGS_UPDATED');

    addWindowListenerSpy.mockRestore();
  });
});
