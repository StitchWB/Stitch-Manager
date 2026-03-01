import { Globe, PlayCircle, Trash2, Settings } from 'lucide-react';
import { useState } from 'react';
import { t } from '../lib/i18n';
import { Button, EmptyState, Input, Select } from './ui';
import { LayoutGrid } from 'lucide-react';
import { ScenarioRecordModal } from './scenarioRecorder/ScenarioRecordModal';
import { ScenarioReplayModal } from './scenarioRecorder/ScenarioReplayModal';

export interface ProfileItem {
  alias: string;
  linkedAccountEmail: string | null;
  linkedProvider?: string | null;
  linkedAccountId?: number | null;
  usedForKiro?: boolean;
  usedTargets?: string[];
  healthStatus?: 'ready' | 'needs_aws_link' | 'no_session_path';
}

interface ProfilesTableProps {
  profiles: ProfileItem[];
  onOpen: (alias: string, target: string, customUrl?: string) => Promise<void>;
  onEdit: (alias: string) => void;
  onStartAutoreg: (
    alias: string,
    targetProvider: string,
    preset?: 'kiro_via_aws_session',
    awsBootstrapAccountId?: number
  ) => void;
  onDelete: (alias: string) => Promise<void>;
  profileFilter: 'all' | 'standalone' | 'linked' | 'used_kiro';
  onProfileFilterChange: (value: 'all' | 'standalone' | 'linked' | 'used_kiro') => void;
}

export default function ProfilesTable({
  profiles,
  onOpen,
  onEdit,
  onStartAutoreg,
  onDelete,
  profileFilter,
  onProfileFilterChange,
}: ProfilesTableProps) {
  const [openTarget, setOpenTarget] = useState<string>('kiro');
  const [customUrl, setCustomUrl] = useState('');
  const [recordAlias, setRecordAlias] = useState<string | null>(null);
  const [replayAlias, setReplayAlias] = useState<string | null>(null);
  const canEdit = typeof onEdit === 'function';

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('accounts.noProfilesFound')}
        description={t('accounts.noProfilesFoundDesc')}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden px-2 sm:px-4">
      <div className="hidden lg:grid grid-cols-[minmax(320px,1fr)_180px_auto] gap-4 py-3 px-4 border-b border-white/5 sticky top-0 bg-[#050508]/95 backdrop-blur-md z-40">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          {t('accounts.profileAlias')}
        </span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
          {t('accounts.profileKind')}
        </span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right pr-4">
          {t('common.actions')}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-white/5 bg-[#0b0d12]/60">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] leading-4 uppercase tracking-widest text-slate-500">
            {t('accounts.profilesFilterLabel')}
          </span>
          <Select
            value={profileFilter}
            onChange={e =>
              onProfileFilterChange(e.target.value as 'all' | 'standalone' | 'linked' | 'used_kiro')
            }
            className="h-8 py-1 text-xs"
          >
            <option value="all">{t('accounts.profilesFilterAll')}</option>
            <option value="standalone">{t('accounts.profilesFilterStandalone')}</option>
            <option value="linked">{t('accounts.profilesFilterLinked')}</option>
            <option value="used_kiro">{t('accounts.profilesFilterUsedForKiro')}</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] leading-4 uppercase tracking-widest text-slate-500">
            {t('accounts.profileDestinationLabel')}
          </span>
          <Select
            value={openTarget}
            onChange={e => setOpenTarget(e.target.value)}
            className="h-8 py-1 text-xs"
          >
            <option value="kiro">Kiro</option>
            <option value="windsurf">Windsurf</option>
            <option value="trae">Trae</option>
            <option value="github">GitHub</option>
            <option value="custom">{t('accounts.profileDestinationCustom')}</option>
          </Select>
        </div>

        {openTarget === 'custom' && (
          <div className="flex flex-col gap-1 min-w-[260px] flex-1">
            <span className="text-[10px] leading-4 uppercase tracking-widest text-slate-500">
              URL
            </span>
            <Input
              type="text"
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              placeholder={t('accounts.profileOpenUrlPlaceholder')}
              className="h-8 py-1 text-xs"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 pb-8 pt-2 space-y-1.5">
        {profiles.map(profile => {
          const isLinked = Boolean(profile.linkedAccountEmail);

          return (
            <div
              key={profile.alias}
              className="relative rounded-xl border bg-[#0f1115]/60 border-white/[0.03] hover:border-white/[0.08] hover:bg-[#161920] transition-all duration-200 overflow-hidden"
            >
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,1fr)_180px_auto] gap-4 items-center px-4 py-3.5">
                <div className="flex flex-col min-w-0">
                  <span className="text-sm leading-5 font-bold text-slate-100 truncate">
                    {profile.alias}
                  </span>
                  {profile.linkedAccountEmail && (
                    <span className="text-[11px] text-slate-400 truncate">
                      {profile.linkedAccountEmail}
                    </span>
                  )}
                  {!!profile.usedTargets?.length && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {profile.usedTargets.slice(0, 3).map(target => (
                        <span
                          key={`${profile.alias}-${target}`}
                          className="px-1.5 py-0.5 text-[10px] rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                        >
                          {target}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex lg:justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${
                        isLinked
                          ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                          : 'bg-white/5 text-slate-300 border-white/10'
                      }`}
                    >
                      {isLinked
                        ? t('accounts.profileKindLinked')
                        : t('accounts.profileKindStandalone')}
                    </span>

                    {profile.healthStatus && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide border ${
                          profile.healthStatus === 'ready'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                            : profile.healthStatus === 'needs_aws_link'
                              ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                        }`}
                      >
                        {profile.healthStatus === 'ready'
                          ? t('accounts.profileHealthReady')
                          : profile.healthStatus === 'needs_aws_link'
                            ? t('accounts.profileHealthNeedsAws')
                            : t('accounts.profileHealthNoSession')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-t lg:border-t-0 border-white/5 pt-2 lg:pt-0 min-w-0">
                  {canEdit ? (
                    <Button
                      size="xs"
                      variant="secondary"
                      leftIcon={<Settings size={12} />}
                      onClick={() => onEdit(profile.alias)}
                    >
                      {t('common.settings')}
                    </Button>
                  ) : null}
                  <Button
                    size="xs"
                    variant="secondary"
                    leftIcon={<PlayCircle size={12} />}
                    onClick={() => {
                      const targetProvider = openTarget === 'custom' ? 'kiro' : openTarget;
                      onStartAutoreg(profile.alias, targetProvider);
                    }}
                  >
                    {t('accounts.startAutoregFromProfile')}
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    className="pl-3"
                    onClick={() => {
                      onStartAutoreg(
                        profile.alias,
                        'kiro',
                        'kiro_via_aws_session',
                        profile.linkedProvider === 'aws' ||
                          profile.linkedProvider === 'aws_builder_id'
                          ? (profile.linkedAccountId ?? undefined)
                          : undefined
                      );
                    }}
                  >
                    {t('accounts.startAutoregKiroViaAws')}
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    leftIcon={<Globe size={12} />}
                    onClick={() => {
                      void onOpen(profile.alias, openTarget, customUrl);
                    }}
                  >
                    {t('accounts.openProfileAt')}
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setRecordAlias(profile.alias)}
                  >
                    {t('common.record') || 'Record'}
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setReplayAlias(profile.alias)}
                  >
                    {t('common.replay') || 'Replay'}
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    leftIcon={<Trash2 size={12} />}
                    onClick={() => {
                      void onDelete(profile.alias);
                    }}
                  >
                    {t('accounts.deleteProfile')}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ScenarioRecordModal
        alias={recordAlias}
        isOpen={Boolean(recordAlias)}
        onClose={() => setRecordAlias(null)}
        defaultUrl={openTarget === 'custom' ? customUrl : undefined}
      />

      <ScenarioReplayModal
        alias={replayAlias}
        isOpen={Boolean(replayAlias)}
        onClose={() => setReplayAlias(null)}
        defaultUrl={openTarget === 'custom' ? customUrl : undefined}
      />
    </div>
  );
}
