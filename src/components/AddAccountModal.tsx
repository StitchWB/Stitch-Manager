import { useState } from 'react';
import { X } from 'lucide-react';
import type { ProviderName } from '../types';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    provider: ProviderName;
    email: string;
    password: string;
    token?: string;
  }) => Promise<void>;
}

const providers: { id: ProviderName; name: string }[] = [
  { id: 'kiro', name: 'Kiro' },
  { id: 'windsurf', name: 'Windsurf' },
  { id: 'trae', name: 'Trae' },
  { id: 'copilot', name: 'Copilot' },
];

export default function AddAccountModal({ isOpen, onClose, onSubmit }: AddAccountModalProps) {
  const { language } = useAppStore();
  const [provider, setProvider] = useState<ProviderName>('kiro');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Force re-render when language changes
  void language; // Force re-render on language change

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await onSubmit({
        provider,
        email,
        password,
        token: token || undefined,
      });
      // Reset form on success
      setProvider('kiro');
      setEmail('');
      setPassword('');
      setToken('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setError(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-surface-dark border border-border-dark rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-dark">
          <h3 className="text-lg font-semibold text-white">{t('accounts.addAccount')}</h3>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Provider Select */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              {t('accounts.provider')}
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderName)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 bg-background-dark border border-border-dark rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all disabled:opacity-50"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Email Input */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              {t('accounts.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              required
              placeholder="user@example.com"
              className="w-full px-3 py-2 bg-background-dark border border-border-dark rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all disabled:opacity-50"
            />
          </div>

          {/* Password Input */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              {t('accounts.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              required
              placeholder="••••••••"
              className="w-full px-3 py-2 bg-background-dark border border-border-dark rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all disabled:opacity-50"
            />
          </div>

          {/* Token Input (Optional) */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              {t('accounts.token')} <span className="text-slate-500">({t('accounts.tokenOptional')})</span>
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={isSubmitting}
              placeholder="Paste token here..."
              className="w-full px-3 py-2 bg-background-dark border border-border-dark rounded-lg text-white placeholder-slate-500 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-slate-500">
              {t('accounts.tokenOptionalHint')}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-blue-600 rounded-lg shadow-lg shadow-primary/20 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {t('accounts.addingAccount')}
                </>
              ) : (
                t('accounts.addAccount')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
