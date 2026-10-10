/**
 * Legacy redirect map tests.
 *
 * Verifies every LEGACY_REDIRECTS entry lands on its target in a single
 * hop: MemoryRouter starts at `from`, the router mounts both redirect
 * scopes plus stub terminal routes for every target, and the LocationSpy
 * must record exactly two locations (start + target).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LEGACY_REDIRECTS, LegacyRedirectRoutes } from '@/components/ai-proxy/LegacyRedirects';

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

let locations: string[] = [];

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    locations.push(loc.pathname);
  }, [loc.pathname]);
  return null;
}

const TERMINAL_TARGETS = [
  '/ai',
  '/groups',
  '/ai/monitor',
  '/ai/providers',
  '/ai/analytics',
  '/ai/antigravity',
  '/ai/notebooklm',
];

describe('LegacyRedirects', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    locations = [];
  });

  for (const entry of LEGACY_REDIRECTS) {
    const target = typeof entry.to === 'function' ? entry.to(new URLSearchParams()) : entry.to;

    it(`redirects ${entry.from} to ${target} in a single hop`, () => {
      render(
        <MemoryRouter initialEntries={[entry.from]}>
          <LocationSpy />
          <Routes>
            {LegacyRedirectRoutes('ai-hub')}
            {LegacyRedirectRoutes('top-level')}
            {TERMINAL_TARGETS.map(path => (
              <Route key={path} path={path} element={<div data-testid="terminal" />} />
            ))}
          </Routes>
        </MemoryRouter>,
      );

      expect(locations[locations.length - 1]).toBe(target);
      expect(locations).toHaveLength(2);
      expect(screen.getByTestId('terminal')).toBeTruthy();
    });
  }
});
