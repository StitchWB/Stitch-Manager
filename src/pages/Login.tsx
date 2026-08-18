/**
 * Login page — shown when auth is enabled, users exist, but no session.
 *
 * Deep Space glassmorphism: gradient backdrop, glass card, indigo accent.
 * Enter submits, autofocus on username, inline error on 401/network failure.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal, AlertCircle, Loader2, ArrowLeft, Send } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import { cn } from '../lib/utils';

export default function Login() {
  const { login, busy, error, sessionExpired, clearError, required, setAuthView } = useAuthStore();
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username || !password) return;
    await login(username, password);
  };

  const errorMessage = error
    ? t(error)
    : sessionExpired
      ? t('auth.sessionExpired')
      : null;

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
            {/* Back link — only when auth is optional (!required) */}
            {!required && (
              <button
                type="button"
                onClick={() => setAuthView('welcome')}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mb-6 -mt-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('auth.back')}
              </button>
            )}

            {/* Logo + title */}
            <div className="flex flex-col items-center text-center mb-8">
              <div className="rounded-xl w-12 h-12 flex items-center justify-center mb-4 bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
                <Terminal className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-white text-xl font-black tracking-tight uppercase">
                {t('auth.title')}
              </h1>
              <p className="text-slate-400 text-sm mt-1">{t('auth.subtitle')}</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {/* Username */}
              <div className="space-y-1.5">
                <label htmlFor="login-username" className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('auth.username')}
                </label>
                <input
                  ref={usernameRef}
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={e => {
                    setUsername(e.target.value);
                    if (error || sessionExpired) clearError();
                  }}
                  placeholder={t('auth.usernamePlaceholder')}
                  className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-indigo-500/40 focus:bg-white/[0.05] focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="login-password" className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('auth.password')}
                </label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    if (error || sessionExpired) clearError();
                  }}
                  placeholder={t('auth.passwordPlaceholder')}
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
                disabled={busy || !username || !password}
                className={cn(
                  'w-full h-10 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                  'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-900/40',
                  'hover:from-indigo-400 hover:to-indigo-500 hover:shadow-indigo-900/60 active:scale-[0.98]',
                  'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:from-indigo-500 disabled:hover:to-indigo-600'
                )}
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('auth.submitting')}
                  </span>
                ) : (
                  t('auth.submit')
                )}
              </button>
             </form>

            {/* Tertiary: login via Telegram (available in mandatory mode too) */}
            <button
              type="button"
              onClick={() => setAuthView('telegram')}
              data-testid="login-tg-link"
              className="w-full mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              {t('auth.login.tgLink')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
