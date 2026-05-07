import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button, FormGrid, Select } from '@/components/ui';
import type { AccountAuthLinkEditorState } from '@/hooks/useIdentityGraphPanel';
import type { GoogleSheetsAccountAuthLink, GoogleSheetsAuthMethod } from '@/types/googleSheets';

interface AccountAuthLinksSectionProps {
  accountAuthLinkState: AccountAuthLinkEditorState;
  setAccountAuthLinkState: React.Dispatch<React.SetStateAction<AccountAuthLinkEditorState>>;
  accountOptions: { value: string; label: string }[];
  profileOptions: { value: string; label: string }[];
  authMethods: GoogleSheetsAuthMethod[];
  handleSaveAccountAuthLink: () => Promise<void>;
  handleDeleteAccountAuthLink: (accountAuthLinkId: string) => Promise<void>;
  accountAuthLinks: GoogleSheetsAccountAuthLink[];
  deletingAccountAuthLinkId: string | null;
  savingAccountAuthLink: boolean;
  connectionReady: boolean;
  authMethodById: Map<string, GoogleSheetsAuthMethod>;
}

export function AccountAuthLinksSection({
  accountAuthLinkState,
  setAccountAuthLinkState,
  accountOptions,
  profileOptions,
  authMethods,
  handleSaveAccountAuthLink,
  handleDeleteAccountAuthLink,
  accountAuthLinks,
  deletingAccountAuthLinkId,
  savingAccountAuthLink,
  connectionReady,
  authMethodById,
}: AccountAuthLinksSectionProps) {
  return (
    <details className="rounded-xl border border-white/10 bg-ds-surface-overlay/80 overflow-hidden" open={false}>
      <summary className="px-4 py-3 text-sm font-semibold text-white cursor-pointer hover:bg-white/[0.03] transition-colors list-none flex items-center justify-between">
        <span>Account Auth Links (ACCOUNT_AUTH_LINKS)</span>
        <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="p-4 space-y-3">
        <FormGrid responsive>
          <Select
            label="Account"
            value={accountAuthLinkState.account}
            onValueChange={value =>
              setAccountAuthLinkState(prev => ({ ...prev, account: value }))
            }
            options={accountOptions}
          />
          <Select
            label="Auth method"
            value={accountAuthLinkState.authMethodId}
            onValueChange={value =>
              setAccountAuthLinkState(prev => ({ ...prev, authMethodId: value }))
            }
            options={authMethods.map(method => ({
              value: method.id,
              label: `${method.authType}:${method.provider}:${method.clientName || 'client'}`,
            }))}
          />
          <Select
            label="Channel"
            value={accountAuthLinkState.channel}
            onValueChange={value =>
              setAccountAuthLinkState(prev => ({ ...prev, channel: value }))
            }
            options={[
              { value: 'api', label: 'api' },
              { value: 'browser', label: 'browser' },
              { value: 'cli', label: 'cli' },
            ]}
          />
          <Select
            label="Profile"
            value={accountAuthLinkState.profileAlias}
            onValueChange={value =>
              setAccountAuthLinkState(prev => ({ ...prev, profileAlias: value }))
            }
            options={[{ value: '', label: '(none)' }, ...profileOptions]}
          />
          <Select
            label="Primary"
            value={accountAuthLinkState.isPrimary ? 'yes' : 'no'}
            onValueChange={value =>
              setAccountAuthLinkState(prev => ({ ...prev, isPrimary: value === 'yes' }))
            }
            options={[
              { value: 'yes', label: 'yes' },
              { value: 'no', label: 'no' },
            ]}
          />
        </FormGrid>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleSaveAccountAuthLink}
            disabled={savingAccountAuthLink || !connectionReady}
          >
            {savingAccountAuthLink ? 'Saving…' : 'Save account auth link'}
          </Button>
          <span className="text-[11px] text-slate-500">
            Use channel=browser for CODEX browser auth.
          </span>
        </div>
        <div className="space-y-1 max-h-44 overflow-auto pr-1">
          {accountAuthLinks.length ? (
            accountAuthLinks.map(link => (
              <div
                key={link.id}
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-slate-300 truncate">
                    {link.accountProvider}:{link.accountLogin} →{' '}
                    {authMethodById.get(link.authMethodId)?.authType || 'auth'}:
                    {authMethodById.get(link.authMethodId)?.provider || 'provider'}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                        link.channel === 'browser'
                          ? 'bg-blue-500/20 text-blue-200 border border-blue-500/40'
                          : link.channel === 'api'
                            ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                            : 'bg-slate-500/20 text-slate-200 border border-slate-500/40'
                      )}
                    >
                      {link.channel || 'channel'}
                    </span>
                    {link.isPrimary ? (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                        PRIMARY
                      </span>
                    ) : null}
                    {link.profileAlias ? (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-violet-200 bg-violet-500/20 border border-violet-500/40">
                        profile:{link.profileAlias}
                      </span>
                    ) : null}
                    {link.clientName ? (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-slate-300 bg-slate-500/20 border border-slate-500/30">
                        {link.clientName}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={deletingAccountAuthLinkId === link.id || !connectionReady}
                  onClick={() => handleDeleteAccountAuthLink(link.id)}
                >
                  {deletingAccountAuthLinkId === link.id ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-slate-500">No ACCOUNT_AUTH_LINKS rows yet.</div>
          )}
        </div>
      </div>
    </details>
  );
}
