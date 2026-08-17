/**
 * WelcomeGate — optional auth surface shown when auth is enabled but NOT
 * required (desktop with auth available, but no forced login).
 *
 * Same Deep Space glassmorphism as Login/Setup. Offers three ways in:
 *   1. Primary "Login via Telegram" → TelegramLogin screen (one-time code).
 *   2. "Password login" → Login screen (always visible; when !hasUsers a
 *      hint link below offers the Setup path so the old secondary create
 *      button is not duplicated).
 *   3. "Continue without login" → enter the app as a guest (in-memory flag,
 *      cleared on reload/logout).
 */

import { Terminal, Send, LogIn, ArrowRight } from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useAppStore } from '../../stores/app';
import { t } from '@/lib/i18n';
import { cn } from '../../lib/utils';

export default function WelcomeGate() {
  const hasUsers = useAuthStore(state => state.hasUsers);
  const enterAsGuest = useAuthStore(state => state.enterAsGuest);
  const setAuthView = useAuthStore(state => state.setAuthView);
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

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

      <div className="relative w-full max-w-md px-6">
        <div className="rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-2xl shadow-2xl shadow-indigo-950/40 overflow-hidden">
          {/* Top accent line */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

          <div className="px-8 pt-10 pb-8">
            {/* Logo + title */}
            <div className="flex flex-col items-center text-center mb-8">
              <div className="rounded-xl w-12 h-12 flex items-center justify-center mb-4 bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
                <Terminal className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-white text-xl font-black tracking-tight uppercase">
                {t('auth.guest.title')}
              </h1>
              <p className="text-slate-400 text-sm mt-1">{t('auth.guest.subtitle')}</p>
            </div>

            {/* Hint */}
            <p className="text-center text-slate-500 text-xs leading-relaxed mb-6 px-2">
              {t('auth.guest.hint')}
            </p>

            {/* Primary: login via Telegram */}
            <button
              type="button"
              onClick={() => setAuthView('telegram')}
              data-testid="guest-telegram-btn"
              className={cn(
                'w-full h-10 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-900/40',
                'hover:from-indigo-400 hover:to-indigo-500 hover:shadow-indigo-900/60 active:scale-[0.98]',
                'flex items-center justify-center gap-2'
              )}
            >
              <Send className="w-4 h-4" />
              {t('auth.login.tgLink')}
            </button>

            {/* Secondary: password login (always visible) */}
            <div className="mt-3">
              <button
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
              </button>

              {/* Hint link: create a local account when none exist */}
              {!hasUsers && (
                <button
                  type="button"
                  onClick={() => setAuthView('setup')}
                  data-testid="guest-no-account-hint"
                  className="w-full mt-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {t('auth.guest.noAccountHint')}
                </button>
              )}
            </div>

            {/* Tertiary: continue without login (guest) */}
            <button
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
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
