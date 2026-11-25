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

/** Compact labeled chip for detection facts — replaces the old cramped micro-rows. */
function FactChip({ label, value, mono = true, testId }: {
  label: string;
  value: string;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span
        className={`min-w-0 break-all text-xs text-slate-200 ${mono ? 'font-mono' : ''}`}
        data-testid={testId}
      >
        {value}
      </span>
    </div>
  );
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
  const binaries = detected?.binaries ?? status?.binaries;
  const installed = detected?.source === 'binary' || Boolean(binaries?.opencode || binaries?.opencode2);
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

  // Version badges: when the backend reports per-binary detection, show BOTH
  // binaries (v1 + v2) — this is what makes an installed opencode2 visible.
  // Fall back to the single detected version on older backends.
  const versionBadges: Array<{ key: string; label: string; version: string | null; testId: string }> = [];
  if (binaries && (binaries.opencode || binaries.opencode2)) {
    if (binaries.opencode) {
      versionBadges.push({
        key: 'v1',
        label: t('modelSync.targets.binaries.v1'),
        version: binaries.opencode.version,
        testId: 'opencode-binary-v1-badge',
      });
    }
    if (binaries.opencode2) {
      versionBadges.push({
        key: 'v2',
        label: t('modelSync.targets.binaries.v2'),
        version: binaries.opencode2.version,
        testId: 'opencode-binary-v2-badge',
      });
    }
  } else if (detected?.raw || detected?.version) {
    versionBadges.push({
      key: 'detected',
      label: detected?.version === 'v2' ? t('modelSync.targets.binaries.v2') : t('modelSync.targets.binaries.v1'),
      version: detected.raw || null,
      testId: 'opencode-binary-detected-badge',
    });
  }

  return (
    <GlassCard className="p-5 md:p-6" data-testid="model-sync-opencode-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-300">
            <TerminalSquare size={20} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-100">
              {t('modelSync.targets.opencodeTitle')}
            </h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant={installed ? 'success' : 'warning'} size="sm" withDot>
                {installed ? t('modelSync.targets.installed') : t('modelSync.targets.notInstalled')}
              </Badge>
              {versionBadges.map(badge => (
                <Badge key={badge.key} variant="indigo" size="sm" data-testid={badge.testId}>
                  {badge.label}{badge.version ? ` ${badge.version}` : ''}
                </Badge>
              ))}
              <Badge variant="slate" size="sm">
                {t('modelSync.targets.schema')}: {detected?.version ?? t('modelSync.targets.schemaUnknown')}
              </Badge>
              <Badge
                variant={state === 'in-sync' ? 'success' : state === 'conflict' ? 'danger' : 'warning'}
                size="sm"
                data-testid="opencode-sync-state"
              >
                {stateLabel}
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
        <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/90">
          {t('modelSync.targets.opencodeNotInstalledHint')}
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            {t('modelSync.targets.detectionFacts')}
          </h4>
          <div className="mt-2 flex flex-wrap gap-2">
            <FactChip
              label={t('modelSync.targets.state')}
              value={stateLabel}
              mono={false}
            />
            <FactChip
              label={t('modelSync.targets.credential')}
              value={credentialLabel}
              mono={false}
            />
            {binaries?.opencode?.path ? (
              <FactChip
                label={t('modelSync.targets.binaries.v1')}
                value={binaries.opencode.path}
              />
            ) : null}
            {binaries?.opencode2?.path ? (
              <FactChip
                label={t('modelSync.targets.binaries.v2')}
                value={binaries.opencode2.path}
              />
            ) : null}
          </div>
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5 text-xs">
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
        </div>

        <div className="space-y-3.5">
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

      {(status?.warnings?.length || credentialStatus === 'credential-mismatch') ? (
        <div className="mt-4 space-y-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          {(status?.warnings || []).map(warning => (
            <div key={warning} className="flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
          {credentialStatus === 'credential-mismatch' ? (
            <div className="flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{t('modelSync.targets.credentialHint')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassCard>
  );
}
