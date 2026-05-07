import { ChevronDown } from 'lucide-react';

import { Button, FormGrid, Select } from '@/components/ui';
import type { AuthMethodEditorState } from '@/hooks/useIdentityGraphPanel';
import type { GoogleSheetsAuthMethod } from '@/types/googleSheets';

interface AuthMethodsSectionProps {
  authMethodState: AuthMethodEditorState;
  setAuthMethodState: React.Dispatch<React.SetStateAction<AuthMethodEditorState>>;
  accountOptions: { value: string; label: string }[];
  handleSaveAuthMethod: () => Promise<void>;
  handleDeleteAuthMethod: (authMethodId: string) => Promise<void>;
  authMethods: GoogleSheetsAuthMethod[];
  deletingAuthMethodId: string | null;
  savingAuthMethod: boolean;
  connectionReady: boolean;
  applyCodexApiPreset: () => void;
  applyCodexBrowserPreset: () => void;
  applyQuickFillFromActiveIdentity: () => void;
}

export function AuthMethodsSection({
  authMethodState,
  setAuthMethodState,
  accountOptions,
  handleSaveAuthMethod,
  handleDeleteAuthMethod,
  authMethods,
  deletingAuthMethodId,
  savingAuthMethod,
  connectionReady,
  applyCodexApiPreset,
  applyCodexBrowserPreset,
  applyQuickFillFromActiveIdentity,
}: AuthMethodsSectionProps) {
  return (
    <details className="rounded-xl border border-white/10 bg-ds-surface-overlay/80 overflow-hidden" open={false}>
      <summary className="px-4 py-3 text-sm font-semibold text-white cursor-pointer hover:bg-white/[0.03] transition-colors list-none flex items-center justify-between">
        <span>Auth Methods (AUTH_METHODS)</span>
        <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="secondary" onClick={applyCodexApiPreset}>
            Preset: CODEX API
          </Button>
          <Button size="xs" variant="secondary" onClick={applyCodexBrowserPreset}>
            Preset: CODEX Browser
          </Button>
          <Button size="xs" variant="ghost" onClick={applyQuickFillFromActiveIdentity}>
            Quick fill from selected identity
          </Button>
        </div>
        <FormGrid responsive>
          <Select
            label="Auth type"
            value={authMethodState.authType}
            onValueChange={value =>
              setAuthMethodState(prev => ({ ...prev, authType: value }))
            }
            options={[
              { value: 'api_key', label: 'api_key' },
              { value: 'browser_session', label: 'browser_session' },
              { value: 'oauth_token', label: 'oauth_token' },
              { value: 'device_flow', label: 'device_flow' },
            ]}
          />
          <Select
            label="Provider"
            value={authMethodState.provider}
            onValueChange={value =>
              setAuthMethodState(prev => ({ ...prev, provider: value }))
            }
            options={[
              { value: 'openai', label: 'openai' },
              { value: 'github', label: 'github' },
              { value: 'aws', label: 'aws' },
              { value: 'google', label: 'google' },
              { value: 'anthropic', label: 'anthropic' },
            ]}
          />
          <Select
            label="Principal account"
            value={authMethodState.principalAccount}
            onValueChange={value =>
              setAuthMethodState(prev => ({ ...prev, principalAccount: value }))
            }
            options={accountOptions}
          />
          <Select
            label="Client"
            value={authMethodState.clientName}
            onValueChange={value =>
              setAuthMethodState(prev => ({ ...prev, clientName: value }))
            }
            options={[
              { value: 'codex_cli', label: 'codex_cli' },
              { value: 'browser', label: 'browser' },
              { value: 'openai_sdk', label: 'openai_sdk' },
            ]}
          />
        </FormGrid>
        <FormGrid responsive>
          <input
            className="h-9 rounded-md border border-white/10 bg-black/30 px-3 text-xs text-white"
            value={authMethodState.secretRef}
            onChange={event =>
              setAuthMethodState(prev => ({ ...prev, secretRef: event.target.value }))
            }
            placeholder="secret_ref (never raw key)"
          />
          <input
            className="h-9 rounded-md border border-white/10 bg-black/30 px-3 text-xs text-white"
            value={authMethodState.keyFingerprint}
            onChange={event =>
              setAuthMethodState(prev => ({ ...prev, keyFingerprint: event.target.value }))
            }
            placeholder="key_fingerprint"
          />
        </FormGrid>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleSaveAuthMethod}
            disabled={savingAuthMethod || !connectionReady}
          >
            {savingAuthMethod ? 'Saving…' : 'Save auth method'}
          </Button>
          <span className="text-[11px] text-slate-500">
            Store secret references only, never raw API keys.
          </span>
        </div>
        <div className="space-y-1 max-h-44 overflow-auto pr-1">
          {authMethods.length ? (
            authMethods.map(method => (
              <div
                key={method.id}
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
              >
                <div className="text-[11px] text-slate-300 truncate">
                  {method.authType} • {method.provider} • {method.clientName || 'client'} •{' '}
                  {method.keyFingerprint || 'no-fingerprint'}
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={deletingAuthMethodId === method.id || !connectionReady}
                  onClick={() => handleDeleteAuthMethod(method.id)}
                >
                  {deletingAuthMethodId === method.id ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-slate-500">No AUTH_METHODS rows yet.</div>
          )}
        </div>
      </div>
    </details>
  );
}
