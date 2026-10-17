import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';

import type { DevboxEventRow } from '@/lib/backend/modules/devbox';
import { DevboxEvents, type DevboxEventsProps } from '@/components/devbox/DevboxEvents';

const rowsFixture: DevboxEventRow[] = [
  { ts: 1791536987.76, kind: 'tool_call', tool: 'bash', status: 'ok' },
  { ts: 1791536990.1, kind: 'permission_request', tool: 'shell', status: 'pending' },
];

function renderEvents(props: Partial<DevboxEventsProps> = {}) {
  const onRetry = jest.fn(() => undefined);
  render(<DevboxEvents rows={rowsFixture} error={null} onRetry={onRetry} {...props} />);
  return onRetry;
}

describe('Devbox events river', () => {
  it('renders one line per normalized row', () => {
    renderEvents();

    const river = screen.getByTestId('devbox-events-river');
    expect(river.children).toHaveLength(2);
    expect(river.children[0].textContent).toContain('tool_call');
    expect(river.children[0].textContent).toContain('bash');
    expect(river.children[1].textContent).toContain('permission_request');
  });

  it('shows the empty state when no rows come back', () => {
    renderEvents({ rows: [] });

    expect(screen.queryByTestId('devbox-events-river')).toBeNull();
    expect(
      screen.getByText('The agent has not called anything yet — see ARENA.md for connection'),
    ).toBeTruthy();
  });

  it('renders the shared poll error with retry', () => {
    const onRetry = renderEvents({ rows: [], error: 'poll exploded' });

    const error = screen.getByTestId('devbox-events-error');
    expect(error.textContent).toContain('poll exploded');
    fireEvent.click(error.querySelector('button')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
