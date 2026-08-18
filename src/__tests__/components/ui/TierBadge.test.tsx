/**
 * TierBadge component tests.
 *
 * Verifies:
 *   - Renders the translated tier name for each tier.
 *   - Returns null when tier is null/undefined.
 *   - Elite tier renders with purple override class.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { TierBadge } from '../../../components/ui/TierBadge';

// TierBadge uses t() which reads from currentLocale (defaults to 'en').
// No app store mock needed — t() resolves against the en locale by default.

describe('TierBadge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders null when tier is null', () => {
    const { container } = render(<TierBadge tier={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when tier is undefined', () => {
    const { container } = render(<TierBadge tier={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the translated tier name for user', () => {
    render(<TierBadge tier="user" />);
    expect(screen.getByText('User')).toBeTruthy();
  });

  it('renders the translated tier name for vip', () => {
    render(<TierBadge tier="vip" />);
    expect(screen.getByText('VIP')).toBeTruthy();
  });

  it('renders the translated tier name for premium', () => {
    render(<TierBadge tier="premium" />);
    expect(screen.getByText('Premium')).toBeTruthy();
  });

  it('renders the translated tier name for elite with purple class', () => {
    render(<TierBadge tier="elite" />);
    const badge = screen.getByText('Elite');
    expect(badge).toBeTruthy();
    // The badge span should have the purple override class.
    const span = badge.closest('span');
    expect(span?.className).toContain('purple');
  });

  it('renders the translated tier name for admin', () => {
    render(<TierBadge tier="admin" />);
    expect(screen.getByText('Admin')).toBeTruthy();
  });
});
