import { FileSliders, FolderGit2 } from 'lucide-react';

import { Badge, Checkbox, GlassCard, Select } from '@/components/ui';
import {
  OMP_EFFORTS,
  OMP_ROLES,
  type ModelSyncCatalogModel,
  type ModelSyncOmpEffort,
  type ModelSyncOmpProfile,
} from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

export interface OmpRoleSelection {
  model: string;
  effort: '' | ModelSyncOmpEffort;
}

interface OmpTargetCardProps {
  profiles: ModelSyncOmpProfile[];
  profileHint: string | null;
  binaryPath: string | null;
  binaryVersion: string | null;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  selectedProfile: string;
  onSelectedProfileChange: (profile: string) => void;
  roleSelections: Record<string, OmpRoleSelection>;
  onRoleSelectionsChange: (roles: Record<string, OmpRoleSelection>) => void;
  pruneUnselected: boolean;
  onPruneUnselectedChange: (value: boolean) => void;
  ensureEnabled: boolean;
  onEnsureEnabledChange: (value: boolean) => void;
  selectedModels: ModelSyncCatalogModel[];
}

export function OmpTargetCard({
  profiles,
  profileHint,
  binaryPath,
  binaryVersion,
  enabled,
  onEnabledChange,
  selectedProfile,
  onSelectedProfileChange,
  roleSelections,
  onRoleSelectionsChange,
  pruneUnselected,
  onPruneUnselectedChange,
  ensureEnabled,
  onEnsureEnabledChange,
  selectedModels,
}: OmpTargetCardProps) {
  const activeProfile =
    profiles.find(profile => profile.name === selectedProfile) ||
    profiles.find(profile => profile.isDefault) ||
    profiles[0];
  const installed = profiles.some(profile => profile.exists);

  const updateRole = (role: string, patch: Partial<OmpRoleSelection>) => {
    onRoleSelectionsChange({
      ...roleSelections,
      [role]: {
        model: roleSelections[role]?.model || '',
        effort: roleSelections[role]?.effort || '',
        ...patch,
      },
    });
  };

  const modelOptions = [
    { value: '', label: t('modelSync.targets.noRoleChange') },
    ...selectedModels.map(model => ({ value: model.id, label: `${model.name} (${model.id})` })),
  ];
  const effortOptions = [
    { value: '', label: t('modelSync.targets.noEffort') },
    ...OMP_EFFORTS.map(effort => ({
      value: effort,
      label: t(`modelSync.targets.efforts.${effort}`),
    })),
  ];

  return (
    <GlassCard className="p-4" data-testid="model-sync-omp-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500/10 text-teal-300">
            <FolderGit2 size={17} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              {t('modelSync.targets.ompTitle')}
            </h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant={installed ? 'success' : 'warning'} size="sm">
                {installed ? t('modelSync.targets.installed') : t('modelSync.targets.notInstalled')}
              </Badge>
              {activeProfile ? (
                <Badge variant="slate" size="sm">
                  {activeProfile.name}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <Checkbox
          checked={enabled}
          onChange={event => onEnabledChange(event.target.checked)}
          label={t('modelSync.targets.include')}
          data-testid="model-sync-omp-enabled"
        />
      </div>

      {!installed ? (
        <p className="mt-3 text-[11px] text-amber-300/90">
          {t('modelSync.targets.ompNotInstalledHint')}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="space-y-2 text-xs">
          <div>
            <div className="text-slate-500">{t('modelSync.targets.binary')}</div>
            <div className="mt-0.5 break-all font-mono text-slate-200" data-testid="omp-binary-path">
              {binaryPath || t('modelSync.targets.notReported')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('modelSync.targets.version')}</div>
            <div className="mt-0.5 font-mono text-slate-200" data-testid="omp-binary-version">
              {binaryVersion || t('modelSync.targets.notReported')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('modelSync.targets.modelsPath')}</div>
            <div className="mt-0.5 break-all font-mono text-slate-200">
              {activeProfile?.modelsPath || '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('modelSync.targets.configYmlPath')}</div>
            <div className="mt-0.5 break-all font-mono text-slate-200">
              {activeProfile?.configPath || '—'}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <Select
            label={t('modelSync.targets.profile')}
            value={activeProfile?.name || selectedProfile || 'default'}
            onValueChange={onSelectedProfileChange}
            options={profiles.map(profile => ({
              value: profile.name,
              label: profile.isDefault ? `${profile.name} (${t('modelSync.targets.roles.default')})` : profile.name,
            }))}
            data-testid="omp-profile-select"
          />
          {profileHint ? (
            <p className="-mt-1 text-[11px] text-slate-500">
              {t('modelSync.targets.profileHint', { profile: profileHint })}
            </p>
          ) : null}
          <div className="space-y-1">
            <Checkbox
              checked={pruneUnselected}
              onChange={event => onPruneUnselectedChange(event.target.checked)}
              label={t('modelSync.targets.pruneUnselected')}
              description={t('modelSync.targets.pruneUnselectedHint')}
              data-testid="omp-prune-unselected"
            />
            <Checkbox
              checked={ensureEnabled}
              onChange={event => onEnsureEnabledChange(event.target.checked)}
              label={t('modelSync.targets.ensureEnabled')}
              description={t('modelSync.targets.ensureEnabledHint')}
              data-testid="omp-ensure-enabled"
            />
          </div>
        </div>
      </div>

      {activeProfile?.parseError ? (
        <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-2 text-[11px] text-red-300">
          {activeProfile.parseError}
        </p>
      ) : null}

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <FileSliders size={13} />
          {t('modelSync.targets.rolesTitle')}
        </h4>
        <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {OMP_ROLES.map(role => {
            const selection = roleSelections[role] || { model: '', effort: '' };
            return (
              <div key={role} className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
                <div className="grid grid-cols-[1fr_112px] gap-2">
                  <Select
                    label={t(`modelSync.targets.roles.${role}`)}
                    value={selection.model}
                    onValueChange={value => updateRole(role, { model: value })}
                    options={modelOptions}
                    data-testid={`omp-role-${role}`}
                  />
                  <Select
                    label={t('modelSync.targets.effort')}
                    value={selection.effort}
                    onValueChange={value =>
                      updateRole(role, { effort: value as '' | ModelSyncOmpEffort })
                    }
                    disabled={!selection.model}
                    options={effortOptions}
                    data-testid={`omp-effort-${role}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <details className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs text-slate-400">
          <summary className="cursor-pointer select-none font-medium text-slate-300">
            {t('modelSync.targets.advancedFallbacks')}
          </summary>
          <p className="mt-2 leading-5">{t('modelSync.targets.advancedFallbacksHint')}</p>
        </details>
      </div>
    </GlassCard>
  );
}
