import { AlertTriangle, FileJson, TerminalSquare } from 'lucide-react';

import { Badge, Checkbox, GlassCard, Select } from '@/components/ui';
import type {
  ModelSyncCatalogModel,
  ModelSyncOpenCodeStatus,
  ModelSyncSchemaOverride,
} from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

interface OpenCodeTargetCardProps {
  status: ModelSyncOpenCodeStatus | undefined;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  schemaOverride: ModelSyncSchemaOverride;
  onSchemaOverrideChange: (schema: ModelSyncSchemaOverride) => void;
  defaultModel: string;
  onDefaultModelChange: (value: string) => void;
  smallModel: string;
  onSmallModelChange: (value: string) => void;
  pruneUnselected: boolean;
  onPruneUnselectedChange: (value: boolean) => void;
  selectedModels: ModelSyncCatalogModel[];
  conflictPaths?: Set<string>;
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every(value => rightSet.has(value));
}

export function resolvedOpenCodeSchema(
  detected: ModelSyncOpenCodeStatus['detectedVersion'] | undefined,
  override: ModelSyncSchemaOverride,
): 'v1' | 'v2' {
  if (override === 'v1' || override === 'v2') return override;
  return detected?.version === 'v2' ? 'v2' : 'v1';
}

export function OpenCodeTargetCard({
  status,
  enabled,
  onEnabledChange,
  schemaOverride,
  onSchemaOverrideChange,
  defaultModel,
  onDefaultModelChange,
  smallModel,
  onSmallModelChange,
  pruneUnselected,
  onPruneUnselectedChange,
  selectedModels,
  conflictPaths,
}: OpenCodeTargetCardProps) {
  const detected = status?.detectedVersion;
  const effectiveSchema = resolvedOpenCodeSchema(detected, schemaOverride);
  const installed = detected?.source === 'binary';
  const selectedIds = selectedModels.map(model => model.id);
  const writePaths = [status?.writeTarget, status?.secondaryPath].filter(
    (value): value is string => Boolean(value),
  );
  const hasConflict = Boolean(
    conflictPaths && writePaths.some(path => conflictPaths.has(path)),
  );
  const state = !status?.writeTargetExists
    ? 'missing'
    : hasConflict
      ? 'conflict'
      : sameMembers(status.stitchModels || [], selectedIds)
        ? 'in-sync'
        : 'stale';
  const stateLabel =
    state === 'missing'
      ? t('modelSync.targets.stateMissing')
      : state === 'in-sync'
        ? t('modelSync.targets.stateInSync')
        : state === 'conflict'
          ? t('modelSync.targets.stateConflict')
          : t('modelSync.targets.stateStale');
  const credentialStatus = status?.credential?.status;
  const credentialLabel =
    credentialStatus === 'credential-match'
      ? t('modelSync.targets.credentialStatuses.match')
      : credentialStatus === 'credential-mismatch'
        ? t('modelSync.targets.credentialStatuses.mismatch')
        : credentialStatus === 'no-credential'
          ? t('modelSync.targets.credentialStatuses.none')
          : credentialStatus === 'no-database'
            ? t('modelSync.targets.credentialStatuses.noDatabase')
            : t('modelSync.targets.credentialStatuses.unknown');

  const modelOptions = [
    { value: '', label: t('modelSync.targets.automatic') },
    ...selectedModels.map(model => ({
      value: `stitch/${model.id}`,
      label: `${model.name} (${model.id})`,
    })),
  ];

  return (
    <GlassCard className="p-4" data-testid="model-sync-opencode-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-300">
            <TerminalSquare size={17} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              {t('modelSync.targets.opencodeTitle')}
            </h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant={installed ? 'success' : 'warning'} size="sm">
                {installed ? t('modelSync.targets.installed') : t('modelSync.targets.notInstalled')}
              </Badge>
              <Badge variant="slate" size="sm">
                {t('modelSync.targets.schema')}: {detected?.version ?? t('modelSync.targets.schemaUnknown')}
              </Badge>
            </div>
          </div>
        </div>
        <Checkbox
          checked={enabled}
          onChange={event => onEnabledChange(event.target.checked)}
          label={t('modelSync.targets.include')}
          data-testid="model-sync-opencode-enabled"
        />
      </div>

      {!installed ? (
        <p className="mt-3 text-[11px] text-amber-300/90">
          {t('modelSync.targets.opencodeNotInstalledHint')}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="space-y-2 text-xs">
          <div>
            <div className="text-slate-500">{t('modelSync.targets.binary')}</div>
            <div className="mt-0.5 font-mono text-slate-200">
              {installed ? 'opencode' : t('modelSync.targets.notReported')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('modelSync.targets.version')}</div>
            <div className="mt-0.5 font-mono text-slate-200">
              {detected?.raw || detected?.version || t('modelSync.targets.notReported')}
            </div>
          </div>
          <div>
            <div className="text-slate-500">{t('modelSync.targets.state')}</div>
            <Badge
              variant={state === 'in-sync' ? 'success' : state === 'conflict' ? 'danger' : 'warning'}
              size="sm"
              className="mt-1"
              data-testid="opencode-sync-state"
            >
              {stateLabel}
            </Badge>
          </div>
          <div>
            <div className="text-slate-500">{t('modelSync.targets.credential')}</div>
            <div className="mt-0.5 text-slate-200">{credentialLabel}</div>
          </div>
        </div>

        <div className="space-y-3">
          <Select
            label={t('modelSync.targets.schema')}
            value={schemaOverride}
            onValueChange={value => onSchemaOverrideChange(value as ModelSyncSchemaOverride)}
            options={[
              { value: 'auto', label: t('modelSync.targets.schemaAuto') },
              { value: 'v1', label: t('modelSync.targets.schemaV1') },
              { value: 'v2', label: t('modelSync.targets.schemaV2') },
            ]}
          />
          <Select
            label={t('modelSync.targets.defaultModel')}
            value={defaultModel}
            onValueChange={onDefaultModelChange}
            options={modelOptions}
          />
          <Select
            label={t('modelSync.targets.smallModel')}
            value={smallModel}
            onValueChange={onSmallModelChange}
            disabled={effectiveSchema === 'v2'}
            hint={
              effectiveSchema === 'v2'
                ? t('modelSync.targets.smallModelV2Disabled')
                : t('modelSync.targets.smallModelHint')
            }
            options={modelOptions}
            data-testid="opencode-small-model-select"
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs">
        <div className="flex items-start gap-2">
          <FileJson size={14} className="mt-0.5 shrink-0 text-slate-500" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div>
              <span className="text-slate-500">{t('modelSync.targets.configPath')}: </span>
              <span className="break-all font-mono text-slate-200">{status?.writeTarget || '—'}</span>
            </div>
            {status?.secondaryPath ? (
              <div>
                <span className="text-slate-500">{t('modelSync.targets.secondaryPath')}: </span>
                <span className="break-all font-mono text-slate-200">{status.secondaryPath}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3">
        <Checkbox
          checked={pruneUnselected}
          onChange={event => onPruneUnselectedChange(event.target.checked)}
          label={t('modelSync.targets.pruneUnselected')}
          description={t('modelSync.targets.pruneUnselectedHint')}
          data-testid="opencode-prune-unselected"
        />
      </div>

      {(status?.warnings?.length || credentialStatus === 'credential-mismatch') ? (
        <div className="mt-3 space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          {(status?.warnings || []).map(warning => (
            <div key={warning} className="flex items-start gap-2 text-[11px] text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
          {credentialStatus === 'credential-mismatch' ? (
            <div className="flex items-start gap-2 text-[11px] text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{t('modelSync.targets.credentialHint')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
