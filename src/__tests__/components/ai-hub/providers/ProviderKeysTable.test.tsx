import { describe, it, expect, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderKeysTable } from '@/components/ai-hub/providers/ProviderKeysTable';
import type { Credential } from '@/lib/backend/modules/aiGateway';

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>): string =>
    params ? `${key} ${Object.values(params).join(' ')}` : key,
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector: (state: { language: string }) => unknown) => selector({ language: 'ru' }),
}));

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-1',
    providerEndpointId: 'ep-1',
    label: 'Key 1',
    authType: 'api_key',
    fingerprint: 'sk-1234567890abcdef',
    enabled: true,
    runtimeStatus: 'active',
    statusReason: null,
    nextRetryAt: null,
    quotaResetAt: null,
    remainingUsd: null,
    remainingCheckedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    createdAt: '2026-11-14T10:00:00Z',
    ...overrides,
  };
}

const noopAction = async () => {};

describe('ProviderKeysTable Quota Column', () => {
  it('renders $X.XX and freshness when remainingUsd and remainingCheckedAt are set', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const cred = makeCredential({
      remainingUsd: 14.2,
      remainingCheckedAt: tenMinAgo,
    });

    render(
      <ProviderKeysTable
        credentials={[cred]}
        loading={false}
        busy={false}
        onAddKeys={jest.fn()}
        onTestSelected={noopAction}
        onRefreshQuotaSelected={noopAction}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={noopAction}
        testResults={{}}
      />
    );

    expect(screen.getByText('aiHub.providersPage.colQuota')).toBeTruthy();
    expect(screen.getByText('$14.20')).toBeTruthy();
    expect(screen.getByText('10 aiHub.providersPage.quotaMinutes')).toBeTruthy();
  });

  it('renders clock badge with reset time when quota_exhausted with future quotaResetAt', () => {
    const futureReset = new Date(Date.now() + 30 * 60 * 1000);
    const futureIso = futureReset.toISOString();
    const cred = makeCredential({
      runtimeStatus: 'quota_exhausted',
      quotaResetAt: futureIso,
      remainingUsd: 0,
    });

    const hh = String(futureReset.getHours()).padStart(2, '0');
    const mm = String(futureReset.getMinutes()).padStart(2, '0');
    const expectedTime = `${hh}:${mm}`;

    render(
      <ProviderKeysTable
        credentials={[cred]}
        loading={false}
        busy={false}
        onAddKeys={jest.fn()}
        onTestSelected={noopAction}
        onRefreshQuotaSelected={noopAction}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={noopAction}
        testResults={{}}
      />
    );

    expect(screen.getByText(expectedTime)).toBeTruthy();
    const badge = screen.getByTitle(`aiHub.providersPage.quotaResetTooltip: ${futureIso}`);
    expect(badge).toBeTruthy();
  });

  it('renders dash for null remainingUsd', () => {
    const cred = makeCredential({
      remainingUsd: null,
      remainingCheckedAt: null,
    });

    render(
      <ProviderKeysTable
        credentials={[cred]}
        loading={false}
        busy={false}
        onAddKeys={jest.fn()}
        onTestSelected={noopAction}
        onRefreshQuotaSelected={noopAction}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={noopAction}
        testResults={{}}
      />
    );

    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ProviderKeysTable Batch Actions', () => {
  function renderTable(overrides: {
    testResults?: Record<string, { success: boolean; latency_ms?: number; error?: string | null }>;
    onTestSelected?: (ids: string[]) => Promise<void>;
    onRefreshQuotaSelected?: (ids: string[]) => Promise<void>;
    onDeleteSelected?: (ids: string[]) => Promise<void>;
  } = {}) {
    const cred = makeCredential();
    render(
      <ProviderKeysTable
        credentials={[cred]}
        loading={false}
        busy={false}
        testResults={overrides.testResults ?? {}}
        onAddKeys={jest.fn()}
        onTestSelected={overrides.onTestSelected ?? noopAction}
        onRefreshQuotaSelected={overrides.onRefreshQuotaSelected ?? noopAction}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={overrides.onDeleteSelected ?? noopAction}
      />
    );
    return cred;
  }

  it('shows test and refresh quota buttons after selecting a key', () => {
    renderTable();
    const checkbox = screen.getByLabelText('aiHub.providersPage.selectAll');
    fireEvent.click(checkbox);
    expect(screen.getByText('aiHub.providersPage.testSelected')).toBeTruthy();
    expect(screen.getByText('aiHub.providersPage.refreshQuota')).toBeTruthy();
  });

  it('calls onTestSelected with the selected ids and clears the selection', async () => {
    const onTestSelected = jest.fn(noopAction);
    const cred = renderTable({ onTestSelected });
    fireEvent.click(screen.getByLabelText('aiHub.providersPage.selectAll'));
    fireEvent.click(screen.getByText('aiHub.providersPage.testSelected'));
    await waitFor(() => expect(onTestSelected).toHaveBeenCalledWith([cred.id]));
    await waitFor(() => expect(screen.queryByText('aiHub.providersPage.testSelected')).toBeNull());
  });

  it('calls onRefreshQuotaSelected with the selected ids and clears the selection', async () => {
    const onRefreshQuotaSelected = jest.fn(noopAction);
    const cred = renderTable({ onRefreshQuotaSelected });
    fireEvent.click(screen.getByLabelText('aiHub.providersPage.selectAll'));
    fireEvent.click(screen.getByText('aiHub.providersPage.refreshQuota'));
    await waitFor(() => expect(onRefreshQuotaSelected).toHaveBeenCalledWith([cred.id]));
    await waitFor(() => expect(screen.queryByText('aiHub.providersPage.refreshQuota')).toBeNull());
  });

  it('keeps the toolbar disabled until the running action settles', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const onTestSelected = jest.fn(async () => {
      await gate;
    });
    renderTable({ onTestSelected });
    fireEvent.click(screen.getByLabelText('aiHub.providersPage.selectAll'));
    fireEvent.click(screen.getByText('aiHub.providersPage.testSelected'));
    await waitFor(() =>
      expect(screen.getByText('aiHub.providersPage.testSelected').closest('button')).toBeDisabled()
    );
    release();
    await waitFor(() => expect(screen.queryByText('aiHub.providersPage.testSelected')).toBeNull());
  });

  it('renders inline latency for a successful probe result', () => {
    renderTable({ testResults: { 'cred-1': { success: true, latency_ms: 123 } } });
    expect(screen.getByText('123 ms')).toBeTruthy();
  });

  it('renders inline error for a failed probe result', () => {
    renderTable({ testResults: { 'cred-1': { success: false, error: 'HTTP 401' } } });
    expect(screen.getByText('HTTP 401')).toBeTruthy();
  });

  it('exposes the full text of a truncated retry hint as a title', () => {
    const nextRetryAt = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
    render(
      <ProviderKeysTable
        credentials={[makeCredential({ runtimeStatus: 'cooldown', nextRetryAt })]}
        loading={false}
        busy={false}
        testResults={{}}
        onAddKeys={jest.fn()}
        onTestSelected={noopAction}
        onRefreshQuotaSelected={noopAction}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={noopAction}
      />
    );
    const hint = screen.getByText(/^aiHub.providersPage.test /);
    expect(hint.getAttribute('title')).toBe(hint.textContent);
  });
});
