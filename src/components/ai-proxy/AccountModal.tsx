import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import { createAiProxyAccount, updateAiProxyAccount } from '../../lib/tauri/modules/aiProxy';
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
  { value: 'gemini', label: 'Gemini' },
  { value: 'kiro', label: 'Kiro' },
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'fireworks', label: 'Fireworks AI' },
];

const AUTH_METHODS = [
  { value: 'oauth', label: 'OAuth Token' },
  { value: 'api_key', label: 'API Key' },
  { value: 'session', label: 'Session Token' },
];

const ACCOUNT_TYPES = [
  { value: 'free', label: 'Free' },
  { value: 'pro', label: 'Pro' },
  { value: 'team', label: 'Team' },
  { value: 'enterprise', label: 'Enterprise' },
];

// Providers that support OAuth
const OAUTH_PROVIDERS = ['openai', 'claude', 'gemini', 'kiro', 'antigravity', 'fireworks'];

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
    softQuotaRequestsDaily: '',
  });
  const [saving, setSaving] = useState(false);
  const [showOAuthModal, setShowOAuthModal] = useState(false);

  useEffect(() => {
    const accountWithQuotas = account as
      | (AiProxyAccount & {
          softQuotaTokensDaily?: number | null;
          softQuotaRequestsDaily?: number | null;
        })
      | null;

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
          typeof softQuotaRequestsDaily === 'number' ? String(softQuotaRequestsDaily) : '',
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
        softQuotaRequestsDaily: '',
      });
    }
  }, [account, isOpen]);

  const parseOptionalPositiveInt = (value: string, label: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error(`${label} must be a positive integer`);
      return undefined;
    }

    return parsed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Account name is required');
      return;
    }

    const authValue =
      formData.authMethod === 'oauth'
        ? formData.oauthToken
        : formData.authMethod === 'api_key'
          ? formData.apiKey
          : formData.sessionToken;

    if (!authValue.trim()) {
      toast.error('Authentication credential is required');
      return;
    }

    const softQuotaTokensDaily = parseOptionalPositiveInt(
      formData.softQuotaTokensDaily,
      'Soft daily token quota'
    );
    if (softQuotaTokensDaily === undefined) return;

    const softQuotaRequestsDaily = parseOptionalPositiveInt(
      formData.softQuotaRequestsDaily,
      'Soft daily request quota'
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
        oauthToken: formData.authMethod === 'oauth' ? formData.oauthToken : null,
        apiKey: formData.authMethod === 'api_key' ? formData.apiKey : null,
        sessionToken: formData.authMethod === 'session' ? formData.sessionToken : null,
        enabled: formData.enabled,
        accountType: formData.accountType,
        softQuotaTokensDaily,
        softQuotaRequestsDaily,
        requestsToday: account?.requestsToday || 0,
        requestsTotal: account?.requestsTotal || 0,
        tokensUsed: account?.tokensUsed || 0,
        lastUsedAt: account?.lastUsedAt || null,
        createdAt: account?.createdAt || Math.floor(Date.now() / 1000),
        updatedAt: Math.floor(Date.now() / 1000),
      };

      if (account) {
        await updateAiProxyAccount(accountData);
        toast.success('Account updated successfully');
      } else {
        await createAiProxyAccount(accountData);
        toast.success('Account created successfully');
      }

      onSubmit();
    } catch (e) {
      console.error('[AccountModal] Error saving account:', e);
      toast.error(`Failed to save account: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthSuccess = () => {
    setShowOAuthModal(false);
    toast.success('OAuth completed! Token will be automatically saved.');
    // Refresh accounts list
    onSubmit();
  };

  const supportsOAuth = OAUTH_PROVIDERS.includes(formData.provider);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={account ? 'Edit Account' : 'Add Account'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Provider</label>
            <Select
              value={formData.provider}
              onChange={e => setFormData({ ...formData, provider: e.target.value })}
              options={PROVIDERS}
              disabled={!!account}
            />
          </div>

          {/* OAuth Button */}
          {!account && supportsOAuth && (
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Use OAuth Login</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Authenticate via browser (recommended)
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setShowOAuthModal(true)}
                >
                  Login with OAuth
                </Button>
              </div>
            </div>
          )}

          {/* Account Name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Account Name</label>
            <Input
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="My OpenAI Account"
              required
            />
          </div>

          {/* Auth Method */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Authentication Method
            </label>
            <Select
              value={formData.authMethod}
              onChange={e => setFormData({ ...formData, authMethod: e.target.value as any })}
              options={AUTH_METHODS}
            />
          </div>

          {/* Conditional Auth Fields */}
          {formData.authMethod === 'oauth' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">OAuth Token</label>
              <Input
                type="password"
                value={formData.oauthToken}
                onChange={e => setFormData({ ...formData, oauthToken: e.target.value })}
                placeholder="Enter OAuth token"
                required
              />
            </div>
          )}

          {formData.authMethod === 'api_key' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">API Key</label>
              <Input
                type="password"
                value={formData.apiKey}
                onChange={e => setFormData({ ...formData, apiKey: e.target.value })}
                placeholder="sk-..."
                required
              />
            </div>
          )}

          {formData.authMethod === 'session' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Session Token</label>
              <Input
                type="password"
                value={formData.sessionToken}
                onChange={e => setFormData({ ...formData, sessionToken: e.target.value })}
                placeholder="Enter session token"
                required
              />
            </div>
          )}

          {/* Account Type */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Account Type</label>
            <Select
              value={formData.accountType}
              onChange={e => setFormData({ ...formData, accountType: e.target.value })}
              options={ACCOUNT_TYPES}
            />
          </div>

          {/* Soft Quotas */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Soft Daily Token Quota
            </label>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={formData.softQuotaTokensDaily}
              onChange={e => setFormData({ ...formData, softQuotaTokensDaily: e.target.value })}
              placeholder="Optional"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Soft Daily Request Quota
            </label>
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={formData.softQuotaRequestsDaily}
              onChange={e => setFormData({ ...formData, softQuotaRequestsDaily: e.target.value })}
              placeholder="Optional"
            />
          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-white/5 border border-white/10">
            <div>
              <div className="text-sm font-medium text-white">Enable Account</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Account will be available for routing
              </div>
            </div>
            <Toggle
              label=""
              checked={formData.enabled}
              onChange={checked => setFormData({ ...formData, enabled: checked })}
            />
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4">
            <Button onClick={onClose} variant="secondary" disabled={saving} type="button">
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving...' : account ? 'Update' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* OAuth Modal */}
      <OAuthModal
        isOpen={showOAuthModal}
        provider={formData.provider}
        providerName={
          PROVIDERS.find(p => p.value === formData.provider)?.label || formData.provider
        }
        onClose={() => setShowOAuthModal(false)}
        onSuccess={handleOAuthSuccess}
      />
    </>
  );
}
