/**
 * TelegramLogin component tests.
 *
 * Verifies the official Telegram OIDC button (`.tg-auth-button`) renders
 * only when the auth store reports `tgAuthMode === 'oidc'`, that the
 * one-time-code form is present in BOTH modes (it is the independent
 * fallback mechanism), and the deep-link flow: CTA visibility per mode,
 * bot deep-link popup, status polling (pending → ready / expired), the
 * expires_in hard stop, cancel, and the guide panel content.
 *
 * Also covers the merged mode switch: required mode shows the back link and
 * the Telegram header; optional mode is the root screen (welcome header,
 * guest entry, web-only password login) with no back link — all inside ONE
 * card shared with the guide column.
 *
 * The `telegramLogin` helper module is mocked so no real script injection
 * happens in jsdom (which has no real network / DOM script execution).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the telegramLogin helper so no real <script> is injected into jsdom.
// The component only calls `ensureTelegramLoginScript` on click, and reads
// `TG_OIDC_CLIENT_ID` at module-eval time — both are stubbed here.
jest.mock('@/lib/telegramLogin', () => ({
  ensureTelegramLoginScript: jest.fn().mockResolvedValue(undefined),
  TG_OIDC_CLIENT_ID: '8606505679',
}));

// Mock the links module so the bot/channel URLs resolve without pulling
// extra dependencies.
jest.mock('@/lib/links', () => ({
  STITCH_BOT_LOGIN_URL: 'https://t.me/stitch_bot?start=login',
  STITCH_BOT_URL: 'https://t.me/stitch_bot',
  MAIN_TELEGRAM_URL: 'https://t.me/stitch_channel',
  stitchBotDeeplinkUrl: (token: string) => `https://t.me/stitch_bot?start=login_${token}`,
}));

// Mock the auth backend module so the store can import it without trying
// to call real fetch wrappers during store construction.
jest.mock('@/lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  loginTelegramDeeplink: jest.fn(),
  loginTelegramOidc: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  setLoginPolicy: jest.fn(),
  startTelegramDeeplink: jest.fn(),
  getTelegramDeeplinkStatus: jest.fn(),
}));

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// Mock the app store so the component re-renders on language change without
// pulling the real store (which has many other dependencies).
const mockAppStoreState = {
  theme: 'dark' as const,
  language: 'en' as const,
  sidebarCollapsed: false,
  toggleSidebar: jest.fn(),
};
jest.mock('@/stores/app', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppStoreState) => unknown) =>
      selector ? selector(mockAppStoreState) : mockAppStoreState,
    { getState: () => mockAppStoreState },
  ),
}));

// Import the store and component AFTER all mocks are set up.
import { useAuthStore } from '@/stores/auth';
import TelegramLogin from '@/components/auth/TelegramLogin';
import {
  startTelegramDeeplink,
  getTelegramDeeplinkStatus,
} from '@/lib/backend/modules/auth';

const mockStartDeeplink = jest.mocked(startTelegramDeeplink);
const mockDeeplinkStatus = jest.mocked(getTelegramDeeplinkStatus);

function renderTelegramLogin() {
  return render(
    <MemoryRouter>
      <TelegramLogin />
    </MemoryRouter>,
  );
}

describe('TelegramLogin component — OIDC button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to a clean, legacy-mode store state for each test.
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: true,
      user: null,
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'telegram',
    });
  });

  it('renders the official .tg-auth-button when tgAuthMode is "oidc"', () => {
    useAuthStore.setState({ tgAuthMode: 'oidc' });

    renderTelegramLogin();

    const btn = screen.queryByTestId('tg-auth-button');
    expect(btn).not.toBeNull();
    // The host button carries the class the library keys off of.
    expect(btn?.className).toContain('tg-auth-button');
    // The wrapper div is also present (used to center the library element).
    expect(screen.queryByTestId('tg-oidc-wrapper')).not.toBeNull();
  });

  it('does NOT render the .tg-auth-button when tgAuthMode is "legacy"', () => {
    useAuthStore.setState({ tgAuthMode: 'legacy' });

    renderTelegramLogin();

    expect(screen.queryByTestId('tg-auth-button')).toBeNull();
    expect(screen.queryByTestId('tg-oidc-wrapper')).toBeNull();
  });

  it('renders the one-time-code input in BOTH modes (fallback mechanism)', () => {
    // Legacy mode
    useAuthStore.setState({ tgAuthMode: 'legacy' });
    const { unmount } = renderTelegramLogin();
    expect(screen.getByTestId('telegram-code-input')).toBeTruthy();
    expect(screen.getByTestId('telegram-submit-btn')).toBeTruthy();
    unmount();

    // OIDC mode — code form still present below the official button
    useAuthStore.setState({ tgAuthMode: 'oidc' });
    renderTelegramLogin();
    expect(screen.getByTestId('telegram-code-input')).toBeTruthy();
    expect(screen.getByTestId('telegram-submit-btn')).toBeTruthy();
    expect(screen.getByTestId('tg-auth-button')).toBeTruthy();
  });

  it('registers Telegram.Login.init with client_id in oidc mode', async () => {
    const init = jest.fn();
    (window as unknown as { Telegram: unknown }).Telegram = { Login: { init } };
    useAuthStore.setState({ tgAuthMode: 'oidc' });

    renderTelegramLogin();

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    expect(init.mock.calls[0][0]).toEqual({
      client_id: '8606505679',
      scope: ['openid', 'profile'],
    });
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it('does NOT call Telegram.Login.init in legacy mode', async () => {
    const init = jest.fn();
    (window as unknown as { Telegram: unknown }).Telegram = { Login: { init } };
    useAuthStore.setState({ tgAuthMode: 'legacy' });

    renderTelegramLogin();
    await new Promise(r => setTimeout(r, 0));

    expect(init).not.toHaveBeenCalled();
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it('renders the "or" divider only in oidc mode (separates button from code form)', () => {
    // OIDC mode — divider present
    useAuthStore.setState({ tgAuthMode: 'oidc' });
    const { unmount } = renderTelegramLogin();
    // The divider text comes from the en locale: "or"
    expect(screen.getByText('or')).toBeTruthy();
    unmount();

    // Legacy mode — no divider
    useAuthStore.setState({ tgAuthMode: 'legacy' });
    renderTelegramLogin();
    expect(screen.queryByText('or')).toBeNull();
  });
});

describe('TelegramLogin component — deep-link flow', () => {
  const realLoginDeeplink = useAuthStore.getState().loginTelegramDeeplink;
  let mockLoginDeeplink: jest.Mock<(token: string) => Promise<boolean>>;
  let openSpy: jest.SpiedFunction<typeof window.open>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: true,
      user: null,
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'telegram',
    });
    // Replace the store action so the test never runs the real init() chain.
    mockLoginDeeplink = jest.fn<(token: string) => Promise<boolean>>().mockResolvedValue(true);
    useAuthStore.setState({ loginTelegramDeeplink: mockLoginDeeplink });
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    mockStartDeeplink.mockResolvedValue({ token: 'tok123', expires_in: 300 });
    mockDeeplinkStatus.mockResolvedValue('pending');
  });

  afterEach(() => {
    jest.useRealTimers();
    openSpy.mockRestore();
    useAuthStore.setState({ loginTelegramDeeplink: realLoginDeeplink });
  });

  async function clickCta() {
    await act(async () => {
      fireEvent.click(screen.getByTestId('telegram-deeplink-btn'));
    });
  }

  async function advance(ms: number) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  it('renders the deep-link CTA in legacy mode and hides it in oidc mode', () => {
    const { unmount } = renderTelegramLogin();
    expect(screen.getByTestId('telegram-deeplink-btn')).toBeTruthy();
    expect(screen.getByText('or enter the code manually')).toBeTruthy();
    unmount();

    useAuthStore.setState({ tgAuthMode: 'oidc' });
    renderTelegramLogin();
    expect(screen.queryByTestId('telegram-deeplink-btn')).toBeNull();
    expect(screen.queryByText('or enter the code manually')).toBeNull();
  });

  it('starts the deep-link flow and opens the bot deep link on CTA click', async () => {
    renderTelegramLogin();
    await clickCta();

    expect(mockStartDeeplink).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      'https://t.me/stitch_bot?start=login_tok123',
      '_blank',
      'noopener,noreferrer',
    );
    const cta = screen.getByTestId('telegram-deeplink-btn') as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
    expect(cta.textContent).toContain('Waiting for Telegram confirmation');
    expect(screen.getByTestId('telegram-deeplink-status')).toBeTruthy();
    expect(screen.getByTestId('telegram-deeplink-cancel')).toBeTruthy();
  });

  it('keeps polling when the popup is blocked (window.open returns null)', async () => {
    renderTelegramLogin();
    await clickCta();
    await advance(2500);

    expect(openSpy).toHaveReturnedWith(null);
    expect(mockDeeplinkStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('telegram-deeplink-status')).toBeTruthy();
    expect(screen.getByTestId('telegram-open-bot-link')).toBeTruthy();
  });

  it('polls pending → ready and logs in with the token', async () => {
    mockDeeplinkStatus
      .mockResolvedValueOnce('pending')
      .mockResolvedValueOnce('ready');
    renderTelegramLogin();
    await clickCta();

    await advance(2500);
    expect(mockDeeplinkStatus).toHaveBeenCalledWith('tok123');
    expect(mockLoginDeeplink).not.toHaveBeenCalled();

    await advance(2500);
    expect(mockLoginDeeplink).toHaveBeenCalledWith('tok123');

    // Success clears both timers — no further status polls.
    await advance(10_000);
    expect(mockDeeplinkStatus).toHaveBeenCalledTimes(2);
  });

  it('shows the expired error and returns to idle when the status expires', async () => {
    mockDeeplinkStatus.mockResolvedValueOnce('expired');
    renderTelegramLogin();
    await clickCta();
    await advance(2500);

    expect(screen.getByRole('alert').textContent).toContain('The link has expired');
    expect(screen.queryByTestId('telegram-deeplink-status')).toBeNull();
    const cta = screen.getByTestId('telegram-deeplink-btn') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    expect(mockLoginDeeplink).not.toHaveBeenCalled();
  });

  it('hard-stops polling at expires_in seconds with the expired error', async () => {
    mockStartDeeplink.mockResolvedValue({ token: 'tokShort', expires_in: 9 });
    renderTelegramLogin();
    await clickCta();

    // Ticks at 2.5/5/7.5s stay pending; the hard stop fires at 9s.
    await advance(9000);
    expect(mockDeeplinkStatus).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('alert').textContent).toContain('The link has expired');
    expect(screen.queryByTestId('telegram-deeplink-status')).toBeNull();

    await advance(10_000);
    expect(mockDeeplinkStatus).toHaveBeenCalledTimes(3);
    expect(mockLoginDeeplink).not.toHaveBeenCalled();
  });

  it('cancel stops polling and returns to idle', async () => {
    renderTelegramLogin();
    await clickCta();
    await advance(2500);
    expect(mockDeeplinkStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId('telegram-deeplink-cancel'));
    });
    expect(screen.queryByTestId('telegram-deeplink-status')).toBeNull();

    await advance(10_000);
    expect(mockDeeplinkStatus).toHaveBeenCalledTimes(1);
    expect(mockLoginDeeplink).not.toHaveBeenCalled();
    const cta = screen.getByTestId('telegram-deeplink-btn') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
  });

  it('renders the guide panel with steps, bot and channel links', () => {
    renderTelegramLogin();

    const panel = screen.getByTestId('telegram-guide-panel');
    // Desktop-only visibility is class-driven (jsdom has no CSS cascade).
    expect(panel.className).toContain('hidden');
    expect(panel.className).toContain('lg:flex');

    expect(within(panel).getByText('How it works')).toBeTruthy();
    expect(within(panel).getByText('Press the button')).toBeTruthy();
    expect(within(panel).getByText('Tap START')).toBeTruthy();
    expect(within(panel).getByText('Done')).toBeTruthy();

    const botLink = within(panel).getByTestId('telegram-guide-bot-link');
    expect(botLink.getAttribute('href')).toBe('https://t.me/stitch_bot');
    expect(botLink.getAttribute('target')).toBe('_blank');
    expect(botLink.getAttribute('rel')).toBe('noopener noreferrer');

    const channelLink = within(panel).getByTestId('telegram-guide-channel-link');
    expect(channelLink.getAttribute('href')).toBe('https://t.me/stitch_channel');
    expect(channelLink.getAttribute('target')).toBe('_blank');
    expect(channelLink.getAttribute('rel')).toBe('noopener noreferrer');

    expect(within(panel).getByText(/enter the code manually below/)).toBeTruthy();
  });

  it('renders the same guide content in the mobile collapsed toggle', () => {
    renderTelegramLogin();

    const mobile = screen.getByTestId('telegram-guide-mobile');
    expect(mobile.className).toContain('lg:hidden');
    expect(screen.getByTestId('telegram-guide-toggle').textContent).toBe('How it works?');
    expect(within(mobile).getByText('How it works')).toBeTruthy();
    expect(within(mobile).getByTestId('telegram-guide-bot-link')).toBeTruthy();
    expect(within(mobile).getByTestId('telegram-guide-channel-link')).toBeTruthy();
  });
});

describe('TelegramLogin component — merged auth modes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.removeItem('stitch.guest');
    window.history.pushState({}, '', '/');
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: true,
      user: null,
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'telegram',
    });
  });

  it('renders the back link and TG header in required mode, no guest buttons', () => {
    renderTelegramLogin();

    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.getByText('Telegram Login')).toBeTruthy();
    expect(screen.queryByTestId('guest-continue-btn')).toBeNull();
    expect(screen.queryByTestId('guest-login-btn')).toBeNull();
    expect(screen.queryByTestId('guest-no-account-hint')).toBeNull();
  });

  it('renders the welcome header and guest entry in optional mode, no back link', () => {
    useAuthStore.setState({ required: false });
    renderTelegramLogin();

    expect(screen.queryByText('Back')).toBeNull();
    expect(screen.getByText('Welcome')).toBeTruthy();
    expect(screen.getByTestId('telegram-deeplink-btn')).toBeTruthy();
    expect(screen.getByTestId('guest-continue-btn')).toBeTruthy();
    // jsdom default URL is localhost → desktop → no password login surface.
    expect(screen.queryByTestId('guest-login-btn')).toBeNull();
  });

  it('shows password login + setup hint in optional mode on web without users', () => {
    window.history.pushState({}, '', '/?platform=web');
    useAuthStore.setState({ required: false, hasUsers: false });
    renderTelegramLogin();

    expect(screen.getByTestId('guest-login-btn')).toBeTruthy();
    expect(screen.getByTestId('guest-no-account-hint')).toBeTruthy();
    expect(screen.getByTestId('guest-continue-btn')).toBeTruthy();
  });

  it('enters guest mode when the continue button is clicked (optional)', () => {
    useAuthStore.setState({ required: false });
    renderTelegramLogin();

    fireEvent.click(screen.getByTestId('guest-continue-btn'));
    expect(useAuthStore.getState().guest).toBe(true);

    act(() => {
      useAuthStore.getState().exitGuest();
    });
    localStorage.removeItem('stitch.guest');
  });

  it('renders the form, guide column and mobile collapse inside ONE card', () => {
    renderTelegramLogin();

    const card = screen.getByTestId('telegram-deeplink-btn').closest('.rounded-2xl');
    expect(card).not.toBeNull();
    const panel = screen.getByTestId('telegram-guide-panel');
    expect(card?.contains(panel)).toBe(true);
    expect(card?.contains(screen.getByTestId('telegram-guide-mobile'))).toBe(true);
    expect(panel.className).toContain('border-l');
    // No second top-level card: the page wrapper holds exactly one card.
    const page = screen.getByTestId('telegram-page');
    expect(page.querySelectorAll(':scope > .rounded-2xl').length).toBe(1);
  });
});
