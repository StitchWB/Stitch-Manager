/**
 * Landing nav test.
 *
 * The public landing header links to the public /catalog marketplace
 * page so logged-out visitors can browse plugins.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from '../../pages/Landing';

jest.mock('framer-motion', () => {
  const strip = (props: Record<string, unknown>): Record<string, unknown> => {
    const dom = { ...props };
    for (const key of ['initial', 'animate', 'exit', 'whileInView', 'viewport', 'transition', 'variants']) {
      delete dom[key];
    }
    return dom;
  };
  return {
    motion: {
      div: (props: { children?: ReactNode } & Record<string, unknown>) => (
        <div {...strip(props)}>{props.children}</div>
      ),
      section: (props: { children?: ReactNode } & Record<string, unknown>) => (
        <section {...strip(props)}>{props.children}</section>
      ),
    },
  };
});

jest.mock('../../components/landing/DemoAppFrame', () => ({
  __esModule: true,
  DemoAppFrame: () => null,
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: null, setAuthView: jest.fn() }),
}));

describe('Landing nav', () => {
  it('links to the public /catalog marketplace page', () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );

    const link = screen.getByRole('link', { name: /маркетплейс|marketplace/i });
    expect(link.getAttribute('href')).toBe('/catalog');
  });
});
