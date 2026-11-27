import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bolt,
  FileJson,
  Globe2,
  Layers,
  RefreshCw,
  Server,
  Terminal,
  X,
} from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  devboxMcpCandidates,
  devboxProfileGet,
  devboxProfilePut,
  type DevboxAccepted,
  type DevboxOverviewGateway,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { DevboxServiceCards } from './DevboxServiceCards';
import { devboxIngressModeLabel } from './labels';
import { vitalStateLabelKey, type VitalState } from './state';
import type { DevboxTab, UseDevboxConnectResult } from './useDevboxConnect';
import { serializeProfileWrite } from './profileWriteLock';

const LOCKED_GATEWAY_SERVERS = ['stitch-manager', 'lgm', 'ssh', 'playwright'] as const;
const COCKPIT_PORT = 8793;
const FOCUS_ICON_CLASS: Record<VitalState, string> = {
  healthy: 'text-emerald-300',
  degraded: 'text-amber-300',
  down: 'text-red-300',
  unknown: 'text-slate-400',
  pending: 'text-indigo-300',
  disabled: 'text-slate-500',
};

interface GatewayRowState {
  name: string;
  enabled: boolean;
  mode: 'readonly' | 'full';
  allow: string;
  locked: boolean;
}

interface RunnerRow {
  name: string;
  argv: string[];
  timeout?: number;
}

function lockedGatewayRows(names: Iterable<string> = LOCKED_GATEWAY_SERVERS): GatewayRowState[] {
  return [...names].map(name => ({
    name,
    enabled: false,
    mode: 'readonly',
    allow: '',
    locked: true,
  }));
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

function numericList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    : [];
}

function rangeList(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  const rows: Array<[number, number]> = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2) continue;
    const [start, end] = item;
    if (typeof start === 'number' && typeof end === 'number' && Number.isFinite(start) && Number.isFinite(end)) {
      rows.push([start, end]);
    }
  }
  return rows;
}

function runnerRows(model: Record<string, unknown> | null): RunnerRow[] {
  const raw = model?.runner_commands;
  if (!Array.isArray(raw)) return [];
  const rows: RunnerRow[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const argv = Array.isArray(row.cmd)
      ? row.cmd.filter((part): part is string => typeof part === 'string')
      : [];
    const name = typeof row.name === 'string' && row.name !== '' ? row.name : argv[0] ?? '';
    if (name === '') continue;
    rows.push({
      name,
      argv,
      timeout: typeof row.timeout === 'number' && Number.isFinite(row.timeout) ? row.timeout : undefined,
    });
  }
  return rows;
}

function ingressBase(url: string): string {
  if (url === '') return '';
  const index = url.indexOf('/p/');
  return index >= 0 ? url.slice(0, index) : url.replace(/\/+$/, '');
}

function portLabel(value: number | [number, number]): string {
  return Array.isArray(value) ? `${value[0]}-${value[1]}` : String(value);
}

function coversCockpit(start: number, end: number): boolean {
  return COCKPIT_PORT >= start && COCKPIT_PORT <= end;
}

export interface DevboxServicesProps {
  connect: UseDevboxConnectResult;
  cards: DevboxVitalCard[] | null;
  gateway: DevboxOverviewGateway | null;
  busy: boolean;
  pendingPermissions: number;
  onAction: (action: Promise<DevboxAccepted>) => void;
  onOpenTab: (tab: DevboxTab) => void;
  onConfigureMcp: () => void;
  onChanged: () => void;
}

export function DevboxServices({
  connect,
  cards,
  gateway,
  busy,
  pendingPermissions,
  onAction,
  onOpenTab,
  onConfigureMcp,
  onChanged,
}: DevboxServicesProps) {
  const { activeProfile, profileModel } = connect;
  const [gatewayRows, setGatewayRows] = useState<GatewayRowState[]>(lockedGatewayRows);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewaySaving, setGatewaySaving] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const loadedProfileRef = useRef<string | null>(null);

  const loadGateway = useCallback(async () => {
    if (activeProfile === '') {
      setGatewayRows(lockedGatewayRows());
      setGatewayError(null);
      return;
    }
    setGatewayLoading(true);
    setGatewayError(null);
    try {
      // profileModel отстаёт от activeProfile (loadProfile асинхронный) —
      // читаем профиль напрямую, иначе экспозиции льются из чужого профиля
      const [payload, profilePayload] = await Promise.all([
        devboxMcpCandidates(activeProfile),
        devboxProfileGet(activeProfile),
      ]);
      const model = parseRecord(profilePayload.json);
      const exposed = Array.isArray(model?.exposed_mcps) ? model.exposed_mcps : [];
      const lockedNames = new Set<string>(LOCKED_GATEWAY_SERVERS);
      for (const candidate of payload.candidates) {
        if (candidate.denied === true) lockedNames.add(candidate.name);
      }
      const current = new Map<string, { mode: 'readonly' | 'full'; allow: string }>();
      for (const item of exposed) {
        if (item === null || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        if (typeof row.name !== 'string' || row.name === '' || lockedNames.has(row.name)) continue;
        current.set(row.name, {
          mode: row.mode === 'full' ? 'full' : 'readonly',
          allow: Array.isArray(row.tool_allow)
            ? row.tool_allow.filter((tool): tool is string => typeof tool === 'string').join(', ')
            : '',
        });
      }
      const rows: GatewayRowState[] = [];
      for (const candidate of payload.candidates) {
        if (lockedNames.has(candidate.name)) continue;
        const selected = current.get(candidate.name);
        rows.push({
          name: candidate.name,
          enabled: selected !== undefined,
          mode: selected?.mode ?? 'readonly',
          allow: selected?.allow ?? '',
          locked: false,
        });
      }
      for (const [name, selected] of current) {
        if (rows.some(row => row.name === name)) continue;
        rows.push({ name, enabled: true, mode: selected.mode, allow: selected.allow, locked: false });
      }
      setGatewayRows([...rows, ...lockedGatewayRows(lockedNames)]);
      if (payload.error !== null) setGatewayError(payload.error);
    } catch (err) {
      setGatewayRows(lockedGatewayRows());
      setGatewayError(err instanceof Error ? err.message : String(err));
    } finally {
      setGatewayLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    if (loadedProfileRef.current === activeProfile) return;
    loadedProfileRef.current = activeProfile;
    void loadGateway();
  }, [activeProfile, loadGateway]);

  const runners = useMemo(() => runnerRows(profileModel), [profileModel]);
  const allowedPorts = useMemo(
    () => numericList(profileModel?.allowed_ports).filter(port => port !== COCKPIT_PORT),
    [profileModel],
  );
  const portRanges = useMemo(
    () => rangeList(profileModel?.port_ranges).filter(([start, end]) => !coversCockpit(start, end)),
    [profileModel],
  );
  const deniedPorts = useMemo(() => numericList(profileModel?.port_deny), [profileModel]);
  const [portDraft, setPortDraft] = useState('');
  const [portError, setPortError] = useState<string | null>(null);
  const [portsSaving, setPortsSaving] = useState(false);

  const { copy, copied } = useCopyToClipboard();

  // manifest — ссылка для человека: браузерный PUBLIC_URL без lt-заглушки, иначе ingress
  const publicBase = (connect.savedPublicUrl ?? '').replace(/\/+$/, '');
  const manifestBase = publicBase !== '' ? publicBase : ingressBase(connect.resolvedUrl);
  const manifestUrl = manifestBase === '' ? '' : `${manifestBase}/p/9000/manifest.json`;
  const sessionStale = connect.connectionStale || connect.handoffStale;

  const pathState: VitalState =
    connect.pathHealth === 'live'
      ? 'healthy'
      : connect.pathHealth === 'failed'
        ? 'down'
        : connect.pathHealth === 'checking'
          ? 'pending'
          : 'unknown';

  const sessionState: VitalState = sessionStale
    ? 'degraded'
    : connect.bridgeState === 'healthy'
      ? 'healthy'
      : 'unknown';

  const writeProfile = useCallback(
    async (mutate: (model: Record<string, unknown>) => void): Promise<string | null> => {
      if (activeProfile === '') return t('devboxPage.servicesGatewayProfileMissing');
      const error = await serializeProfileWrite(async () => {
        const content = await devboxProfileGet(activeProfile);
        const model = parseRecord(content.json);
        if (model === null) return t('devboxPage.projectsInvalidDesc');
        mutate(model);
        const result = await devboxProfilePut(activeProfile, JSON.stringify(model, null, 2));
        if (!result.valid) {
          return result.errors.length > 0
            ? result.errors.join('; ')
            : t('devboxPage.servicesGatewaySaveFailed');
        }
        return null;
      });
      if (error !== null) return error;
      connect.reload();
      onChanged();
      return null;
    },
    [activeProfile, connect, onChanged],
  );

  const saveGateway = async () => {
    setGatewaySaving(true);
    setGatewayError(null);
    try {
      const error = await writeProfile(model => {
        model.exposed_mcps = gatewayRows
          .filter(row => row.enabled && !row.locked)
          .map(row => ({
            name: row.name,
            mode: row.mode,
            tool_allow: row.allow
              .split(',')
              .map(tool => tool.trim())
              .filter(Boolean),
          }));
      });
      if (error === null) toast.success(t('devboxPage.editorSaved'));
      else setGatewayError(error);
    } catch (err) {
      setGatewayError(err instanceof Error ? err.message : String(err));
    } finally {
      setGatewaySaving(false);
    }
  };

  const updateGateway = (name: string, patch: Partial<GatewayRowState>) => {
    setGatewayRows(prev => prev.map(row => (row.name === name && !row.locked ? { ...row, ...patch } : row)));
  };

  const savePorts = async (nextAllowed: number[], nextRanges: Array<[number, number]>) => {
    setPortsSaving(true);
    setPortError(null);
    try {
      const error = await writeProfile(model => {
        model.allowed_ports = nextAllowed;
        model.port_ranges = nextRanges;
      });
      if (error !== null) setPortError(error);
    } catch (err) {
      setPortError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortsSaving(false);
    }
  };

  const addPort = () => {
    const value = portDraft.trim();
    if (value === '') return;
    const single = /^(\d+)$/.exec(value);
    const range = /^(\d+)-(\d+)$/.exec(value);
    const number = single ? Number(single[1]) : null;
    const start = range ? Number(range[1]) : null;
    const end = range ? Number(range[2]) : null;
    const validSingle = number !== null && number >= 1 && number <= 65535;
    const validRange =
      start !== null && end !== null && start >= 1 && end <= 65535 && start <= end;
    if (!validSingle && !validRange) {
      setPortError(t('devboxPage.servicesPortsInvalid'));
      return;
    }
    if (number === COCKPIT_PORT || (start !== null && end !== null && coversCockpit(start, end))) {
      setPortError(t('devboxPage.servicesPortsCockpitDenied'));
      return;
    }
    if (number !== null) {
      if (allowedPorts.includes(number)) {
        setPortDraft('');
        return;
      }
      void savePorts([...allowedPorts, number].sort((a, b) => a - b), portRanges);
    } else if (start !== null && end !== null) {
      if (portRanges.some(([lo, hi]) => lo === start && hi === end)) {
        setPortDraft('');
        return;
      }
      void savePorts([...allowedPorts].sort((a, b) => a - b), [...portRanges, [start, end] as [number, number]]);
    }
    setPortDraft('');
  };

  const focusRow = (args: {
    id: 'bridge' | 'path' | 'session';
    icon: typeof Bolt;
    title: string;
    purpose: string;
    state: VitalState;
    meta: Array<{ value: string; mono?: boolean }>;
    action: { label: string; onClick: () => void; disabled?: boolean; testId: string };
  }) => {
    const Icon = args.icon;
    return (
      <GlassCard
        key={args.id}
        className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center"
        data-testid={`devbox-services-focus-${args.id}`}
        data-state={args.state}
      >
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]',
            FOCUS_ICON_CLASS[args.state],
          )}
        >
          <Icon size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-white">{args.title}</span>
            <Badge
              size="sm"
              variant={
                args.state === 'healthy'
                  ? 'success'
                  : args.state === 'down'
                    ? 'danger'
                    : args.state === 'degraded'
                      ? 'warning'
                      : 'slate'
              }
            >
              {t(vitalStateLabelKey(args.state))}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-2xs text-slate-400" title={args.purpose}>
            {args.purpose}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-slate-500">
            {args.meta.map((item, index) => (
              <span key={`${args.id}-meta-${index}`} className={cn(item.mono && 'font-mono text-slate-400')}>
                {item.value}
              </span>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          variant={args.state === 'healthy' ? 'ghost' : 'primary'}
          disabled={args.action.disabled}
          data-testid={args.action.testId}
          onClick={args.action.onClick}
        >
          {args.action.label}
        </Button>
      </GlassCard>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="devbox-services-view">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{t('devboxPage.servicesFocusTitle')}</h3>
          <p className="text-2xs text-slate-400">{t('devboxPage.servicesFocusCaption')}</p>
        </div>
        <Button
          size="xs"
          variant="secondary"
          disabled={connect.checking}
          leftIcon={<RefreshCw size={12} className={cn(connect.checking && 'animate-spin')} />}
          data-testid="devbox-services-check-all"
          onClick={connect.runCheck}
        >
          {connect.checking ? t('devboxPage.overviewChecking') : t('devboxPage.servicesFocusCheckAll')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2" data-testid="devbox-services-focus">
        {focusRow({
          id: 'bridge',
          icon: Bolt,
          title: t('devboxPage.overviewFocusBridgeTitle'),
          purpose: t('devboxPage.overviewFocusBridgePurpose'),
          state: connect.bridgeState,
          meta: [
            { value: t('devboxPage.agentToolsSummary') },
            { value: t('devboxPage.connectTokenBridge'), mono: true },
            {
              value:
                connect.bridgeState === 'healthy'
                  ? t('devboxPage.overviewFocusReady')
                  : t('devboxPage.overviewFocusStopped'),
            },
          ],
          action: {
            label:
              connect.bridgeState === 'healthy'
                ? t('devboxPage.overviewActionRestart')
                : t('devboxPage.overviewActionStart'),
            disabled: busy || activeProfile === '',
            testId: 'devbox-services-focus-bridge-action',
            onClick: connect.startStack,
          },
        })}
        {focusRow({
          id: 'path',
          icon: Globe2,
          title: t('devboxPage.overviewFocusPathTitle'),
          purpose: t('devboxPage.overviewFocusPathPurpose'),
          state: pathState,
          meta: [
            {
              value: connect.resolvedUrl === '' ? t('devboxPage.overviewEndpointMissing') : connect.resolvedUrl,
              mono: true,
            },
            {
              value: connect.probeStale
                ? t('devboxPage.overviewProbeStale')
                : connect.fallbackActive
                  ? t('devboxPage.overviewModeFallback', { mode: devboxIngressModeLabel(connect.effectiveMode) })
                  : devboxIngressModeLabel(connect.effectiveMode),
            },
          ],
          action: {
            label: connect.checking ? t('devboxPage.overviewChecking') : t('devboxPage.overviewActionCheck'),
            disabled: connect.checking,
            testId: 'devbox-services-focus-path-action',
            onClick: connect.runCheck,
          },
        })}
        {focusRow({
          id: 'session',
          icon: Activity,
          title: t('devboxPage.overviewFocusSessionTitle'),
          purpose: t('devboxPage.overviewFocusSessionPurpose'),
          state: sessionState,
          meta: [
            { value: t('devboxPage.overviewApprovalsCount', { count: pendingPermissions }) },
            { value: sessionStale ? t('devboxPage.overviewSessionStale') : t('devboxPage.overviewFocusOnline') },
          ],
          action: {
            label: t('devboxPage.overviewActionQueue'),
            testId: 'devbox-services-focus-session-action',
            onClick: () => onOpenTab('agent'),
          },
        })}
      </div>

      <CollapsibleSection
        title={t('devboxPage.servicesCapabilitiesTitle')}
        description={t('devboxPage.servicesCapabilitiesCaption')}
        icon={<Layers size={16} className="text-indigo-300" />}
        defaultExpanded={false}
      >
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-services-runner">
            <div className="mb-1 flex items-center gap-2">
              <Terminal size={14} className="text-slate-400" aria-hidden />
              <span className="text-xs font-semibold text-white">{t('devboxPage.servicesRunnerTitle')}</span>
              <Badge size="sm" variant="slate" className="ml-auto">
                {t('devboxPage.connectTokenHost')}
              </Badge>
            </div>
            <p className="mb-2 text-2xs text-slate-400">{t('devboxPage.servicesRunnerCaption')}</p>
            {runners.length === 0 ? (
              <EmptyState compact icon={Terminal} title={t('devboxPage.servicesRunnerEmpty')} />
            ) : (
              <div className="flex flex-col gap-1">
                {runners.map(row => (
                  <div
                    key={row.name}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] px-2 py-1"
                    data-testid={`devbox-services-runner-${row.name}`}
                  >
                    <span className="truncate font-mono text-2xs text-slate-300">
                      {row.argv.length > 0 ? row.argv.join(' ') : row.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-services-gateway">
            <div className="mb-1 flex items-center gap-2">
              <Server size={14} className="text-slate-400" aria-hidden />
              <span className="text-xs font-semibold text-white">{t('devboxPage.servicesGatewayTitle')}</span>
              <Badge size="sm" variant="slate" className="ml-auto">
                {t('devboxPage.connectTokenGateway')}
              </Badge>
            </div>
            <p className="mb-2 text-2xs text-slate-400">{t('devboxPage.servicesGatewayCaption')}</p>
            {activeProfile === '' ? (
              <Alert variant="warning" message={t('devboxPage.servicesGatewayProfileMissing')} />
            ) : (
              <div className="flex flex-col gap-1.5">
                {gatewayLoading && <p className="text-2xs text-slate-500">{t('devboxPage.connectLoading')}</p>}
                {gatewayError !== null && <Alert variant="danger" message={gatewayError} />}
                {gatewayRows.map(row => (
                  <div
                    key={row.name}
                    className={cn(
                      'flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5',
                      row.locked && 'opacity-80',
                    )}
                    data-testid={`devbox-services-gateway-${row.name}`}
                    data-locked={row.locked ? 'true' : 'false'}
                  >
                    <span data-testid={`devbox-services-gateway-${row.name}-toggle`}>
                      <Toggle
                        size="sm"
                        label=""
                        ariaLabel={row.name}
                        checked={row.enabled}
                        disabled={row.locked || gatewaySaving}
                        onChange={next => updateGateway(row.name, { enabled: next })}
                      />
                    </span>
                    <span className="min-w-0 truncate font-mono text-2xs text-slate-300">{row.name}</span>
                    {row.locked && (
                      <Badge size="sm" variant="danger" data-testid={`devbox-services-gateway-${row.name}-locked`}>
                        {t('devboxPage.servicesGatewayHardDeny')}
                      </Badge>
                    )}
                    <Select
                      containerClassName="w-28"
                      options={[
                        { value: 'readonly', label: t('devboxPage.mcpModeReadonly') },
                        { value: 'full', label: t('devboxPage.mcpModeFull') },
                      ]}
                      value={row.mode}
                      disabled={row.locked || gatewaySaving}
                      data-testid={`devbox-services-gateway-${row.name}-mode`}
                      onValueChange={value =>
                        updateGateway(row.name, { mode: value === 'full' ? 'full' : 'readonly' })
                      }
                    />
                    <Input
                      containerClassName="min-w-[150px] flex-1"
                      value={row.allow}
                      placeholder={t('devboxPage.servicesGatewayAllowPlaceholder')}
                      disabled={row.locked || gatewaySaving}
                      data-testid={`devbox-services-gateway-${row.name}-allow`}
                      onChange={event => updateGateway(row.name, { allow: event.target.value })}
                    />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={gatewaySaving || gatewayLoading}
                    data-testid="devbox-services-gateway-save"
                    onClick={() => void saveGateway()}
                  >
                    {gatewaySaving ? t('devboxPage.servicesGatewaySaving') : t('devboxPage.servicesGatewaySave')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={gatewaySaving}
                    data-testid="devbox-services-gateway-advanced"
                    onClick={onConfigureMcp}
                  >
                    {t('devboxPage.mcpPickerAdvanced')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-services-manifest">
          <div className="mb-1 flex items-center gap-2">
            <FileJson size={14} className="text-slate-400" aria-hidden />
            <span className="text-xs font-semibold text-white">{t('devboxPage.servicesManifestTitle')}</span>
            <Badge size="sm" variant="slate" className="ml-auto">
              {t('devboxPage.connectTokenIngress')}
            </Badge>
          </div>
          <p className="mb-2 text-2xs text-slate-400">{t('devboxPage.servicesManifestDesc')}</p>
          {manifestUrl === '' ? (
            <p className="text-2xs text-amber-300">{t('devboxPage.servicesManifestMissing')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-slate-300">{manifestUrl}</span>
              <Button
                size="xs"
                variant="ghost"
                data-testid="devbox-services-manifest-copy"
                onClick={() =>
                  void copy(manifestUrl, {
                    successMessage: t('devboxPage.servicesManifestCopied'),
                  })
                }
              >
                {copied ? t('devboxPage.servicesManifestCopied') : t('devboxPage.servicesManifestCopy')}
              </Button>
            </div>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('devboxPage.servicesInfraTitle')}
        description={t('devboxPage.servicesDiagnostics')}
        icon={<Server size={16} className="text-indigo-300" />}
        defaultExpanded={false}
      >
        <div className="flex flex-col gap-3">
          <DevboxServiceCards
            cards={cards}
            gateway={gateway}
            activeProfile={activeProfile}
            busy={busy}
            onAction={onAction}
          />

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-services-ports">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-white">{t('devboxPage.servicesPortsTitle')}</span>
                <span className="ml-auto text-2xs uppercase tracking-wider text-slate-500">
                  {t('devboxPage.servicesPortsDenyWins')}
                </span>
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="devbox-services-ports-allowed">
                <span className="text-2xs uppercase tracking-wider text-slate-500">
                  {t('devboxPage.servicesPortsAllowed')}
                </span>
                {allowedPorts.length === 0 && portRanges.length === 0 ? (
                  <span className="text-2xs text-slate-500">{t('devboxPage.servicesPortsEmpty')}</span>
                ) : (
                  <>
                    {allowedPorts.map(port => (
                      <Badge
                        key={`port-${port}`}
                        variant="default"
                        size="sm"
                        className="gap-1 font-mono text-2xs normal-case tracking-normal"
                        data-testid={`devbox-services-port-${port}`}
                      >
                        {portLabel(port)}
                        <IconButton
                          size="sm"
                          variant="ghost"
                          aria-label={t('devboxPage.servicesPortsRemove')}
                          tooltip={t('devboxPage.servicesPortsRemove')}
                          disabled={portsSaving}
                          data-testid={`devbox-services-port-remove-${port}`}
                          onClick={() =>
                            void savePorts(
                              allowedPorts.filter(value => value !== port),
                              portRanges,
                            )
                          }
                        >
                          <X size={10} />
                        </IconButton>
                      </Badge>
                    ))}
                    {portRanges.map(([start, end]) => (
                      <Badge
                        key={`range-${start}-${end}`}
                        variant="default"
                        size="sm"
                        className="gap-1 font-mono text-2xs normal-case tracking-normal"
                        data-testid={`devbox-services-port-range-${start}-${end}`}
                      >
                        {portLabel([start, end])}
                        <IconButton
                          size="sm"
                          variant="ghost"
                          aria-label={t('devboxPage.servicesPortsRemove')}
                          tooltip={t('devboxPage.servicesPortsRemove')}
                          disabled={portsSaving}
                          onClick={() =>
                            void savePorts(
                              allowedPorts,
                              portRanges.filter(([lo, hi]) => !(lo === start && hi === end)),
                            )
                          }
                        >
                          <X size={10} />
                        </IconButton>
                      </Badge>
                    ))}
                  </>
                )}
              </div>
              <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="devbox-services-ports-denied">
                <span className="text-2xs uppercase tracking-wider text-slate-500">
                  {t('devboxPage.servicesPortsDenied')}
                </span>
                <Badge
                  variant="danger"
                  size="sm"
                  className="gap-1 font-mono text-2xs normal-case tracking-normal"
                >
                  {COCKPIT_PORT}
                  <span className="text-[9px] uppercase tracking-wider">{t('devboxPage.servicesPortDenyHard')}</span>
                </Badge>
                {deniedPorts
                  .filter(port => port !== COCKPIT_PORT)
                  .map(port => (
                    <Badge
                      key={`deny-${port}`}
                      variant="danger"
                      size="sm"
                      className="font-mono text-2xs normal-case tracking-normal"
                    >
                      {port}
                    </Badge>
                  ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={portDraft}
                  placeholder={t('devboxPage.servicesPortsAddPlaceholder')}
                  containerClassName="w-44"
                  disabled={portsSaving || activeProfile === ''}
                  data-testid="devbox-services-port-input"
                  onChange={event => {
                    setPortDraft(event.target.value);
                    setPortError(null);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') addPort();
                  }}
                />
                <Button
                  size="xs"
                  variant="secondary"
                  disabled={portsSaving || activeProfile === '' || portDraft.trim() === ''}
                  data-testid="devbox-services-port-add"
                  onClick={addPort}
                >
                  {t('devboxPage.servicesPortsAdd')}
                </Button>
              </div>
              {portError === null && (
                <p className="mt-1.5 text-2xs text-slate-500">{t('devboxPage.servicesPortsCockpitDenied')}</p>
              )}
              {portError !== null && (
                <p className="mt-1 text-2xs text-red-300" data-testid="devbox-services-port-error">
                  {portError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="flex items-center gap-2 self-start text-2xs text-indigo-300 transition-colors hover:text-indigo-200"
                data-testid="devbox-services-tokens-link"
                onClick={() => onOpenTab('connect')}
              >
                <span data-testid="devbox-services-open-connect">
                  {t('devboxPage.servicesOpenConnect')}
                </span>
                <span aria-hidden>→</span>
              </button>
              <Alert variant="info" title={t('devboxPage.servicesDiagnostics')} message={t('devboxPage.connectBootstrapCheckText')} />
              <Button
                size="xs"
                variant="secondary"
                disabled={busy || activeProfile === ''}
                leftIcon={<RefreshCw size={12} />}
                data-testid="devbox-services-restart-stack"
                onClick={connect.startStack}
              >
                {t('devboxPage.servicesRestartStack')}
              </Button>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}