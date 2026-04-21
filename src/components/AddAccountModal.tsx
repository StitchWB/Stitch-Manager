import { useState, useRef } from 'react';
import type { ProviderName } from '../types/ui';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import { PROVIDERS } from '../constants/providers';
import { Button, Input, Modal, Select } from '@/components/ui';

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
          <Button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            variant="secondary"
            size="md"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="add-account-form"
            disabled={isSubmitting}
            variant="primary"
            size="md"
            isLoading={isSubmitting}
          >
            {isSubmitting ? t('accounts.addingAccount') : t('accounts.addAccount')}
          </Button>
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
          onChange={e => setProvider(e.target.value as ProviderName)}
          disabled={isSubmitting}
        >
          {PROVIDERS.map(p => (
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
          onChange={e => setEmail(e.target.value)}
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
          onChange={e => setPassword(e.target.value)}
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
            onChange={e => setToken(e.target.value)}
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
