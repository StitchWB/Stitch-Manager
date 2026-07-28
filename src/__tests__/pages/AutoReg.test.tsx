import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AutoReg from '../../pages/AutoReg';

// Mock all heavy subcomponents/hooks to keep this a behavior/contract test.
jest.mock('../../pages/AutoReg/components', () => ({
  CommandCenter: ({
    allowedProviders,
    showDebugLogsInConsole,
  }: {
    allowedProviders?: string[];
    showDebugLogsInConsole?: boolean;
  }) => (
    <div
      data-testid="command-center"
      data-allowed={JSON.stringify(allowedProviders || [])}
      data-show-debug={String(!!showDebugLogsInConsole)}
    />
  ),
  ConsolePanel: ({ showDebug }: { showDebug?: boolean }) => (
    <div data-testid="console-panel" data-show-debug={String(!!showDebug)} />
  ),
}));

jest.mock('../../pages/AutoReg/hooks/useRegistrationFlow', () => ({
  useRegistrationFlow: () => ({
    activeThreads: 0,
    isStopping: false,
    handleStart: jest.fn(),
    handleTestImap: jest.fn(async () => true),
    handleStop: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../pages/AutoReg/hooks/useEventListeners', () => ({
  useEventListeners: () => undefined,
}));

jest.mock('../../pages/AutoReg/hooks/useAddyioConnection', () => ({
  useAddyioConnection: () => ({
    addyioDomains: [],
    addyioAccountInfo: null,
    isTestingAddyio: false,
    addyioConnectionStatus: 'idle',
    addyioConnectionMessage: '',
    handleTestAddyioConnection: jest.fn(async () => undefined),
  }),
}));

jest.mock('../../stores/uiPreferences', () => ({
  useUIPreferencesStore: () => ({
    autoRegPage: { activeTab: 'identity', useRegistrationV2: false },
    setAutoRegTab: jest.fn(),
    setAutoRegV2: jest.fn(),
    setAutoRegRunning: jest.fn(),
  }),
}));

jest.mock('../../lib/backend', () => ({
  checkPythonAutoreg: jest.fn(async () => true),
}));

// Registration store is a facade; we mock it to return new function refs on each call
// so we can detect whether AutoReg re-runs its init effect on re-render.
//
// IMPORTANT: `loadSettingsSpy`/`saveImmediatelySpy` live INSIDE the factory.
// babel-jest hoists `jest.mock()` calls to the top of the file, so any outer
// `const` declared after imports is in the TDZ when the factory runs — which
// causes "setPipelineJobId is not a function" because the whole store object
// becomes undefined.  Tests can access spies via:
//   const { __spies } = jest.requireMock('../../stores/registration');
jest.mock('../../stores/registration', () => {
  const loadSettingsSpy = jest.fn();
  const saveImmediatelySpy = jest.fn();

  const storeState = {
    config: {
      provider: 'kiro',
      count: 3,
      imap: { strategy: 'custom', server: '', port: 993, email: '', password: '' },
      proxy: { enabled: false, url: '' },
      patterns: { emailPattern: 'provider_timestamp' },
      advanced: {
        headless: false,
        speedMultiplier: 1,
        delayBetweenAccounts: 2,
        verificationCodeTimeout: 120,
        oauthCallbackTimeout: 90,
        allowAccessWait: 120,
        pageLoadTimeout: 5,
        elementWaitTimeout: 2,
        imapPollInterval: 1,
        passwordLength: 16,
        realisticTyping: true,
        humanDelays: true,
        screenshotsOnError: true,
      },
    },
    logs: [],
    successCount: 0,
    failedCount: 0,
    imapPasswordSet: false,
    gmailAppPasswordSet: false,
    saveStatus: 'idle',
    activeProvider: null,
    logVerbosity: 'normal',
    setProvider: jest.fn(),
    setIMAPConfig: jest.fn(),
    setProxyConfig: jest.fn(),
    setAdvancedSettings: jest.fn(),
    setCount: jest.fn(),
    setLogVerbosity: jest.fn(),
    clearLogs: jest.fn(),
    setActiveProvider: jest.fn(),
    setActiveThreads: jest.fn(),
    setIsStopping: jest.fn(),
    setPipelineJobId: jest.fn(),
    addLog: jest.fn(),
    addHistoryEntry: jest.fn(),
    activeThreads: [],
    isStopping: false,
    pipelineJobId: null,
  };

  // Support both `useRegistrationStore()` (no args) and selector calls
  // `useRegistrationStore(state => state.setPipelineJobId)` that AutoReg uses.
  const useRegistrationStore = (selector?: any) =>
    selector ? selector(storeState) : storeState;

  // Static accessor used by AutoReg init effect.
  (useRegistrationStore as any).getState = () => ({
    settingsLoaded: true,
    loadSettings: loadSettingsSpy,
    saveImmediately: saveImmediatelySpy,
    ...storeState,
  });

  return { useRegistrationStore, __spies: { loadSettingsSpy, saveImmediatelySpy } };
});

describe('AutoReg page', () => {
  // Retrieve spies that were declared inside the jest.mock() factory.
  const { __spies } = jest.requireMock('../../stores/registration') as {
    __spies: { loadSettingsSpy: jest.Mock; saveImmediatelySpy: jest.Mock };
  };
  const { loadSettingsSpy, saveImmediatelySpy } = __spies;

  const renderAutoReg = () =>
    render(
      <MemoryRouter>
        <AutoReg />
      </MemoryRouter>
    );

  beforeEach(() => {
    loadSettingsSpy.mockClear();
    saveImmediatelySpy.mockClear();
  });

  it('calls loadSettings only once on mount (does not re-run init effect on rerender)', () => {
    const { rerender } = renderAutoReg();

    expect(loadSettingsSpy).toHaveBeenCalledTimes(1);

    rerender(
      <MemoryRouter>
        <AutoReg />
      </MemoryRouter>
    );
    expect(loadSettingsSpy).toHaveBeenCalledTimes(1);
  });

  it('passes only supported providers to CommandCenter selector', () => {
    const { getByTestId } = renderAutoReg();
    const cc = getByTestId('command-center');
    const allowed = JSON.parse(cc.getAttribute('data-allowed') || '[]');

    expect(allowed).toEqual(['kiro', 'kiro_v2', 'aws', 'windsurf', 'trae', 'github', 'openai', 'fireworks', 'qoder', 'bitbucket', 'v0_app']);
    expect(allowed).toContain('openai');
  });

  it('includes openai in supported providers allowlist', () => {
    const { getByTestId } = renderAutoReg();
    const cc = getByTestId('command-center');
    const allowed = JSON.parse(cc.getAttribute('data-allowed') || '[]');

    expect(allowed).toContain('openai');
  });

  it('keeps debug visibility toggle synced between CommandCenter and ConsolePanel', () => {
    const { getByTestId } = renderAutoReg();
    const cc = getByTestId('command-center');
    const consolePanel = getByTestId('console-panel');

    expect(cc.getAttribute('data-show-debug')).toBe('false');
    expect(consolePanel.getAttribute('data-show-debug')).toBe('false');
  });

  it('passes debug toggle props to CommandCenter and ConsolePanel', () => {
    const { getByTestId } = renderAutoReg();
    expect(getByTestId('command-center').getAttribute('data-show-debug')).toBe('false');
    expect(getByTestId('console-panel').getAttribute('data-show-debug')).toBe('false');
  });
});
