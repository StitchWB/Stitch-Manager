/**
 * Demo frame AI Hub routing tests.
 *
 * The demo app's /ai routes mirror the real App routes explicitly:
 * /ai/chat must render the Chat page, not fall through a /ai/:section
 * catch-all into the AiProviders section.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { DemoAppFrame } from '@/components/landing/DemoAppFrame';

jest.mock('@/lib/events', () => ({
  listen: jest.fn(async () => jest.fn()),
  emit: jest.fn(async () => undefined),
  dispose: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
  Toaster: () => null,
}));

class FakeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}

if (typeof window.ResizeObserver === 'undefined') {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeObserver;
}
if (typeof window.IntersectionObserver === 'undefined') {
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
}
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(() => false),
  })) as unknown as typeof window.matchMedia;
}
window.requestIdleCallback = (() => 0) as unknown as typeof window.requestIdleCallback;
window.cancelIdleCallback = (() => {}) as unknown as typeof window.cancelIdleCallback;
Element.prototype.scrollTo = () => {};
window.scrollTo = () => {};

jest.setTimeout(30000);

async function openDemoChatRoute(): Promise<void> {
  render(<DemoAppFrame />);

  const aiHubLink = await screen.findByRole('link', { name: 'AI Hub' });
  await act(async () => {
    fireEvent.click(aiHubLink);
  });

  const testChatCard = await screen.findByRole('button', { name: 'Test chat' });
  await act(async () => {
    fireEvent.click(testChatCard);
  });
}

describe('DemoAppFrame AI Hub routes', () => {
  it('renders Chat at /ai/chat instead of the AiProviders section fallback', async () => {
    await openDemoChatRoute();

    await waitFor(
      () => {
        expect(screen.getByRole('heading', { name: 'Chat' })).toBeTruthy();
      },
      { timeout: 15000 },
    );
    expect(screen.queryByRole('button', { name: 'Add Account' })).toBeNull();
  });
});
