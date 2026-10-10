/**
 * OpenCodeConfig URL-driven tab state tests (P2.3).
 *
 * Verifies:
 *   (a) The active tab comes from the ?tab= search param; the URL search is
 *       preserved for valid tabs.
 *   (b) Without a tab param the providers tab renders.
 *   (c) An unknown tab param is replaced with the default.
 *   (d) A legacy localStorage tab seed migrates once to ?tab= and the key
 *       is removed.
 *   (e) The header TabButton strip switches tabs through the URL.
 *   (f) The deleted ConnectionsNav client-type strip is gone.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect, type ReactNode } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import OpenCodeConfig from '@/pages/OpenCodeConfig';

jest.mock('@/lib/backend/modules/opencodeConfig', () => ({
  getOpenCodeConfig: jest.fn(async () => ({})),
  getOhMyOpenAgentConfig: jest.fn(async () => ({})),
  setOpenCodeConfig: jest.fn(async () => undefined),
  setOhMyOpenAgentConfig: jest.fn(async () => undefined),
  validateModelConfig: jest.fn(() => []),
}));

jest.mock('@/components/opencode/ProvidersSection', () => ({
  ProvidersSection: () => <div data-testid="opencode-providers-section" />,
}));
jest.mock('@/components/opencode/AgentsSection', () => ({
  AgentsSection: () => <div data-testid="opencode-agents-section" />,
}));
jest.mock('@/components/opencode/GeneralSection', () => ({
  GeneralSection: () => <div data-testid="opencode-general-section" />,
}));
jest.mock('@/components/opencode/ModelsSection', () => ({
  ModelsSection: () => <div data-testid="opencode-models-section" />,
}));
jest.mock('@/components/opencode/ApiTesterSection', () => ({
  ApiTesterSection: () => <div data-testid="opencode-tester-section" />,
}));

jest.mock('@/components/layout/Header', () => ({
  __esModule: true,
  default: () => <div data-testid="header" />,
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  ButtonBase: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
  PageHeader: () => <div data-testid="page-header" />,
  StatusBadge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  TabButton: ({
    onClick,
    label,
    active,
  }: {
    onClick?: () => void;
    label?: ReactNode;
    active?: boolean;
  }) => (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}>
      {label}
    </button>
  ),
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

let navigatedPath = '';
let navigatedSearch = '';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
    navigatedSearch = loc.search;
  }, [loc.pathname, loc.search]);
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationSpy />
      <Routes>
        <Route path="/ai/opencode-config" element={<OpenCodeConfig />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('OpenCodeConfig URL tab state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    navigatedPath = '';
    navigatedSearch = '';
  });

  it('(a) renders the agents section from ?tab=agents and preserves the search', async () => {
    renderAt('/ai/opencode-config?tab=agents');

    expect(await screen.findByTestId('opencode-agents-section')).toBeTruthy();
    expect(screen.queryByTestId('opencode-providers-section')).toBeNull();
    expect(navigatedSearch).toBe('?tab=agents');
  });

  it('(b) defaults to the providers tab without a tab param', async () => {
    renderAt('/ai/opencode-config');

    expect(await screen.findByTestId('opencode-providers-section')).toBeTruthy();
    expect(navigatedSearch).toBe('');
  });

  it('(c) replaces an unknown tab param with the default', async () => {
    renderAt('/ai/opencode-config?tab=bogus');

    expect(await screen.findByTestId('opencode-providers-section')).toBeTruthy();
    await waitFor(() => {
      expect(navigatedSearch).toBe('?tab=providers');
    });
  });

  it('(d) migrates the legacy localStorage tab once and removes the key', async () => {
    window.localStorage.setItem('opencode-config-active-tab', 'agents');

    renderAt('/ai/opencode-config');

    expect(await screen.findByTestId('opencode-agents-section')).toBeTruthy();
    await waitFor(() => {
      expect(navigatedSearch).toBe('?tab=agents');
    });
    expect(window.localStorage.getItem('opencode-config-active-tab')).toBeNull();
  });

  it('(e) switches tabs through the header tab strip', async () => {
    renderAt('/ai/opencode-config');

    expect(await screen.findByTestId('opencode-providers-section')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    });

    await waitFor(() => {
      expect(navigatedSearch).toBe('?tab=agents');
    });
    expect(await screen.findByTestId('opencode-agents-section')).toBeTruthy();
  });

  it('(f) renders no connections client-type nav', async () => {
    renderAt('/ai/opencode-config');

    expect(await screen.findByTestId('opencode-providers-section')).toBeTruthy();
    expect(screen.queryByText('IDE & CLI')).toBeNull();
  });
});
