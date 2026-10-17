import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('@/stores/app', () => {
  const state = { sidebarCollapsed: false, toggleSidebar: () => undefined, language: 'en' };
  return {
    __esModule: true,
    useAppStore: Object.assign(() => state, { getState: () => state }),
  };
});

jest.mock('@/stores/auth', () => {
  const holder: { state: Record<string, unknown> } = { state: {} };
  return {
    __esModule: true,
    useAuthStore: (selector?: (s: Record<string, unknown>) => unknown) =>
      selector ? selector(holder.state) : holder.state,
    effectiveRole: (user: { role?: string } | null) => user?.role ?? null,
    __setAuthState: (state: Record<string, unknown>) => {
      holder.state = state;
    },
  };
});

jest.mock('@/lib/backend/core/url', () => ({
  __esModule: true,
  isDesktopApp: () => false,
}));

jest.mock('@/lib/backend/modules/aiProxy', () => ({
  __esModule: true,
  openUrlInBrowser: () => undefined,
}));

jest.mock('@/components/ui/Tooltip', () => ({
  __esModule: true,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/ui/OverflowMenu', () => ({
  __esModule: true,
  OverflowMenu: () => null,
}));

import Sidebar from '@/components/layout/Sidebar';
import * as authStoreModule from '@/stores/auth';

const setAuthState = (
  authStoreModule as unknown as { __setAuthState: (s: Record<string, unknown>) => void }
).__setAuthState;

const DOCUMENT_POSITION_FOLLOWING = 4;

const adminUser = { id: 1, username: 'admin', role: 'admin', tg_tier: 'user' };

function authState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    required: true,
    hasUsers: true,
    user: adminUser,
    guest: false,
    logout: () => undefined,
    busy: false,
    exitGuest: () => undefined,
    hasPermission: () => true,
    setPreviewRole: () => undefined,
    ...overrides,
  };
}

function navHrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('nav a')).map(a => a.getAttribute('href') ?? '');
}

describe('Sidebar sections', () => {
  beforeEach(() => {
    setAuthState(authState());
  });

  it('renders section labels in order and admin-only items for admin with auth enabled', () => {
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    const operations = screen.getByText(/Operations|Операции/);
    const toolsAi = screen.getByText(/Tools & AI|Инструменты и AI/);
    const ecosystem = screen.getByText(/Ecosystem|Экосистема/);
    const system = screen.getByText(/System|Система/);

    expect(operations.compareDocumentPosition(toolsAi) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toolsAi.compareDocumentPosition(ecosystem) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ecosystem.compareDocumentPosition(system) & DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const hrefs = navHrefs(container);
    for (const path of ['/admin', '/users', '/codes', '/partners', '/monitoring', '/privileges']) {
      expect(hrefs).toContain(path);
    }
    expect(hrefs).not.toContain('/plugins');
  });

  it('hides permission-guarded items when hasPermission returns false', () => {
    setAuthState(authState({ hasPermission: () => false }));
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    const hrefs = navHrefs(container);
    for (const path of ['/autoreg', '/automation', '/mail', '/ai', '/tools', '/totp', '/settings', '/logs']) {
      expect(hrefs).not.toContain(path);
    }
    expect(hrefs).toContain('/accounts');
  });
});
