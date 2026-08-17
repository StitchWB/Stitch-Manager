/**
 * Setup page — first-run onboarding shown when auth is enabled but no users
 * exist yet. Creates the first admin account, then auto-logs in (the backend
 * sets the session cookie on the same /api/auth/setup call).
 *
 * Same Deep Space glassmorphism as Login, with a "first admin" badge accent.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Terminal, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { useAppStore } from '../stores/app';
import { t } from '@/lib/i18n';
import { cn } from '../lib/utils';

export default function Setup() {
  const { setup, busy, error, clearError } = useAuthStore();
  const language = useAppStore(state => state.language);
  void language; // re-render on language change

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setLocalError(null);

    if (!username || !password) {
      setLocalError('auth.setup.errorValidation');
      return;
    }
    if (password !== confirm) {
      setLocalError('auth.setup.errorMismatch');
      return;
    }

    await setup(username, password);
  };

  const errorMessage = localError ? t(localError) : error ? t(error) : null;

  const onChange = () => {
    if (localError) setLocalError(null);
    if (error) clearError();
  };

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
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
        }}
      />

      <div className="relative w-full max-w-md px-6">
        <div className="rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-2xl shadow-2xl shadow-indigo-950/40 overflow-hidden">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />

          <div className="px-8 pt-10 pb-8">
            {/* Logo + title + first-admin badge */}
            <div className="flex flex-col items-center text-center mb-8">
              <div className="relative mb-4">
                <div className="rounded-xl w-12 h-12 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
                  <Terminal className="w-6 h-6 text-white" />
                </div>
                <div className="absolute -bottom-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 border-2 border-[#0a0a0d] flex items-center justify-center">
                  <ShieldCheck className="w-3 h-3 text-white" />
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[10px] font-bold uppercase tracking-widest mb-2">
                {t('auth.setup.adminBadge')}
              </span>
              <h1 className="text-white text-xl font-black tracking-tight">
                {t('auth.setup.title')}
              </h1>
              <p className="text-slate-400 text-sm mt-1">{t('auth.setup.subtitle')}</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {/* Username */}
              <div className="space-y-1.5">
                <label htmlFor="setup-username" className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('auth.setup.username')}
                </label>
                <input
                  ref={usernameRef}
                  id="setup-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={e => {
                    setUsername(e.target.value);
                    onChange();
                  }}
                  placeholder={t('auth.setup.usernamePlaceholder')}
                  className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-indigo-500/40 focus:bg-white/[0.05] focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="setup-password" className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('auth.setup.password')}
                </label>
                <input
                  id="setup-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    onChange();
                  }}
                  placeholder={t('auth.setup.passwordPlaceholder')}
                  className="w-full h-10 px-3 rounded-lg bg-white/[0.03] border border-white/[0.06] text-sm text-slate-200 placeholder-slate-600 outline-none transition-all duration-200 focus:border-indigo-500/40 focus:bg-white/[0.05] focus:ring-2 focus:ring-indigo-500/20 font-mono tracking-widest"
                />
              </div>

              {/* Confirm password */}
              <div className="space-y-1.5">
                <label htmlFor="setup-confirm" className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                  {t('auth.setup.confirmPassword')}
                </label>
                <input
                  id="setup-confirm"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={e => {
                    setConfirm(e.target.value);
                    onChange();
                  }}
                  placeholder={t('auth.setup.confirmPasswordPlaceholder')}
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
                disabled={busy || !username || !password || !confirm}
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
                    {t('auth.setup.submitting')}
                  </span>
                ) : (
                  t('auth.setup.submit')
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
