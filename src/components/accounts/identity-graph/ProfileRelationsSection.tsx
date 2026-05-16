import { ChevronDown } from 'lucide-react';

import { t } from '@/lib/i18n';
import { Button, FormGrid, Select } from '@/components/ui';
import type { ProfileRelationEditorState } from '@/hooks/useIdentityGraphPanel';
import type { GoogleSheetsProfileLinkEdge } from '@/types/googleSheets';

interface ProfileRelationsSectionProps {
  profileRelationState: ProfileRelationEditorState;
  setProfileRelationState: React.Dispatch<React.SetStateAction<ProfileRelationEditorState>>;
  profileOptions: { value: string; label: string }[];
  accountOptions: { value: string; label: string }[];
  handleSaveProfileRelation: () => Promise<void>;
  handleDeleteProfileRelation: (profileLinkId: string) => Promise<void>;
  profileLinks: GoogleSheetsProfileLinkEdge[];
  deletingProfileRelationId: string | null;
  savingProfileRelation: boolean;
  connectionReady: boolean;
}

export function ProfileRelationsSection({
  profileRelationState,
  setProfileRelationState,
  profileOptions,
  accountOptions,
  handleSaveProfileRelation,
  handleDeleteProfileRelation,
  profileLinks,
  deletingProfileRelationId,
  savingProfileRelation,
  connectionReady,
}: ProfileRelationsSectionProps) {
  return (
    <details className="rounded-xl border border-white/10 bg-ds-surface-overlay/80 overflow-hidden" open={false}>
      <summary className="px-4 py-3 text-sm font-semibold text-white cursor-pointer hover:bg-white/[0.03] transition-colors list-none flex items-center justify-between">
        <span>{t('accounts.profileRelations.title')}</span>
        <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="p-4 space-y-3">
        <FormGrid responsive>
          <Select
            label="Profile alias"
            value={profileRelationState.profileAlias}
            onValueChange={value =>
              setProfileRelationState(prev => ({ ...prev, profileAlias: value }))
            }
            options={profileOptions}
          />
          <Select
            label="Account"
            value={profileRelationState.account}
            onValueChange={value =>
              setProfileRelationState(prev => ({ ...prev, account: value }))
            }
            options={accountOptions}
          />
          <Select
            label="Relation"
            value={profileRelationState.relationType}
            onValueChange={value =>
              setProfileRelationState(prev => ({ ...prev, relationType: value }))
            }
            options={[
              { value: 'login', label: 'login' },
              { value: 'signup', label: 'signup' },
              { value: 'recovery', label: 'recovery' },
            ]}
          />
          <Select
            label="Status"
            value={profileRelationState.status}
            onValueChange={value =>
              setProfileRelationState(prev => ({ ...prev, status: value }))
            }
            options={[
              { value: 'active', label: 'active' },
              { value: 'inactive', label: 'inactive' },
              { value: 'deleted', label: 'deleted' },
            ]}
          />
        </FormGrid>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleSaveProfileRelation}
            disabled={savingProfileRelation || !connectionReady}
          >
            {savingProfileRelation ? t('common.saving') : t('accounts.profileRelations.save')}
          </Button>
          <span className="text-[11px] text-slate-500">{t('accounts.profileRelations.presets')}: {'login / signup / recovery'}</span>
        </div>
        <div className="space-y-1 max-h-44 overflow-auto pr-1">
          {profileLinks.length ? (
            profileLinks.map(link => (
              <div
                key={link.id}
                className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
              >
                <div className="text-[11px] text-slate-300 truncate">
                  {link.profileAlias} → {link.accountProvider}:{link.accountLogin} (
                  {link.relation})
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={deletingProfileRelationId === link.id || !connectionReady}
                  onClick={() => handleDeleteProfileRelation(link.id)}
                >
                  {deletingProfileRelationId === link.id ? t('common.deleting') : t('common.delete')}
                </Button>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-slate-500">{t('accounts.profileRelations.noRows')}</div>
          )}
        </div>
      </div>
    </details>
  );
}
