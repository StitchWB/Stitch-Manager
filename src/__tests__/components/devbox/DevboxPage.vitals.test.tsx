/**
 * Devbox core page — vitals rendering and 4s polling contract.
 *
 * Mocks: safeInvoke (core invoke, routed by command name through the real
 * devbox contract module), sonner, Header (pulls proxy-status stores),
 * app store. i18n runs REAL so locale registration is exercised.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, act } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

jest.mock('@/components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header-stub">{title}</div>,
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector?: (s: any) => any) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import { DevboxPage } from '@/components/devbox/DevboxPage';
import {
  registerPluginBundles,
  unregisterPluginBundles,
} from '@/lib/i18nPluginBundles';
import { devboxRouter, devboxCalls, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(devboxRouter(pageRoutes()));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Devbox page vitals', () => {
  it('renders overview cards with tone coloring, hint and updatedAt stamp', async () => {
    render(<DevboxPage />);

    const ingress = await screen.findByTestId('devbox-vital-value-ingress');
    expect(ingress.textContent).toBe('up');
    expect(ingress.className).toContain('text-emerald-300');

    const runner = screen.getByTestId('devbox-vital-value-runner');
    expect(runner.textContent).toBe('down');
    expect(runner.className).toContain('text-red-300');

    expect(screen.getAllByText(/Updated /).length).toBeGreaterThan(0);
    expect(screen.getByText('tunnel live')).toBeTruthy();
    expect(devboxCalls(invokeMock, 'overview').length).toBeGreaterThanOrEqual(1);
  });

  it('polls overview on a 4000ms interval', async () => {
    jest.useFakeTimers();
    render(<DevboxPage />);

    await act(async () => {
      await Promise.resolve();
    });
    const initial = devboxCalls(invokeMock, 'overview').length;
    expect(initial).toBeGreaterThanOrEqual(1);

    await act(async () => {
      jest.advanceTimersByTime(3999);
      await Promise.resolve();
    });
    expect(devboxCalls(invokeMock, 'overview').length).toBe(initial);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'overview').length).toBeGreaterThan(initial);
    });
  });

  it('shows the vitals empty state when overview returns no cards', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes({ overview: { cards: [] } })));
    render(<DevboxPage />);

    expect(
      await screen.findByText('No data — the stack is not running or the plugin is unavailable'),
    ).toBeTruthy();
  });

  it('renders legacy overview rows defensively as tone-ok cards', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ overview: [{ title: 'Bridge', value: 'up' }] })),
    );
    render(<DevboxPage />);

    const bridge = await screen.findByTestId('devbox-vital-value-Bridge');
    expect(bridge.textContent).toBe('up');
    expect(bridge.className).toContain('text-emerald-300');
  });

  it('resolves plugin i18n keys in card titles and hints via the plugin bundle', async () => {
    registerPluginBundles('stitch-devbox', {
      en: {
        'stitch-devbox': {
          card: { ingress: 'Ingress tunnel' },
          hint: { ingress: 'Cloudflare tunnel state' },
        },
      },
    });
    try {
      invokeMock.mockImplementation(
        devboxRouter(
          pageRoutes({
            overview: {
              cards: [
                {
                  id: 'ingress',
                  title: 'stitch-devbox.card.ingress',
                  value: 'up',
                  tone: 'ok',
                  hint: 'stitch-devbox.hint.ingress',
                },
                {
                  id: 'bridge',
                  title: 'stitch-devbox.card.missing',
                  value: 'down',
                  tone: 'down',
                },
              ],
            },
          }),
        ),
      );
      render(<DevboxPage />);

      expect(await screen.findByText('Ingress tunnel')).toBeTruthy();
      expect(screen.getByText('Cloudflare tunnel state')).toBeTruthy();
      expect(screen.getByText('stitch-devbox.card.missing')).toBeTruthy();
    } finally {
      unregisterPluginBundles('stitch-devbox');
    }
  });

  it('surfaces a per-command error with retry', async () => {
    invokeMock.mockImplementation(
      devboxRouter({
        ...pageRoutes(),
        overview: () => {
          throw new Error('sidecar exploded');
        },
      }),
    );
    render(<DevboxPage />);

    expect(await screen.findByText('sidecar exploded')).toBeTruthy();
    expect(screen.getAllByText('Retry').length).toBeGreaterThan(0);
  });
});
