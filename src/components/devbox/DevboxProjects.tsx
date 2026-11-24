import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, FolderCog, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { KeyValueList, type KeyValueRow } from '@/components/ui/KeyValueList';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  devboxProfileDelete,
  devboxProfileGet,
  devboxProfileUse,
  devboxStackStart,
  type DevboxAccepted,
  type DevboxProfileRow,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { DevboxProfiles } from './DevboxProfiles';
import { devboxModeLabel } from './labels';
import { stackVitalState } from './state';
import type { UseDevboxConnectResult } from './useDevboxConnect';

const ENV_KEYS = [
  'INGRESS_MODE',
  'JOB_TIMEOUT_SECONDS',
  'EGRESS_CONTAINER',
  'OPENCODE_MCP_PERMISSIONS',
] as const;

interface DetailState {
  requestKey: string;
  json: string;
  model: Record<string, unknown> | null;
  error: string | null;
}

function parseRecord(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export interface DevboxProjectsProps {
  connect: UseDevboxConnectResult;
  profiles: DevboxProfileRow[] | null;
  overviewCards: DevboxVitalCard[] | null;
  error: string | null;
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
  onRetry: () => void;
  onChanged: () => void;
  onStarted: () => void;
  onCreate: () => void;
  addSignal: number;
  seedSignal: number;
}

export function DevboxProjects({
  connect,
  profiles,
  overviewCards,
  error,
  busy,
  onAction,
  onRetry,
  onChanged,
  onStarted,
  onCreate,
  addSignal,
  seedSignal,
}: DevboxProjectsProps) {
  const rows = useMemo(() => (Array.isArray(profiles) ? profiles : []), [profiles]);
  const activeRow = rows.find(row => row.active) ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const selectedName =
    selected !== null && rows.some(row => row.name === selected)
      ? selected
      : activeRow?.name ?? rows[0]?.name ?? '';
  const [loadTick, setLoadTick] = useState(0);
  const [editSignal, setEditSignal] = useState(0);
  const [editName, setEditName] = useState('');
  const requestKey = `${selectedName}:${loadTick}`;
  const [detail, setDetail] = useState<DetailState>({
    requestKey: '',
    json: '',
    model: null,
    error: null,
  });

  useEffect(() => {
    if (selectedName === '') return;
    let cancelled = false;
    devboxProfileGet(selectedName)
      .then(result => {
        if (cancelled) return;
        setDetail({
          requestKey,
          json: result.json,
          model: parseRecord(result.json),
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetail({
          requestKey,
          json: '',
          model: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedName, profiles, requestKey]);

  const detailLoading = selectedName !== '' && detail.requestKey !== requestKey;

  const [dupSignal, setDupSignal] = useState(0);
  const [dupName, setDupName] = useState('');

  const openEditor = useCallback((name: string) => {
    setEditName(name);
    setEditSignal(signal => signal + 1);
  }, []);

  const duplicateProfile = useCallback((name: string) => {
    setDupName(name);
    setDupSignal(signal => signal + 1);
  }, []);

  const deleteProfile = useCallback(
    async (name: string) => {
      try {
        await devboxProfileDelete(name);
        appToast.success(t('devboxPage.profileDeleted'));
        onChanged();
      } catch (err) {
        appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
      }
    },
    [onChanged],
  );

  const stackState = stackVitalState(overviewCards);
  const stackRunning = stackState === 'healthy' || stackState === 'degraded';

  const selectedRow = rows.find(row => row.name === selectedName) ?? null;
  const model = detail.model;
  const summaryRows: KeyValueRow[] = selectedName === ''
    ? []
    : [
        {
          id: 'folder',
          label: t('devboxPage.projectsSummaryFolder'),
          value: stringValue(model?.project_dir) || selectedRow?.project_dir || '—',
        },
        {
          id: 'mode',
          label: t('devboxPage.projectsSummaryMode'),
          value: devboxModeLabel(stringValue(model?.mode) || selectedRow?.mode || ''),
        },
        {
          id: 'toolchain',
          label: t('devboxPage.projectsSummaryToolchain'),
          value: stringValue(model?.toolchain) || '—',
        },
        {
          id: 'ports',
          label: t('devboxPage.projectsSummaryPorts'),
          value: t('devboxPage.projectsSummaryRules', {
            count: listLength(model?.allowed_ports) + listLength(model?.port_ranges),
          }),
        },
        {
          id: 'hidden',
          label: t('devboxPage.projectsSummaryHidden'),
          value: t('devboxPage.projectsSummaryItems', { count: listLength(model?.deny_mounts) }),
        },
        {
          id: 'mcp',
          label: t('devboxPage.projectsSummaryMcp'),
          value: t('devboxPage.projectsSummaryItems', { count: listLength(model?.exposed_mcps) }),
        },
      ];

  const envRows = connect.entries.filter(entry =>
    (ENV_KEYS as readonly string[]).includes(entry.key),
  );
  const previewOrigin = stringValue(model?.preview_origin);
  const toolchain = stringValue(model?.toolchain);

  return (
    <div className="flex flex-col gap-4" data-testid="devbox-projects">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{t('devboxPage.projectsTitle')}</h3>
          <p className="text-2xs text-slate-400">{t('devboxPage.profilesCaption')}</p>
        </div>
        <Button
          size="xs"
          variant="secondary"
          leftIcon={<Plus size={12} />}
          disabled={busy}
          data-testid="devbox-projects-create"
          onClick={onCreate}
        >
          {t('devboxPage.addProfile')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <GlassCard className="p-4" data-testid="devbox-projects-empty">
          <EmptyState
            icon={FolderCog}
            title={t('devboxPage.profilesEmpty')}
            description={t('devboxPage.profilesEmptyDesc')}
            action={
              <Button size="sm" variant="primary" onClick={onCreate} data-testid="devbox-projects-empty-create">
                {t('devboxPage.addProfile')}
              </Button>
            }
          />
        </GlassCard>
      ) : (
        <div
          className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]"
          data-testid="devbox-projects-grid"
        >
          {rows.map(row => {
            const isSelected = row.name === selectedName;
            return (
              <GlassCard
                key={row.name}
                className={cn(
                  'flex cursor-pointer flex-col gap-2 p-3',
                  isSelected && 'bg-white/[0.06]',
                )}
                data-testid={`devbox-project-card-${row.name}`}
                data-active={row.active ? 'true' : 'false'}
                data-selected={isSelected ? 'true' : 'false'}
                onClick={() => setSelected(row.name)}
              >
                <div className="flex items-start gap-2">
                  <FolderKanban size={16} className="mt-0.5 shrink-0 text-indigo-300" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-white">{row.name}</span>
                      {row.active && (
                        <Badge size="sm" variant="success" withDot data-testid={`devbox-project-active-${row.name}`}>
                          {t('devboxPage.activeBadge')}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate font-mono text-2xs text-slate-400" title={row.project_dir}>
                      {row.project_dir || '—'}
                    </p>
                  </div>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t('devboxPage.projectsEditorTitle')}
                    tooltip={t('devboxPage.projectsEditorTitle')}
                    data-testid={`devbox-project-edit-${row.name}`}
                    onClick={e => {
                      e.stopPropagation();
                      openEditor(row.name);
                    }}
                  >
                    <Pencil size={12} />
                  </IconButton>
                </div>
                <div
                  className="mt-auto flex flex-wrap items-center gap-1.5"
                  onClick={e => e.stopPropagation()}
                >
                  <Badge size="sm" variant="slate">
                    {devboxModeLabel(row.mode)}
                  </Badge>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    data-testid={`devbox-profile-start-${row.name}`}
                    title={
                      row.active && stackRunning
                        ? t('devboxPage.tipRestart')
                        : t('devboxPage.tipStart')
                    }
                    onClick={() => onAction(devboxStackStart(row.name, false))}
                  >
                    {row.active && stackRunning
                      ? t('devboxPage.restart')
                      : t('devboxPage.controlStart')}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || row.active}
                    data-testid={`devbox-profile-use-${row.name}`}
                    title={t('devboxPage.tipUse')}
                    onClick={() =>
                      void askConfirm({
                        title: t('devboxPage.switchProfileConfirmTitle', { name: row.name }),
                        message: t('devboxPage.switchProfileConfirmMessage'),
                        confirmText: t('common.confirm'),
                        cancelText: t('common.cancel'),
                        variant: 'warning',
                      }).then(confirmed => {
                        if (confirmed) onAction(devboxProfileUse(row.name));
                      })
                    }
                  >
                    {t('devboxPage.controlUse')}
                  </Button>
                  <IconButton
                    size="sm"
                    aria-label={t('devboxPage.duplicateProfile')}
                    tooltip={t('devboxPage.duplicateProfile')}
                    data-testid={`devbox-profile-duplicate-${row.name}`}
                    onClick={() => duplicateProfile(row.name)}
                  >
                    <Copy size={14} />
                  </IconButton>
                  <ConfirmActionButton
                    size="xs"
                    variant="danger"
                    disabled={busy}
                    iconOnly
                    aria-label={t('devboxPage.deleteProfile')}
                    tooltip={t('devboxPage.tipDelete')}
                    data-testid={`devbox-profile-delete-${row.name}`}
                    onConfirm={() => void deleteProfile(row.name)}
                  >
                    <Trash2 size={14} />
                  </ConfirmActionButton>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {selectedName !== '' && (
        <GlassCard className="p-4" data-testid="devbox-project-detail">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold text-white">{t('devboxPage.projectsDetailTitle')}</h4>
              <p className="truncate font-mono text-2xs text-slate-400">{selectedName}</p>
            </div>
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<Pencil size={12} />}
              data-testid="devbox-project-detail-edit"
              onClick={() => openEditor(selectedName)}
            >
              {t('devboxPage.projectsEditorTitle')}
            </Button>
          </div>

          {detailLoading ? (
            <div className="flex justify-center py-8" data-testid="devbox-project-detail-loading">
              <LoadingSpinner />
            </div>
          ) : detail.error !== null ? (
            <Alert
              variant="danger"
              title={t('devboxPage.projectsInvalidTitle')}
              message={detail.error}
              actions={
                <Button size="xs" variant="secondary" onClick={() => setLoadTick(tick => tick + 1)}>
                  {t('common.retry')}
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="flex flex-col gap-3">
                <KeyValueList rows={summaryRows} density="compact" />
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-project-env">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                    {t('devboxPage.projectsEnvTitle')}
                  </span>
                  <div className="mt-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-2xs">
                      <span className="font-mono text-slate-400">TOOLCHAIN</span>
                      <span className="min-w-0 truncate text-slate-200">{toolchain || '—'}</span>
                    </div>
                    {envRows.map(entry => (
                      <div
                        key={entry.key}
                        className="flex items-center justify-between gap-2 text-2xs"
                        data-testid={`devbox-project-env-${entry.key}`}
                      >
                        <span className="shrink-0 font-mono text-slate-400">{entry.key}</span>
                        <span
                          className="min-w-0 truncate text-slate-200"
                          title={entry.value}
                        >
                          {entry.value || '—'}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-2 text-2xs">
                      <span className="font-mono text-slate-400">PREVIEW_ORIGIN</span>
                      <span className="min-w-0 truncate text-slate-200" title={previewOrigin}>
                        {previewOrigin || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('devboxPage.projectsJsonTitle')}
                </span>
                {detail.model === null ? (
                  <Alert
                    variant="warning"
                    title={t('devboxPage.projectsInvalidTitle')}
                    message={t('devboxPage.projectsInvalidDesc')}
                    actions={
                      <Button
                        size="xs"
                        variant="secondary"
                        data-testid="devbox-project-open-editor"
                        onClick={() => openEditor(selectedName)}
                      >
                        {t('devboxPage.projectsEditorTitle')}
                      </Button>
                    }
                  />
                ) : (
                  <CodeBlock code={detail.json} label={`${selectedName}.json`} maxHeight={260} />
                )}
              </div>
            </div>
          )}
        </GlassCard>
      )}

      <DevboxProfiles
        profiles={profiles}
        overviewCards={overviewCards}
        error={error}
        busy={busy}
        onAction={onAction}
        onRetry={onRetry}
        onChanged={onChanged}
        onStarted={onStarted}
        addSignal={addSignal}
        seedSignal={seedSignal}
        editSignal={editSignal}
        editName={editName}
        duplicateSignal={dupSignal}
        duplicateName={dupName}
      />
    </div>
  );
}