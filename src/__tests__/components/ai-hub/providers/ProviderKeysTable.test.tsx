import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
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
        onTestSelected={jest.fn()}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={jest.fn()}
      />
    );

    expect(screen.getByText('aiHub.providersPage.colQuota')).toBeTruthy();
    expect(screen.getByText('$14.20')).toBeTruthy();
    expect(screen.getByText('10 мин')).toBeTruthy();
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
        onTestSelected={jest.fn()}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={jest.fn()}
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
        onTestSelected={jest.fn()}
        onToggleEnabled={jest.fn()}
        onDeleteSelected={jest.fn()}
      />
    );

    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});
