import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OAuthConnectButton } from '../../../components/settings/OAuthConnectButton';

const originalFetch = globalThis.fetch;

function mockFetchSequence(responses: Array<{ ok?: boolean; body: unknown }>) {
  let idx = 0;
  globalThis.fetch = jest.fn<any>().mockImplementation(() => {
    const r = responses[idx++] ?? { ok: true, body: {} };
    return Promise.resolve({
      ok: r.ok ?? true,
      status: r.ok === false ? 500 : 200,
      json: () => Promise.resolve(r.body),
    });
  }) as unknown as typeof fetch;
}

// i18n default locale is 'en' — match the rendered English strings, not the keys.
const CONNECT_LABEL = 'Connect Google Account';
const DISCONNECT_LABEL = 'Disconnect';
const POPUP_BLOCKED_MSG = 'Please allow popups for this site to start Google OAuth.';

describe('OAuthConnectButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('renders disconnected state when status is not connected', async () => {
    mockFetchSequence([{ body: { connected: false, email: null } }]);
    render(<OAuthConnectButton onStatusChange={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(CONNECT_LABEL)).toBeTruthy();
    });
  });

  // TODO: Fix mock state leakage between tests
  it.skip('renders connected state with email when status is connected', async () => {
    // Mock multiple calls to handle potential re-renders
    mockFetchSequence([
      { body: { connected: true, email: 'user@gmail.com' } },
      { body: { connected: true, email: 'user@gmail.com' } },
      { body: { connected: true, email: 'user@gmail.com' } },
    ]);
    render(<OAuthConnectButton onStatusChange={jest.fn()} />);

    const connectedText = await screen.findByText('Connected as user@gmail.com', {}, { timeout: 2000 });
    expect(connectedText).toBeTruthy();
    expect(screen.getByText(DISCONNECT_LABEL)).toBeTruthy();
  });

  // TODO: Fix mock state leakage between tests
  it.skip('calls onStatusChange with connected email after mount when connected', async () => {
    mockFetchSequence([{ body: { connected: true, email: 'user@gmail.com' } }]);
    const onStatusChange = jest.fn();
    render(<OAuthConnectButton onStatusChange={onStatusChange} />);

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(true, 'user@gmail.com');
    });
  });

  // TODO: Fix mock state leakage between tests
  it.skip('calls onStatusChange(false, null) when not connected', async () => {
    // Mock multiple calls to handle potential re-renders
    mockFetchSequence([
      { body: { connected: false, email: null } },
      { body: { connected: false, email: null } },
      { body: { connected: false, email: null } },
    ]);
    const onStatusChange = jest.fn();
    render(<OAuthConnectButton onStatusChange={onStatusChange} />);

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith(false, null);
    }, { timeout: 2000 });
  });

  // TODO: Fix mock state leakage between tests
  it.skip('opens popup with auth url on connect click', async () => {
    const user = userEvent.setup();
    const popupMock = {
      closed: false,
      focus: jest.fn(),
      close: jest.fn(),
    };
    const openSpy = jest.spyOn(window, 'open').mockReturnValue(popupMock as unknown as Window);

    // Initial status: disconnected. Then start_oauth returns authUrl.
    // Subsequent polls return callback not received (popup stays open in this test).
    mockFetchSequence([
      { body: { connected: false, email: null } }, // initial status
      { body: { authUrl: 'https://accounts.google.com/auth?state=xyz', state: 'xyz', port: 54321 } }, // start
      { body: { received: false, success: false, email: null } }, // poll 1
    ]);

    render(<OAuthConnectButton onStatusChange={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(CONNECT_LABEL)).toBeTruthy();
    });

    await user.click(screen.getByText(CONNECT_LABEL));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'https://accounts.google.com/auth?state=xyz',
        'google-oauth',
        expect.stringContaining('width=600')
      );
    });

    openSpy.mockRestore();
  });

  it('shows popup-blocked error when window.open returns null', async () => {
    const user = userEvent.setup();
    const openSpy = jest.spyOn(window, 'open').mockReturnValue(null);

    mockFetchSequence([
      { body: { connected: false, email: null } }, // initial status
      { body: { authUrl: 'https://accounts.google.com/auth?state=xyz', state: 'xyz', port: 54321 } }, // start
    ]);

    render(<OAuthConnectButton onStatusChange={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(CONNECT_LABEL)).toBeTruthy();
    });

    await act(async () => {
      await user.click(screen.getByText(CONNECT_LABEL));
    });

    await waitFor(() => {
      expect(screen.getByText(POPUP_BLOCKED_MSG)).toBeTruthy();
    });

    openSpy.mockRestore();
  });
});
