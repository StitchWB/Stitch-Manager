/**
 * Devbox service cards — per-service badge state from the poll cards and the
 * inline recovery actions (ingress up, runner restart, bridge stack start,
 * watchdog toggle) dispatching the right plugin commands through onAction.
 *
 * Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import type { DevboxAccepted, DevboxVitalCard } from '@/lib/backend/modules/devbox';
import {
  DevboxServiceCards,
  type DevboxServiceCardsProps,
} from '@/components/devbox/DevboxServiceCards';
import { devboxRouter, devboxCallArgs, overviewFixture, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

function renderCards(props: Partial<DevboxServiceCardsProps> = {}) {
  const onAction = jest.fn((_action: Promise<DevboxAccepted>) => undefined);
  render(
    <DevboxServiceCards
      cards={overviewFixture.cards}
      activeProfile="midsai"
      busy={false}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
      {...props}
    />,
  );
  return onAction;
}

function cardValue(id: string): string | null {
  const el = screen.queryByTestId(`devbox-service-value-${id}`);
  return el ? el.textContent : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(devboxRouter(pageRoutes()));
});

describe('DevboxServiceCards badge states', () => {
  it('renders a badge per known service with its poll value', () => {
    renderCards();

    expect(cardValue('ingress')).toBe('up');
    expect(cardValue('watchdog')).toBe('on');
    expect(cardValue('runner')).toBe('down');
    expect(screen.getByTestId('devbox-service-host_services')).toBeTruthy();
  });

  it('renders unknown state without actions when cards are missing', () => {
    renderCards({ cards: null });

    expect(cardValue('ingress')).toBe('—');
    expect(screen.queryByTestId('devbox-service-ingress-enable')).toBeNull();
    expect(screen.queryByTestId('devbox-service-runner-restart')).toBeNull();
  });

  it('gives a downed card the warning tone', () => {
    renderCards();

    const runner = screen.getByTestId('devbox-service-runner');
    expect(runner.className).toContain('border-amber-500/30');
    expect(screen.getByTestId('devbox-service-value-runner').className).toContain(
      'text-amber-300',
    );
  });
});

describe('DevboxServiceCards inline actions', () => {
  it('runner down offers restart and fires stack_start for the active profile', async () => {
    const onAction = renderCards();

    fireEvent.click(screen.getByTestId('devbox-service-runner-restart'));
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]);
    });
  });

  it('ingress down offers enable and fires ingress_control up', async () => {
    const cards = overviewFixture.cards.map(c =>
      c.id === 'ingress' ? { ...c, value: 'down', tone: 'down' as const } : c,
    );
    renderCards({ cards });

    fireEvent.click(screen.getByTestId('devbox-service-ingress-enable'));
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'ingress_control')).toEqual([{ action: 'up' }]);
    });
  });

  it('bridge down offers stack start', async () => {
    const cards: DevboxVitalCard[] = [
      ...overviewFixture.cards,
      { id: 'bridge', title: 'Bridge', value: 'down', tone: 'down', updatedAt: null },
    ];
    renderCards({ cards });

    fireEvent.click(screen.getByTestId('devbox-service-bridge-start'));
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]);
    });
  });

  it('watchdog toggle sends stop when on and start when off', async () => {
    renderCards();

    const toggle = screen
      .getByTestId('devbox-service-watchdog')
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'watchdog_control')).toEqual([{ action: 'stop' }]);
    });
  });

  it('watchdog toggle sends start when off', async () => {
    const cards = overviewFixture.cards.map(c =>
      c.id === 'watchdog' ? { ...c, value: 'off', tone: 'ok' as const } : c,
    );
    renderCards({ cards });

    const toggle = screen
      .getByTestId('devbox-service-watchdog')
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'watchdog_control')).toEqual([{ action: 'start' }]);
    });
  });

  it('host services badge has no inline action', () => {
    renderCards();

    const host = screen.getByTestId('devbox-service-host_services');
    expect(host.querySelector('button')).toBeNull();
  });

  it('host services 0/0 renders neutral gray even with tone ok', () => {
    const cards: DevboxVitalCard[] = [
      ...overviewFixture.cards,
      { id: 'host_services', title: 'Host services', value: '0/0', tone: 'ok', updatedAt: null },
    ];
    renderCards({ cards });

    const host = screen.getByTestId('devbox-service-host_services');
    expect(host.querySelector('.bg-slate-500')).toBeTruthy();
    expect(screen.getByTestId('devbox-service-value-host_services').className).toContain(
      'text-slate-400',
    );
    expect(screen.getByTestId('devbox-service-value-host_services').textContent).toBe('0/0');
  });

  it('host services green only when recorded and alive are above zero', () => {
    const cards: DevboxVitalCard[] = [
      ...overviewFixture.cards,
      { id: 'host_services', title: 'Host services', value: '2/3', tone: 'ok', updatedAt: null },
    ];
    renderCards({ cards });

    const host = screen.getByTestId('devbox-service-host_services');
    expect(host.querySelector('.bg-emerald-400')).toBeTruthy();
  });

  it('host services amber when recorded but none alive', () => {
    const cards: DevboxVitalCard[] = [
      ...overviewFixture.cards,
      { id: 'host_services', title: 'Host services', value: '0/3', tone: 'warn', updatedAt: null },
    ];
    renderCards({ cards });

    const host = screen.getByTestId('devbox-service-host_services');
    expect(host.querySelector('.bg-amber-400')).toBeTruthy();
    expect(screen.getByTestId('devbox-service-value-host_services').className).toContain(
      'text-amber-300',
    );
  });

  it('disables inline actions while busy', () => {
    renderCards({ busy: true });

    expect(screen.getByTestId('devbox-service-runner-restart')).toBeDisabled();
  });
});
