import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { Alert, type AlertVariant } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';

const variantCases: Array<[AlertVariant, 'status' | 'alert', string, string]> = [
  ['info', 'status', 'bg-sky-500/10', 'text-sky-400'],
  ['success', 'status', 'bg-emerald-500/10', 'text-emerald-400'],
  ['warning', 'status', 'bg-amber-500/10', 'text-amber-400'],
  ['danger', 'alert', 'bg-red-500/10', 'text-red-400'],
];

describe('Alert', () => {
  it.each(variantCases)(
    'renders the %s variant with role %s and a tinted surface',
    (variant, role, background, iconColor) => {
      render(<Alert variant={variant} message="Something happened" />);
      const alert = screen.getByRole(role);
      expect(alert.className).toContain(background);
      expect(alert.querySelector('svg')?.getAttribute('class')).toContain(iconColor);
      expect(screen.getByText('Something happened')).toBeTruthy();
    },
  );

  it('defaults to the info variant with a polite role', () => {
    render(<Alert message="Heads up" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders title, message and optional detail', () => {
    render(
      <Alert variant="warning" title="Degraded" message="Relay is stale" detail="Last probe 5m ago" />,
    );
    expect(screen.getByText('Degraded')).toBeTruthy();
    expect(screen.getByText('Relay is stale')).toBeTruthy();
    expect(screen.getByText('Last probe 5m ago')).toBeTruthy();
  });

  it('renders a message without a title', () => {
    render(<Alert message="Just a message" />);
    expect(screen.getByText('Just a message')).toBeTruthy();
  });

  it('renders optional actions and keeps them interactive', () => {
    const onRetry = jest.fn();
    render(
      <Alert
        variant="danger"
        message="Probe failed"
        actions={<Button size="sm" onClick={onRetry}>Retry</Button>}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
