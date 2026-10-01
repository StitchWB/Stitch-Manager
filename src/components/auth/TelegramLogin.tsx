/**
 * TelegramLogin — merged auth surface: deep-link + one-time-code Telegram
 * login, and in optional mode the app's welcome/guest gate.
 *
 * Same Deep Space glassmorphism as Login/Setup. The primary path (legacy
 * mode) is the deep-link CTA: it mints a one-time token via
 * POST /api/auth/deeplink/start, opens the bot with ?start=login_<token>,
 * and polls the status endpoint until the bot confirms — the user never
 * types the code. The manual one-time-code form stays available in BOTH
 * modes as an independent fallback (the bot /login command always works,
 * even on localhost where OIDC cannot run — HTTPS + trusted origin
 * required).
 *
 * When the backend reports `tg_auth_mode === 'oidc'` (via /api/auth/status),
 * the official Telegram OIDC button is rendered ABOVE the code form and the
 * deep-link CTA is hidden (the code path is disabled server-side in oidc
 * mode). We mount the host `<button class="tg-auth-button">`, load the
 * library once and call `Telegram.Login.init({client_id, scope}, cb)`; the
 * library's own click handler opens the popup (data-* auto-init reads the
 * SCRIPT tag and is wrong for an SPA).
 *
 * Everything lives in ONE card: a left form column and, at lg+, a right
 * "how it works" guide column; below lg the same guide content collapses
 * into a <details> under the form.
 *
 * Mode-switched by the store's `required` flag. Required mode (from the
 * Login page tertiary link) shows a back link and the Telegram login
 * header. Optional mode is the ROOT auth surface (no back link): welcome
 * header plus the guest entry, the web-only password login and the setup
 * hint under the Telegram mechanisms.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Terminal,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Send,
  LogIn,
  Bot,
  MousePointerClick,
  CheckCircle2,
  Megaphone,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { t } from '@/lib/i18n';
import {
  MAIN_TELEGRAM_URL,
  STITCH_BOT_LOGIN_URL,
  STITCH_BOT_URL,
  stitchBotDeeplinkUrl,
} from '@/lib/links';
import { cn } from '../../lib/utils';
import { isDesktopApp } from '@/lib/backend/core/url';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Input } from '@/components/ui/Input';
import {
  getTelegramDeeplinkStatus,
  startTelegramDeeplink,
} from '@/lib/backend/modules/auth';
import {
  ensureTelegramLoginScript,
  TG_OIDC_CLIENT_ID,
  type TelegramAuthResult,
} from '@/lib/telegramLogin';

const DEEPLINK_POLL_MS = 2500;

const GUIDE_STEPS = [
  { icon: MousePointerClick, titleKey: 'auth.tg.guide.step1.title', textKey: 'auth.tg.guide.step1.text' },
  { icon: Bot, titleKey: 'auth.tg.guide.step2.title', textKey: 'auth.tg.guide.step2.text' },
  { icon: CheckCircle2, titleKey: 'auth.tg.guide.step3.title', textKey: 'auth.tg.guide.step3.text' },
];

function GuideContent() {
  return (
    <>
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
        {t('auth.tg.guide.title')}
      </h2>

      <ol className="space-y-4">
        {GUIDE_STEPS.map((step, i) => (
          <li key={step.titleKey} className="flex items-start gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-bold flex items-center justify-center">
              {i + 1}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
                <step.icon className="w-4 h-4 text-indigo-400 shrink-0" />
                {t(step.titleKey)}
              </div>
              <p className="text-xs text-slate-500 leading-relaxed mt-0.5">{t(step.textKey)}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="h-px w-full bg-white/[0.06]" />

      <div className="space-y-1.5">
        {/* eslint-disable-next-line react/forbid-elements -- external URL to Telegram bot chat; react-router Link is internal-only */}
        <a
          href={STITCH_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="telegram-guide-bot-link"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:text-white hover:border-indigo-500/30 transition-colors"
        >
          <Send className="w-4 h-4 text-indigo-400 shrink-0" />
          {t('auth.tg.guide.botLink')}
        </a>
        {/* eslint-disable-next-line react/forbid-elements -- external URL to Telegram channel; react-router Link is internal-only */}
        <a
          href={MAIN_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="telegram-guide-channel-link"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-300 bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:text-white hover:border-indigo-500/30 transition-colors"
        >
          <Megaphone className="w-4 h-4 text-indigo-400 shrink-0" />
          {t('auth.tg.guide.channelLink')}
        </a>
      </div>

      <p className="text-xs text-slate-600 leading-relaxed">{t('auth.tg.guide.fallback')}</p>
    </>
  );
}

export default function TelegramLogin() {
  const loginTelegram = useAuthStore(state => state.loginTelegram);
  const loginTelegramDeeplink = useAuthStore(state => state.loginTelegramDeeplink);
  const loginTelegramOidc = useAuthStore(state => state.loginTelegramOidc);
  const busy = useAuthStore(state => state.busy);
  const required = useAuthStore(state => state.required);
  const hasUsers = useAuthStore(state => state.hasUsers);
  const enterAsGuest = useAuthStore(state => state.enterAsGuest);
  const tgAuthMode = useAuthStore(state => state.tgAuthMode);
  const setAuthView = useAuthStore(state => state.setAuthView);
  const language = useAppStore(state => state.language);
  void language; // re-render on language change
  // Desktop is local-only or TG-bound — password login / local account
  // creation are web surfaces.
  const showLocalAuth = !isDesktopApp();

  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'waiting'>('idle');
  const codeRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    codeRef.current?.focus();
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (hardStopRef.current) {
      clearTimeout(hardStopRef.current);
      hardStopRef.current = null;
    }
  }, []);

  // Invariant: every exit path (unmount/cancel/ready/expiry) must clear BOTH timers — a stray tick would setState after unmount or resurrect a cancelled login.
  useEffect(() => stopPolling, [stopPolling]);

  // The store re-throws i18n keys as Error messages and legacy payloads can
  // still stringify to "[object Object]" — always surface readable text.
  const humanize = (err: unknown, fallbackKey: string): string => {
    const raw = err instanceof Error && err.message ? err.message : '';
    if (!raw || raw === '[object Object]') return t(fallbackKey);
    if (/^[a-z]+(\.[a-z0-9_]+)+$/i.test(raw)) return t(raw);
    return raw;
  };

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
      setLocalError(humanize(err, 'auth.tg.errorGeneric'));
    }
  };

  // ── Deep-link flow ─────────────────────────────────────────────────────

  const onDeepLink = async () => {
    if (busy || phase === 'waiting') return;
    setLocalError(null);
    try {
      const { token, expires_in } = await startTelegramDeeplink();
      window.open(stitchBotDeeplinkUrl(token), '_blank', 'noopener,noreferrer');
      setPhase('waiting');

      const expire = () => {
        stopPolling();
        setPhase('idle');
        setLocalError(t('auth.tg.deepLink.expired'));
      };

      const tick = async () => {
        try {
          const status = await getTelegramDeeplinkStatus(token);
          if (status === 'ready') {
            stopPolling();
            try {
              await loginTelegramDeeplink(token);
            } catch (err) {
              setPhase('idle');
              setLocalError(humanize(err, 'auth.tg.errorGeneric'));
            }
            return;
          }
          if (status === 'expired' || status === 'consumed') {
            expire();
            return;
          }
          pollTimerRef.current = setTimeout(tick, DEEPLINK_POLL_MS);
        } catch {
          pollTimerRef.current = setTimeout(tick, DEEPLINK_POLL_MS);
        }
      };

      pollTimerRef.current = setTimeout(tick, DEEPLINK_POLL_MS);
      hardStopRef.current = setTimeout(expire, expires_in * 1000);
    } catch (err) {
      setLocalError(humanize(err, 'auth.tg.errorGeneric'));
    }
  };

  const onDeepLinkCancel = () => {
    stopPolling();
    setPhase('idle');
  };

  // ── OIDC popup flow ────────────────────────────────────────────────────
  //
  // NOTE for the nginx admin: the Telegram OAuth popup flow breaks if the
  // login page is served with `Cross-Origin-Opener-Policy: same-origin`.
  // COOP must be absent, or set to `same-origin-allow-popups`, on every
  // route that renders this surface. Nothing in this repo currently sets
  // COOP — keep it that way, or relax it explicitly in the nginx config
  // for /login and /telegram paths.

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
      setLocalError(humanize(err, 'auth.tg.oidc.errorGeneric'));
    });
  };

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

  const errorMessage = localError;

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden" style={{ background: '#0a0a0d' }}>
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

      <div
        className="relative w-full max-w-3xl px-6 py-10"
        data-testid="telegram-page"
      >
        <div className="w-full rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-2xl shadow-2xl shadow-indigo-950/40 overflow-hidden">
          {/* Top accent line */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

          <div className="flex flex-col lg:flex-row">
            <div className="w-full lg:flex-1 lg:min-w-0 px-8 pt-10 pb-8">
              {required && (
                <ButtonBase
                  type="button"
                  onClick={() => setAuthView('login')}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mb-6 -mt-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  {t('auth.tg.back')}
                </ButtonBase>
              )}

              {/* Logo + title */}
              <div className="flex flex-col items-center text-center mb-8">
                <div className="rounded-xl w-12 h-12 flex items-center justify-center mb-4 bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
                  <Terminal className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-white text-xl font-black tracking-tight uppercase">
                  {required ? t('auth.tg.title') : t('auth.guest.title')}
                </h1>
                {!required && (
                  <p className="text-slate-400 text-sm mt-1">{t('auth.guest.subtitle')}</p>
                )}
              </div>

              {required ? (
                <p className="text-center text-slate-400 text-sm leading-relaxed mb-6 px-2">
                  {t('auth.tg.description')}
                </p>
              ) : (
                <p className="text-center text-slate-500 text-xs leading-relaxed mb-6 px-2">
                  {t('auth.guest.hint')}
                </p>
              )}

              {tgAuthMode !== 'oidc' && (
                <div className="mb-4">
                  <ButtonBase
                    type="button"
                    onClick={onDeepLink}
                    disabled={busy || phase === 'waiting'}
                    data-testid="telegram-deeplink-btn"
                    className={cn(
                      'w-full h-10 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                      'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-900/40',
                      'hover:from-indigo-400 hover:to-indigo-500 hover:shadow-indigo-900/60 active:scale-[0.98]',
                      'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:from-indigo-500 disabled:hover:to-indigo-600',
                      'flex items-center justify-center gap-2'
                    )}
                  >
                    {phase === 'waiting' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('auth.tg.deepLink.waiting')}
                      </>
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        {t('auth.tg.deepLink.cta')}
                      </>
                    )}
                  </ButtonBase>

                  {phase === 'waiting' && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span
                        data-testid="telegram-deeplink-status"
                        className="flex items-center gap-2 text-xs text-slate-500"
                      >
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                        </span>
                        {t('auth.tg.deepLink.waiting')}
                      </span>
                      <ButtonBase
                        type="button"
                        onClick={onDeepLinkCancel}
                        data-testid="telegram-deeplink-cancel"
                        className="shrink-0 text-xs text-slate-400 hover:text-slate-200 transition-colors px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] active:scale-[0.98]"
                      >
                        {t('auth.tg.deepLink.cancel')}
                      </ButtonBase>
                    </div>
                  )}
                </div>
              )}

              {tgAuthMode !== 'oidc' && (
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="text-xs text-slate-500 uppercase tracking-wider">
                    {t('auth.tg.deepLink.orCode')}
                  </span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                </div>
              )}

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
                  <ButtonBase
                    type="button"
                    disabled={busy}
                    data-style="shine"
                    className="tg-auth-button"
                    data-testid="tg-auth-button"
                  >
                    {busy ? t('auth.submitting') : t('auth.tg.oidc.button')}
                  </ButtonBase>
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
              {/* eslint-disable-next-line react/forbid-elements -- external URL to Telegram bot chat; react-router Link is internal-only */}
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
                  <Input
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
                    containerClassName=""
                    shellClassName="h-10 bg-white/[0.03] border-white/[0.06] focus-within:border-indigo-500/40 focus-within:bg-white/[0.05] focus-within:ring-2 focus-within:ring-indigo-500/20"
                    className="font-mono tracking-widest"
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
                <ButtonBase
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
                </ButtonBase>
              </form>

              {!required && (
                <>
                  {/* Password login (web only — desktop is local/TG) */}
                  {showLocalAuth && (
                    <div className="mt-3">
                      <ButtonBase
                        type="button"
                        onClick={() => setAuthView('login')}
                        data-testid="guest-login-btn"
                        className={cn(
                          'w-full h-10 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                          'bg-white/[0.03] border border-white/[0.06] text-slate-200',
                          'hover:bg-white/[0.05] hover:border-white/[0.10] active:scale-[0.98]',
                          'flex items-center justify-center gap-2'
                        )}
                      >
                        <LogIn className="w-4 h-4" />
                        {t('auth.guest.loginPassword')}
                      </ButtonBase>

                      {/* Hint link: create a local account when none exist */}
                      {!hasUsers && (
                        <ButtonBase
                          type="button"
                          onClick={() => setAuthView('setup')}
                          data-testid="guest-no-account-hint"
                          className="w-full mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          {t('auth.guest.noAccountHint')}
                        </ButtonBase>
                      )}
                    </div>
                  )}

                  {/* Continue without login (guest) */}
                  <ButtonBase
                    type="button"
                    onClick={enterAsGuest}
                    data-testid="guest-continue-btn"
                    className={cn(
                      'w-full h-10 mt-3 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                      'bg-transparent border border-white/[0.04] text-slate-400',
                      'hover:bg-white/[0.02] hover:text-slate-300 active:scale-[0.98]',
                      'flex items-center justify-center gap-2'
                    )}
                  >
                    {t('auth.guest.continue')}
                    <ArrowRight className="w-4 h-4" />
                  </ButtonBase>
                </>
              )}
            </div>

            <div
              data-testid="telegram-guide-panel"
              className="hidden lg:flex flex-col w-72 shrink-0 px-6 py-8 gap-5 border-l border-white/[0.06] bg-white/[0.01]"
            >
              <GuideContent />
            </div>
          </div>

          <details
            data-testid="telegram-guide-mobile"
            className="lg:hidden border-t border-white/[0.06] group"
          >
            <summary
              data-testid="telegram-guide-toggle"
              className="flex items-center justify-between gap-2 px-6 py-4 text-sm font-medium text-slate-300 cursor-pointer select-none hover:text-white transition-colors [&::-webkit-details-marker]:hidden"
            >
              {t('auth.tg.guide.toggle')}
              <ChevronRight className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-6 pt-5 pb-6 flex flex-col gap-5">
              <GuideContent />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
