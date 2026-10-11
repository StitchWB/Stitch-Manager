import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>): string => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      key,
    );
  },
}));

jest.mock('@/components/ui', () => ({
  ButtonBase: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
  Input: ({ containerClassName: _containerClassName, leftIcon: _leftIcon, ...rest }: any) => <input {...rest} />,
  ProviderLogo: ({ provider }: any) => <span data-provider={provider} />,
}));

import { ProviderFilterBar } from '@/components/ai-proxy/ProviderFilterBar';
import { AI_PROXY_PROVIDER_FILTERS } from '@/constants/providerRegistry';

let navigatedSearch = '';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedSearch = loc.search;
  }, [loc.search]);
  return null;
}

function renderBar(providerCounts: Record<string, number>) {
  render(
    <MemoryRouter initialEntries={['/ai/providers']}>
      <LocationSpy />
      <ProviderFilterBar providerCounts={providerCounts} />
    </MemoryRouter>
  );
}

describe('ProviderFilterBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedSearch = '';
  });

  it('renders every registered chip including zero-count ones', () => {
    renderBar({ all: 1, openai: 1 });

    const bar = screen.getByTestId('provider-filter-bar');
    const buttonTexts = [...bar.querySelectorAll('button')].map(b => b.textContent ?? '');
    for (const filter of AI_PROXY_PROVIDER_FILTERS) {
      expect(buttonTexts.some(text => text.includes(filter.label))).toBe(true);
    }
    expect(bar.querySelectorAll('button').length).toBe(AI_PROXY_PROVIDER_FILTERS.length + 1);
  });

  it('dims zero-count chips and keeps counted ones at full opacity', () => {
    renderBar({ all: 2, openai: 2 });

    const kiro = screen.getByRole('button', { name: /Kiro/ });
    expect(kiro.className).toContain('opacity-60');
    const openai = screen.getByRole('button', { name: /OpenAI/ });
    expect(openai.className).not.toContain('opacity-60');
  });

  it('appends a plus chip that selects the custom filter', () => {
    renderBar({ all: 0 });

    const plus = screen.getByRole('button', { name: 'aiHub.addProvider' });
    fireEvent.click(plus);
    return waitFor(() => {
      expect(navigatedSearch).toBe('?provider=custom');
    });
  });

  it('writes the selected provider to the url and clears it for all', async () => {
    renderBar({ all: 1, openai: 1 });

    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    await waitFor(() => {
      expect(navigatedSearch).toBe('?provider=openai');
    });

    fireEvent.click(screen.getByRole('button', { name: /All Providers/ }));
    await waitFor(() => {
      expect(navigatedSearch).toBe('');
    });
  });

  it('keeps the search input bound to ?q=', () => {
    renderBar({ all: 0 });

    const input = screen.getByPlaceholderText('aiHub.search.placeholder');
    fireEvent.change(input, { target: { value: 'gpt' } });
    return waitFor(() => {
      expect(navigatedSearch).toBe('?q=gpt');
    });
  });

  it('shows chips for account providers outside the registered list', () => {
    renderBar({ all: 1, 'legacy-one': 1 });

    expect(screen.getByRole('button', { name: /legacy-one/ })).toBeTruthy();
  });
});
