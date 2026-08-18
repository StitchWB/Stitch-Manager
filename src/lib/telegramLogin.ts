/**
 * Telegram OIDC login helper.
 *
 * Wraps the official `https://oauth.telegram.org/js/telegram-login.js`
 * library so the auth surface can drive the popup flow programmatically
 * (the library's auto-init reads data-client-id from the SCRIPT tag, which
 * is wrong for an SPA — we use `Telegram.Login.auth(options, callback)`).
 *
 * Spec: docs/tz-stitch-telegram-oidc.md §3.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** Minimal slice of the official library's surface that we call. */
interface TelegramLoginApi {
  /** Open the OAuth popup with explicit options; invoke `cb` on completion. */
  auth(
    options: {
      client_id: string;
      scope?: string[];
      // The library also accepts `bot_id`, `request_access`, `origin`,
      // `return_to` etc. — we only pass what we need.
    },
    cb: (result: TelegramAuthResult) => void,
  ): void;
  /**
   * Register options + auth callback. The library's OWN document-level
   * click handler on `.tg-auth-button` then opens the popup via open().
   * Proven pattern (radar team): load the script once, call init(), let
   * the library drive the button — data-* auto-init reads attributes
   * from the SCRIPT tag and is wrong for an SPA.
   */
  init(
    options: { client_id: string; scope?: string[] },
    cb: (result: TelegramAuthResult) => void,
  ): void;
  /** Open the popup using init() state (called by the library on button click). */
  open(cb?: (result: TelegramAuthResult) => void): void;
}

/** Result the callback receives from the Telegram OAuth popup. */
export interface TelegramAuthResult {
  /** Set when the popup failed (e.g. 'popup_closed', 'missing id_token'). */
  error?: string;
  /** JWT id_token on success — posted to /api/auth/telegram-oidc. */
  id_token?: string;
  /** Telegram user profile (present alongside id_token on success). */
  user?: {
    id?: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
  };
}

// ── Global declaration ──────────────────────────────────────────────────────

declare global {
  interface Window {
    Telegram?: {
      Login?: TelegramLoginApi;
    };
  }
}

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Telegram OIDC client_id (the bot's numeric id registered with BotFather
 * as a Trusted Origin for the OAuth popup).  Shared by the button onClick
 * and any test that needs to assert it.
 */
export const TG_OIDC_CLIENT_ID = '8606505679';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Idempotently inject the official `telegram-login.js` script into
 * document.head and resolve once `window.Telegram.Login` is available.
 *
 * Safe under:
 *  - React StrictMode double-invoke (the same promise is reused).
 *  - Repeated calls (a script with id `tg-login-js` is added at most once).
 *  - SSR / non-browser environments (resolves as a no-op when `document`
 *    is undefined — the caller still has to guard against `window.Telegram`
 *    being absent, which it does before calling `.auth`).
 *
 * Rejects if the script tag errors (network blocked, CSP, etc.) so the
 * caller can show a local error instead of hanging.
 */
let scriptPromise: Promise<void> | null = null;

export function ensureTelegramLoginScript(): Promise<void> {
  if (typeof document === 'undefined') {
    // SSR / non-browser — nothing to inject. The caller must guard.
    return Promise.resolve();
  }
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    // Already loaded by a prior page load or a different bundle.
    if (window.Telegram?.Login) {
      resolve();
      return;
    }

    const existing = document.getElementById('tg-login-js') as
      | HTMLScriptElement
      | null;
    if (existing) {
      // Script tag exists from a previous call (or was added manually).
      // Wait for it to expose `window.Telegram.Login` — either it is still
      // loading, or it finished and we just need to detect it.
      waitForLogin(resolve, reject, existing);
      return;
    }

    const script = document.createElement('script');
    script.id = 'tg-login-js';
    script.src = 'https://oauth.telegram.org/js/telegram-login.js';
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      // Clear the cached promise so a later retry can try again.
      scriptPromise = null;
      reject(new Error('Failed to load Telegram login script'));
    };
    script.onload = () => {
      // The library may attach `window.Telegram.Login` slightly after
      // onload fires; poll for it to be safe.
      waitForLogin(resolve, reject, script);
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Poll for `window.Telegram.Login` to appear (the library sets it
 * asynchronously after the script body executes). Resolves once present,
 * rejects after a short timeout so the caller does not hang forever.
 */
function waitForLogin(
  resolve: () => void,
  reject: (err: Error) => void,
  _script: HTMLScriptElement,
): void {
  // Fast path: already available.
  if (window.Telegram?.Login) {
    resolve();
    return;
  }

  const deadline = Date.now() + 10_000;
  const tick = () => {
    if (window.Telegram?.Login) {
      resolve();
      return;
    }
    if (Date.now() >= deadline) {
      // Clear the cached promise so a later retry can try again.
      scriptPromise = null;
      reject(new Error('Telegram login script timed out'));
      return;
    }
    setTimeout(tick, 50);
  };
  tick();
}
