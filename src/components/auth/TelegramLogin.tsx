/**
 * TelegramLogin — one-time-code auth surface.
 *
 * Same Deep Space glassmorphism as Login/Setup. The user sends /login to our
 * Telegram bot, receives a one-time code, and enters it here. On success the
 * store action re-runs init() so the gate closes.
 *
 * Reachable from the WelcomeGate (optional mode, back → 'welcome') and from
 * the Login page tertiary link (required mode, back → 'login').
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal, AlertCircle, Loader2, ArrowLeft, Send } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { t } from '@/lib/i18n';
import { cn } from '../../lib/utils';

export default function TelegramLogin() {
  const loginTelegram = useAuthStore(state => state.loginTelegram);
  const busy = useAuthStore(state => state.busy);
  const required = useAuthStore(state => state.required);
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
            <p className="text-center text-slate-400 text-sm leading-relaxed mb-6 px-2">
              {t('auth.tg.description')}
            </p>

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
