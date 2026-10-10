/**
 * AiOverview card navigation tests.
 *
 * Verifies the hub action cards navigate to their declared targets:
 * the Antigravity card must aim at the /ai/antigravity oauth wrapper
 * route (not the declarative plugin page).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect, type ReactNode } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AiOverview from '@/pages/AiOverview';

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/components/layout/Header', () => ({
  __esModule: true,
  default: () => <div data-testid="header" />,
}));

jest.mock('@/components/ui', () => ({
  Button: ({
    children,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    'aria-label'?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  GlassCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PageHeader: () => <div data-testid="page-header" />,
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

let navigatedPath = '';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
  }, [loc.pathname]);
  return null;
}

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={['/ai']}>
      <LocationSpy />
      <Routes>
        <Route path="/ai" element={<AiOverview />} />
        <Route path="/ai/antigravity" element={<div data-testid="terminal" />} />
        <Route path="/ai/providers" element={<div data-testid="terminal" />} />
        <Route path="/ai/plugin/:id" element={<div data-testid="terminal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AiOverview card navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
  });

  it('navigates the Antigravity card to the /ai/antigravity oauth wrapper route', async () => {
    renderOverview();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Antigravity' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/antigravity');
    });
  });

  it('navigates the API keys card to the providers section', async () => {
    renderOverview();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'API keys' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/providers');
    });
  });
});
