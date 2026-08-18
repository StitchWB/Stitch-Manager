/**
 * TelegramLogin — one-time-code auth surface.
 *
 * Same Deep Space glassmorphism as Login/Setup. The user sends /login to our
 * Telegram bot, receives a one-time code, and enters it here. On success the
 * store action re-runs init() so the gate closes.
 *
 * When the backend reports `tg_auth_mode === 'oidc'` (via /api/auth/status),
 * the official Telegram OIDC button is rendered ABOVE the code form. We
 * mount the host `<button class="tg-auth-button">`, load the library once
 * and call `Telegram.Login.init({client_id, scope}, cb)`; the library's own
 * click handler opens the popup (data-* auto-init reads the SCRIPT tag and
 * is wrong for an SPA).
 *
 * The one-time-code form stays available in BOTH modes as an independent
 * fallback mechanism (the bot /login command always works, even on
 * localhost where OIDC cannot run — HTTPS + trusted origin required).
 *
 * Reachable from the WelcomeGate (optional mode, back → 'welcome') and from
 * the Login page tertiary link (required mode, back → 'login').
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal, AlertCircle, Loader2, ArrowLeft, Send } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { t } from '@/lib/i18n';
import { STITCH_BOT_LOGIN_URL } from '@/lib/links';
import { cn } from '../../lib/utils';
import {
  ensureTelegramLoginScript,
  TG_OIDC_CLIENT_ID,
  type TelegramAuthResult,
} from '@/lib/telegramLogin';

export default function TelegramLogin() {
  const loginTelegram = useAuthStore(state => state.loginTelegram);
  const loginTelegramOidc = useAuthStore(state => state.loginTelegramOidc);
  const busy = useAuthStore(state => state.busy);
  const required = useAuthStore(state => state.required);
  const tgAuthMode = useAuthStore(state => state.tgAuthMode);
  const setAuthView = useAuthStore(state => state.setAuthView);
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!code) return;
    setLocalError(null);
    try {
      await loginTelegram(code);
      // On success the store re-runs init() and the gate closes; this
      // component unmounts. No further UI updates needed here.
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('auth.tg.errorGeneric');
      setLocalError(message);
    }
  };

  // ── OIDC popup flow ────────────────────────────────────────────────────
  //
  // NOTE for the nginx admin: the Telegram OAuth popup flow breaks if the
  // login page is served with `Cross-Origin-Opener-Policy: same-origin`.
  // COOP must be absent, or set to `same-origin-allow-popups`, on every
  // route that renders this surface. Nothing in this repo currently sets
  // COOP — keep it that way, or relax it explicitly in the nginx config
  // for /login and /telegram paths.
  // Load the official script once and register options + callback; the
  // library's own click handler on .tg-auth-button opens the popup
  // (proven pattern from the radar team — data-* auto-init reads the
  // SCRIPT tag and is wrong for an SPA; calling auth() per click fights
  // the library's document-level handler).
  useEffect(() => {
    if (tgAuthMode !== 'oidc') return;
    let cancelled = false;
    ensureTelegramLoginScript()
      .then(() => {
        if (cancelled) return;
        const api = window.Telegram?.Login;
        if (!api) {
          setLocalError(t('auth.tg.oidc.errorGeneric'));
          return;
        }
        api.init(
          { client_id: TG_OIDC_CLIENT_ID, scope: ['openid', 'profile'] },
          (result: TelegramAuthResult) => handleOidcResult(result),
        );
      })
      .catch(() => {
        if (!cancelled) setLocalError(t('auth.tg.oidc.errorGeneric'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleOidcResult is stable per render
  }, [tgAuthMode]);

  const handleOidcResult = (result: TelegramAuthResult) => {
    // User closed the popup before completing — not an error, just abort.
    if (result.error === 'popup_closed') return;
    if (result.error) {
      setLocalError(t('auth.tg.oidc.errorGeneric'));
      return;
    }
    if (!result.id_token) {
      setLocalError(t('auth.tg.oidc.errorGeneric'));
      return;
    }
    // Fire-and-forget: the store sets `busy` while in flight and the
    // component re-renders with the spinner. Errors are surfaced locally
    // via the same channel as the code-form errors.
    void loginTelegramOidc(result.id_token).catch(err => {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t('auth.tg.oidc.errorGeneric');
      setLocalError(message);
    });
  };

  const errorMessage = localError;

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-[#0a0a0d]">
      {/* Ambient gradient mesh — Deep Space atmosphere */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(ellipse 60% 50% at 20% 100%, rgba(139,92,246,0.12), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(59,130,246,0.10), transparent 60%)',
        }}
      />
      {/* Subtle noise overlay for depth */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
        }}
      />

      <div className="relative w-full max-w-md px-6" data-testid="telegram-page">
        <div className="rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-2xl shadow-2xl shadow-indigo-950/40 overflow-hidden">
          {/* Top accent line */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

          <div className="px-8 pt-10 pb-8">
            {/* Back link — 'welcome' when optional, 'login' when required */}
            <button
              type="button"
              onClick={() => setAuthView(required ? 'login' : 'welcome')}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mb-6 -mt-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t('auth.tg.back')}
            </button>

            {/* Logo + title */}
            <div className="flex flex-col items-center text-center mb-8">
              <div className="rounded-xl w-12 h-12 flex items-center justify-center mb-4 bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
                <Terminal className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-white text-xl font-black tracking-tight uppercase">
                {t('auth.tg.title')}
              </h1>
            </div>

            {/* Description */}
            <p className="text-center text-slate-400 text-sm leading-relaxed mb-4 px-2">
              {t('auth.tg.description')}
            </p>

            {/* OIDC button — official Telegram element (rendered by the
                library into the host <button class="tg-auth-button">).
                Only mounted when the backend reports tg_auth_mode='oidc'.
                The library injects its own CSS for .tg-auth-button (blue
                pill, TG logo pseudo-element, 44px height) — do NOT override
                its visual style; the wrapper only centers it. */}
            {tgAuthMode === 'oidc' && (
              <div className="flex justify-center mb-4" data-testid="tg-oidc-wrapper">
                {/* No onClick: the library's document-level handler on
                    .tg-auth-button calls open() with the init() options.
                    disabled={busy} suppresses clicks while in flight. */}
                <button
                  type="button"
                  disabled={busy}
                  data-style="shine"
                  className="tg-auth-button"
                  data-testid="tg-auth-button"
                >
                  {busy ? t('auth.submitting') : t('auth.tg.oidc.button')}
                </button>
              </div>
            )}

            {/* Divider between OIDC button and the code form. The library
                element is above; the code form is the independent fallback
                below. Rendered in both modes (in oidc mode it separates the
                two surfaces; in legacy mode it is hidden — the code form
                stands alone). */}
            {tgAuthMode === 'oidc' && (
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="text-xs text-slate-500 uppercase tracking-wider">
                  {t('auth.tg.oidc.orCode')}
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
              </div>
            )}

            {/* Open-bot shortcut — jumps straight to the bot chat */}
            <a
              href={STITCH_BOT_LOGIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="telegram-open-bot-link"
              className={cn(
                'w-full h-10 rounded-lg font-medium text-sm transition-all duration-200 select-none mb-6',
                'bg-white/[0.04] border border-white/[0.08] text-slate-200',
                'hover:bg-white/[0.08] hover:text-white hover:border-indigo-500/30 active:scale-[0.98]',
                'flex items-center justify-center gap-2'
              )}
            >
              <Send className="w-4 h-4 text-indigo-400" />
              {t('auth.tg.openBot')}
            </a>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {/* Code */}
              <div className="space-y-1.5">
                <label htmlFor="tg-code" className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('auth.tg.codePlaceholder')}
                </label>
                <input
                  ref={codeRef}
                  id="tg-code"
                  name="code"
                  type="text"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={e => {
                    setCode(e.target.value);
                    if (localError) setLocalError(null);
                  }}
                  placeholder={t('auth.tg.codePlaceholder')}
                  data-testid="telegram-code-input"
                  className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-indigo-500/40 focus:bg-white/[0.05] focus:ring-2 focus:ring-indigo-500/20 font-mono tracking-widest"
                />
              </div>

              {/* Error */}
              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-xs"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="leading-relaxed">{errorMessage}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={busy || !code}
                data-testid="telegram-submit-btn"
                className={cn(
                  'w-full h-10 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                  'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-900/40',
                  'hover:from-indigo-400 hover:to-indigo-500 hover:shadow-indigo-900/60 active:scale-[0.98]',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:from-indigo-500 disabled:hover:to-indigo-600',
                  'flex items-center justify-center gap-2'
                )}
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('auth.submitting')}
                  </span>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {t('auth.tg.submit')}
                  </>
                  )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
