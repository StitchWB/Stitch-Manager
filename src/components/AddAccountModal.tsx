import { useState, useRef } from 'react';
import type { ProviderName } from '../types';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import { PROVIDERS } from '../constants/providers';
import { Input, Select, Modal } from './ui';

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

export default function AddAccountModal({ isOpen, onClose, onSubmit }: AddAccountModalProps) {
  const { language } = useAppStore();
  const [provider, setProvider] = useState<ProviderName>('kiro');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('accounts.addAccount')}
      isLoading={isSubmitting}
      loadingMessage={t('accounts.addingAccount')}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-3">
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
            form="add-account-form"
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
      }
    >
      <form id="add-account-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Provider Select */}
        <Select
          label={t('accounts.provider')}
          id="provider-select"
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderName)}
          disabled={isSubmitting}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>

        {/* Email Input */}
        <Input
          ref={emailInputRef}
          label={t('accounts.email')}
          id="email-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting}
          required
          placeholder={t('autoReg.placeholders.email')}
          aria-required="true"
        />

        {/* Password Input */}
        <Input
          label={t('accounts.password')}
          id="password-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isSubmitting}
          required
          placeholder="••••••••"
          aria-required="true"
        />

        {/* Token Input (Optional) */}
        <div>
          <Input
            label={`${t('accounts.token')} (${t('accounts.tokenOptional')})`}
            id="token-input"
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={isSubmitting}
            placeholder={t('accounts.pasteTokenHere')}
            className="font-mono"
            aria-describedby="token-hint"
          />
          <p id="token-hint" className="mt-1 text-xs text-slate-500">
            {t('accounts.tokenOptionalHint')}
          </p>
        </div>
      </form>
    </Modal>
  );
}
