import { ChevronDown } from 'lucide-react';

import { t } from '@/lib/i18n';
import { Button, FormGrid, Select } from '@/components/ui';
import type { AccountRelationEditorState } from '@/hooks/useIdentityGraphPanel';
import type { GoogleSheetsAccountLinkEdge } from '@/types/googleSheets';

interface AccountRelationsSectionProps {
  accountRelationState: AccountRelationEditorState;
  setAccountRelationState: React.Dispatch<React.SetStateAction<AccountRelationEditorState>>;
  accountOptions: { value: string; label: string }[];
  handleSaveAccountRelation: () => Promise<void>;
  handleDeleteAccountRelation: (accountLinkId: string) => Promise<void>;
  accountLinks: GoogleSheetsAccountLinkEdge[];
  deletingAccountRelationId: string | null;
  savingAccountRelation: boolean;
  connectionReady: boolean;
}

export function AccountRelationsSection({
  accountRelationState,
  setAccountRelationState,
  accountOptions,
  handleSaveAccountRelation,
  handleDeleteAccountRelation,
  accountLinks,
  deletingAccountRelationId,
  savingAccountRelation,
  connectionReady,
}: AccountRelationsSectionProps) {
  return (
    <details className="rounded-xl border border-white/10 bg-ds-surface-overlay/80 overflow-hidden" open={false}>
      <summary className="px-4 py-3 text-sm font-semibold text-white cursor-pointer hover:bg-white/[0.03] transition-colors list-none flex items-center justify-between">
        <span>{t('accounts.accountRelations.title')}</span>
        <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="p-4 space-y-3">
        <FormGrid responsive>
          <Select
            label="From account"
            value={accountRelationState.fromAccount}
            onValueChange={value =>
              setAccountRelationState(prev => ({ ...prev, fromAccount: value }))
            }
            options={accountOptions}
          />
          <Select
            label="To account"
            value={accountRelationState.toAccount}
            onValueChange={value =>
              setAccountRelationState(prev => ({ ...prev, toAccount: value }))
            }
            options={accountOptions}
          />
          <Select
            label="Type"
            value={accountRelationState.linkType}
            onValueChange={value =>
              setAccountRelationState(prev => ({ ...prev, linkType: value }))
            }
            options={[
              { value: 'signup_email', label: 'signup_email' },
              { value: 'oauth_authorizer', label: 'oauth_authorizer' },
              { value: 'recovery_email', label: 'recovery_email' },
              { value: 'same_owner', label: 'same_owner' },
            ]}
          />
          <Select
            label="Status"
            value={accountRelationState.status}
            onValueChange={value =>
              setAccountRelationState(prev => ({ ...prev, status: value }))
            }
            options={[
              { value: 'ok', label: 'ok' },
              { value: 'unknown', label: 'unknown' },
              { value: 'broken', label: 'broken' },
            ]}
          />
        </FormGrid>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleSaveAccountRelation}
            disabled={savingAccountRelation || !connectionReady}
          >
            {savingAccountRelation ? t('common.saving') : t('accounts.accountRelations.save')}
          </Button>
          <span className="text-[11px] text-slate-500">{t('accounts.accountRelations.presets')}: {'signup_email / oauth_authorizer'}</span>
        </div>
        <div className="space-y-1 max-h-44 overflow-auto pr-1">
          {accountLinks.length ? (
            accountLinks.map(link => (
              <div
                key={link.id}
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
              >
                <div className="text-[11px] text-slate-300 truncate">
                  {link.fromProvider}:{link.fromLogin} → {link.toProvider}:{link.toLogin} (
                  {link.relation})
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={deletingAccountRelationId === link.id || !connectionReady}
                  onClick={() => handleDeleteAccountRelation(link.id)}
                >
                  {deletingAccountRelationId === link.id ? t('common.deleting') : t('common.delete')}
                </Button>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-slate-500">{t('accounts.accountRelations.noRows')}</div>
          )}
        </div>
      </div>
    </details>
  );
}
