import { t } from "@/lib/i18n";import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import { createAiProxyAccount, updateAiProxyAccount } from '../../lib/backend/modules/aiProxy';
import OAuthModal from './OAuthModal';
import type { AiProxyAccount } from '../../types/generated';
import { Button, Input, Modal, Select, Toggle } from '@/components/ui';

interface AccountModalProps {
  isOpen: boolean;
  account: AiProxyAccount | null;
  onClose: () => void;
  onSubmit: () => void;
}

const PROVIDERS = [
{ value: 'openai', label: 'OpenAI' },
{ value: 'claude', label: 'Claude' },
{ value: 'anthropic', label: 'Anthropic' },
{ value: 'gemini', label: 'Gemini' },
{ value: 'kiro', label: 'Kiro' },
{ value: 'antigravity', label: 'Antigravity' },
{ value: 'fireworks', label: 'Fireworks AI' }];


const AUTH_METHODS = [
{ value: 'oauth', labelKey: 'aiHub.account_modal.authMethod.oauth' },
{ value: 'api_key', labelKey: 'aiHub.account_modal.authMethod.api_key' },
{ value: 'session', labelKey: 'aiHub.account_modal.authMethod.session' }];


const ACCOUNT_TYPES = [
{ value: 'free', labelKey: 'aiHub.account_modal.accountType.free' },
{ value: 'pro', labelKey: 'aiHub.account_modal.accountType.pro' },
{ value: 'team', labelKey: 'aiHub.account_modal.accountType.team' },
{ value: 'enterprise', labelKey: 'aiHub.account_modal.accountType.enterprise' }];


// Providers that support OAuth
const OAUTH_PROVIDERS = ['openai', 'claude', 'anthropic', 'gemini', 'kiro', 'antigravity', 'fireworks'];

// Backend masks instance-shared/foreign secrets as first4+"****"+last4.
// A value containing "****" is a masked placeholder — never submit it back.
const isMaskedSecret = (value: string | null | undefined): boolean =>
  typeof value === 'string' && value.includes('****');

export default function AccountModal({ isOpen, account, onClose, onSubmit }: AccountModalProps) {
  const [formData, setFormData] = useState({
    provider: 'openai',
    name: '',
    authMethod: 'api_key',
    oauthToken: '',
    apiKey: '',
    sessionToken: '',
    accountType: 'free',
    enabled: true,
    softQuotaTokensDaily: '',
    softQuotaRequestsDaily: ''
  });
  const [saving, setSaving] = useState(false);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  // Stable ref: an inline onClose would recreate OAuthModal's initOAuth
  // callback on every render and re-trigger its effect (React #185 loop).
  const closeOAuthModal = useCallback(() => setShowOAuthModal(false), []);

  useEffect(() => {
    queueMicrotask(() => {
    const accountWithQuotas = account as
    (AiProxyAccount & {
      softQuotaTokensDaily?: number | null;
      softQuotaRequestsDaily?: number | null;
    }) |
    null;

    if (account) {
      const softQuotaTokensDaily = accountWithQuotas?.softQuotaTokensDaily;
      const softQuotaRequestsDaily = accountWithQuotas?.softQuotaRequestsDaily;
      setFormData({
        provider: account.provider,
        name: account.name,
        authMethod: account.apiKey ? 'api_key' : account.oauthToken ? 'oauth' : 'session',
        oauthToken: account.oauthToken || '',
        apiKey: account.apiKey || '',
        sessionToken: account.sessionToken || '',
        accountType: account.accountType || 'free',
        enabled: account.enabled,
        softQuotaTokensDaily:
        typeof softQuotaTokensDaily === 'number' ? String(softQuotaTokensDaily) : '',
        softQuotaRequestsDaily:
        typeof softQuotaRequestsDaily === 'number' ? String(softQuotaRequestsDaily) : ''
      });
    } else {
      setFormData({
        provider: 'openai',
        name: '',
        authMethod: 'api_key',
        oauthToken: '',
        apiKey: '',
        sessionToken: '',
        accountType: 'free',
        enabled: true,
        softQuotaTokensDaily: '',
        softQuotaRequestsDaily: ''
      });
    }
    });
  }, [account, isOpen]);

  const parseOptionalPositiveInt = (value: string, label: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error(t('aiHub.account_modal.positive_integer_error', { label }));
      return undefined;
    }

    return parsed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error(t('aiHub.account_modal.name_required'));
      return;
    }

    const authValue =
    formData.authMethod === 'oauth' ?
    formData.oauthToken :
    formData.authMethod === 'api_key' ?
    formData.apiKey :
    formData.sessionToken;

    if (!authValue.trim()) {
      toast.error(t('aiHub.account_modal.credential_required'));
      return;
    }

    const softQuotaTokensDaily = parseOptionalPositiveInt(
      formData.softQuotaTokensDaily,
      t('aiHub.account_modal.soft_daily_token_quota')
    );
    if (softQuotaTokensDaily === undefined) return;

    const softQuotaRequestsDaily = parseOptionalPositiveInt(
      formData.softQuotaRequestsDaily,
      t('aiHub.account_modal.soft_daily_request_quota')
    );
    if (softQuotaRequestsDaily === undefined) return;

    setSaving(true);
    try {
      const accountData: AiProxyAccount & {
        softQuotaTokensDaily: number | null;
        softQuotaRequestsDaily: number | null;
      } = {
        id: account?.id || null,
        provider: formData.provider,
        name: formData.name,
        oauthToken: formData.authMethod === 'oauth' && !isMaskedSecret(formData.oauthToken) ? formData.oauthToken : null,
        apiKey: formData.authMethod === 'api_key' && !isMaskedSecret(formData.apiKey) ? formData.apiKey : null,
        sessionToken: formData.authMethod === 'session' && !isMaskedSecret(formData.sessionToken) ? formData.sessionToken : null,
        enabled: formData.enabled,
        accountType: formData.accountType,
        softQuotaTokensDaily,
        softQuotaRequestsDaily,
        requestsToday: account?.requestsToday || 0,
        requestsTotal: account?.requestsTotal || 0,
        tokensUsed: account?.tokensUsed || 0,
        lastUsedAt: account?.lastUsedAt || null,
        createdAt: account?.createdAt || Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000)
      };

      if (account) {
        await updateAiProxyAccount(accountData);
        toast.success(t('aiHub.account_modal.updated_success'));
      } else {
        await createAiProxyAccount(accountData);
        toast.success(t('aiHub.account_modal.created_success'));
      }

      onSubmit();
    } catch (e) {
      console.error('[AccountModal] Error saving account:', e);
      toast.error(t('aiHub.account_modal.save_failed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthSuccess = () => {
    setShowOAuthModal(false);
    toast.success(t('aiHub.account_modal.oauth_completed'));
    // Refresh accounts list
    onSubmit();
  };

  const supportsOAuth = OAUTH_PROVIDERS.includes(formData.provider);

  // When editing, a secret field whose value contains "****" is a masked
  // placeholder from the backend — render it read-only so the user cannot
  // accidentally submit the mask back as the real secret.
  const apiKeyMasked = !!account && isMaskedSecret(formData.apiKey);
  const oauthTokenMasked = !!account && isMaskedSecret(formData.oauthToken);
  const sessionTokenMasked = !!account && isMaskedSecret(formData.sessionToken);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={account ? t('aiHub.account_modal.edit_title') : t('aiHub.account_modal.add_title')}
        size="md">

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.provider")}</label>
            <Select
              value={formData.provider}
              onChange={(e) => setFormData({ ...formData, provider: e.target.value })}
              options={PROVIDERS}
              disabled={!!account} />

          </div>

          {/* OAuth Button */}
          {!account && supportsOAuth &&
          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{t("aiHub.account_modal.use_oauth_login")}</p>
                  <p className="text-xs text-slate-400 mt-1">{t("aiHub.account_modal.authenticate_via_browser_recommended")}

                </p>
                </div>
                <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setShowOAuthModal(true)}>{t("aiHub.account_modal.login_with_oauth")}


              </Button>
              </div>
            </div>
          }

          {/* Account Name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.account_name")}</label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('aiHub.account_modal.name_placeholder')}
              required />

          </div>

          {/* Auth Method */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.authentication_method")}

            </label>
            <Select
              value={formData.authMethod}
              onChange={(e) => setFormData({ ...formData, authMethod: e.target.value })}
              options={AUTH_METHODS.map(opt => ({ value: opt.value, label: t(opt.labelKey) }))} />

          </div>

          {/* Conditional Auth Fields */}
          {formData.authMethod === 'oauth' &&
          <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.oauth_token")}</label>
              <Input
              type="password"
              value={formData.oauthToken}
              onChange={(e) => setFormData({ ...formData, oauthToken: e.target.value })}
              placeholder={t('aiHub.account_modal.oauth_token_placeholder')}
              required={!oauthTokenMasked}
              disabled={oauthTokenMasked} />

              {oauthTokenMasked && <p className="text-xs text-amber-400 mt-1">{t("aiProxy.secretMaskedHint")}</p>}
            </div>
          }

          {formData.authMethod === 'api_key' &&
          <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.api_key")}</label>
              <Input
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder="sk-..."
              required={!apiKeyMasked}
              disabled={apiKeyMasked} />

              {apiKeyMasked && <p className="text-xs text-amber-400 mt-1">{t("aiProxy.secretMaskedHint")}</p>}
            </div>
          }

          {formData.authMethod === 'session' &&
          <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.session_token")}</label>
              <Input
              type="password"
              value={formData.sessionToken}
              onChange={(e) => setFormData({ ...formData, sessionToken: e.target.value })}
              placeholder={t('aiHub.account_modal.session_token_placeholder')}
              required={!sessionTokenMasked}
              disabled={sessionTokenMasked} />

              {sessionTokenMasked && <p className="text-xs text-amber-400 mt-1">{t("aiProxy.secretMaskedHint")}</p>}
            </div>
          }

          {/* Account Type */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.account_type")}</label>
            <Select
              value={formData.accountType}
              onChange={(e) => setFormData({ ...formData, accountType: e.target.value })}
              options={ACCOUNT_TYPES.map(opt => ({ value: opt.value, label: t(opt.labelKey) }))} />

          </div>

          {/* Soft Quotas */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.soft_daily_token_quota")}

            </label>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={formData.softQuotaTokensDaily}
              onChange={(e) => setFormData({ ...formData, softQuotaTokensDaily: e.target.value })}
              placeholder={t('aiHub.account_modal.optional_placeholder')} />

          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t("aiHub.account_modal.soft_daily_request_quota")}

            </label>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={formData.softQuotaRequestsDaily}
              onChange={(e) => setFormData({ ...formData, softQuotaRequestsDaily: e.target.value })}
              placeholder={t('aiHub.account_modal.optional_placeholder')} />

          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
            <div>
              <div className="text-sm font-medium text-white">{t("aiHub.account_modal.enable_account")}</div>
              <div className="text-xs text-slate-400 mt-0.5">{t("aiHub.account_modal.account_will_be_available_for_routing")}

              </div>
            </div>
            <Toggle
              label=""
              checked={formData.enabled}
              onChange={(checked) => setFormData({ ...formData, enabled: checked })} />

          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <Button onClick={onClose} variant="secondary" disabled={saving} type="button">{t("aiHub.account_modal.cancel")}

            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t('aiHub.account_modal.saving') : account ? t('aiHub.account_modal.update') : t('aiHub.account_modal.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* OAuth Modal */}
      <OAuthModal
        isOpen={showOAuthModal}
        provider={formData.provider}
        providerName={
        PROVIDERS.find((p) => p.value === formData.provider)?.label || formData.provider
        }
        onClose={closeOAuthModal}
        onSuccess={handleOAuthSuccess} />

    </>);

}