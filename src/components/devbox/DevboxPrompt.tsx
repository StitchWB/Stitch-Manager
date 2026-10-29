import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Info,
  Lock,
  Play,
  Plus,
  Power,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  devboxActionSucceeded,
  devboxAgentPrompt,
  devboxConnectionCheck,
  devboxIngressControl,
  devboxNormalizeConnection,
  devboxStackStart,
  devboxVitalValue,
  type DevboxAccepted,
  type DevboxActionStatus,
  type DevboxAgentPrompt as DevboxAgentPromptPayload,
  type DevboxAgentPromptReady,
  type DevboxConnectionEndpoint,
  type DevboxOverviewGateway,
  type DevboxProfileRow,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

const STALE_COMMAND_RE = /method not found|-32601/i;

const STALE_ROTATION_CMDS = new Set(['issue_tokens', 'ingress_control', 'stack_start']);

const COPY_FLASH_MS = 2000;

type ConnectionMode = 'sandbox' | 'remote';

type CheckState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; tools: number; latency: number }
  | { status: 'fail'; error: string };

const AGENT_CLIENTS: ReadonlyArray<readonly [string, string]> = [
  ['claude-code', 'Claude Code'],
  ['opencode', 'OpenCode'],
  ['codex', 'Codex'],
  ['cursor', 'Cursor'],
  ['vscode', 'VS Code'],
  ['cline', 'Cline'],
  ['roo', 'Roo'],
  ['gemini', 'Gemini'],
  ['zed', 'Zed'],
  ['factory', 'Factory'],
  ['kiro', 'Kiro'],
  ['windsurf', 'Windsurf'],
];

function finishedMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000;
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (value.trim() !== '' && Number.isFinite(asNumber)) return asNumber * 1000;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function cardUp(cards: DevboxVitalCard[] | null, id: string): boolean {
  const value = devboxVitalValue(cards, id);
  return value === 'up' || value === 'on' || value === 'true';
}

function readyFromCards(cards: DevboxVitalCard[] | null): DevboxAgentPromptReady {
  const profile = devboxVitalValue(cards, 'profile');
  return {
    profile:
      profile !== null && !['', '—', '-', 'none', 'down', 'off'].includes(profile),
    bridge: cardUp(cards, 'bridge'),
    ingress: cardUp(cards, 'ingress'),
    runner: cardUp(cards, 'runner'),
  };
}

export interface DevboxPromptProps {
  profiles: DevboxProfileRow[] | null;
  overviewCards: DevboxVitalCard[] | null;
  gateway?: DevboxOverviewGateway | null;
  actionStatus: DevboxActionStatus | null;
  onAction: (action: Promise<DevboxAccepted>) => void;
  reloadTick?: number;
}

type PromptTab = 'editor' | 'prompt';

const AUTH_TYPES: ReadonlyArray<readonly [string, string]> = [
  ['bearer', 'API key / Bearer'],
  ['oauth-dynamic', 'OAuth 2 Dynamic'],
  ['oauth-pkce', 'OAuth 2 Code + PKCE'],
];

async function copyValue(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function DevboxPrompt({
  profiles,
  overviewCards,
  gateway = null,
  actionStatus,
  onAction,
  reloadTick = 0,
}: DevboxPromptProps) {
  const [data, setData] = useState<DevboxAgentPromptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = useState<ConnectionMode>('sandbox');
  const [tab, setTab] = useState<PromptTab>('editor');
  const [manualCopy, setManualCopy] = useState(false);
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  const [task, setTask] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [client, setClient] = useState('universal');
  const [authType, setAuthType] = useState('bearer');
  const [copied, setCopied] = useState<{ at: number; fingerprint: string } | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
  const [remoteCopied, setRemoteCopied] = useState<string | null>(null);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const [check, setCheck] = useState<CheckState>({ status: 'idle' });
  const revealedRef = useRef(false);
  const taskRef = useRef('');
  const acceptanceRef = useRef('');
  const clientRef = useRef('universal');
  const flashTimerRef = useRef<number | null>(null);

  const load = useCallback((reveal: boolean) => {
    devboxAgentPrompt({
      task: taskRef.current,
      acceptance: acceptanceRef.current,
      reveal,
      client: clientRef.current,
    })
      .then(result => {
        setData(result);
        setError(null);
        setRevealed(reveal);
        revealedRef.current = reveal;
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (reloadTick > 0) load(revealedRef.current);
  }, [reloadTick, load]);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const ready = useMemo(
    () => data?.ready ?? readyFromCards(overviewCards),
    [data, overviewCards],
  );

  const connection = useMemo(
    () => (data !== null ? devboxNormalizeConnection(data.connection) : null),
    [data],
  );

  const remoteEndpoint = useMemo<DevboxConnectionEndpoint | null>(
    () => connection?.endpoints[0] ?? null,
    [connection],
  );

  const ensureRevealed = useCallback(async (): Promise<DevboxAgentPromptPayload | null> => {
    if (revealed && data !== null) return data;
    try {
      const payload = await devboxAgentPrompt({
        task: taskRef.current,
        acceptance: acceptanceRef.current,
        reveal: true,
        client: clientRef.current,
      });
      setData(payload);
      setRevealed(true);
      revealedRef.current = true;
      return payload;
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
      return null;
    }
  }, [revealed, data]);

  const copyRemote = async (key: string, value: string) => {
    const ok = await copyValue(value);
    if (!ok) {
      appToast.error(t('pluginUi.actionFailed'));
      return;
    }
    setRemoteCopied(key);
    window.setTimeout(
      () => setRemoteCopied(current => (current === key ? null : current)),
      COPY_FLASH_MS,
    );
  };

  const revealedToken = useCallback(async (): Promise<string | null> => {
    const payload = await ensureRevealed();
    const token = payload?.connection?.endpoints[0]?.token;
    return typeof token === 'string' && token !== '' ? token : null;
  }, [ensureRevealed]);

  const runCheck = async () => {
    setCheck({ status: 'running' });
    try {
      const result = await devboxConnectionCheck();
      if (result.ok) {
        setCheck({ status: 'ok', tools: result.tools ?? 0, latency: result.latency_ms ?? 0 });
      } else {
        setCheck({ status: 'fail', error: result.error ?? t('pluginUi.actionFailed') });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (STALE_COMMAND_RE.test(message)) {
        setCheck({ status: 'fail', error: t('devboxPage.handoffErrorStale') });
      } else {
        setCheck({ status: 'fail', error: message });
      }
    }
  };

  const activeProfileName = useMemo(
    () => (Array.isArray(profiles) ? profiles.find(row => row.active)?.name ?? '' : ''),
    [profiles],
  );

  const blockingLabels = [
    ready.profile ? null : t('devboxPage.promptChipProfile'),
    ready.bridge ? null : t('devboxPage.promptChipStack'),
    ready.ingress ? null : t('devboxPage.promptChipIngress'),
  ].filter((label): label is string => label !== null);
  const copyDisabled = blockingLabels.length > 0;

  const gatewayDown =
    gateway !== null &&
    gateway.enabled &&
    gateway.exposed_mcps.length > 0 &&
    gateway.up === false;

  const recent = actionStatus?.recent;
  const stale = useMemo(() => {
    if (copied === null || !Array.isArray(recent)) return false;
    return recent.some(
      action =>
        STALE_ROTATION_CMDS.has(action.cmd) &&
        devboxActionSucceeded(action) &&
        (finishedMs(action.finishedAt) ?? Number.NEGATIVE_INFINITY) > copied.at,
    );
  }, [recent, copied]);

  const flashCopied = () => {
    setCopyFlash(true);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setCopyFlash(false), COPY_FLASH_MS);
  };

  const copy = async () => {
    let payload: DevboxAgentPromptPayload;
    try {
      payload = await devboxAgentPrompt({ task, acceptance, reveal: true, client });
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
      return;
    }
    try {
      await navigator.clipboard.writeText(payload.prompt);
      setCopied({ at: Date.now(), fingerprint: payload.prompt });
      setManualCopy(false);
      flashCopied();
      appToast.success(t('pluginUi.copied'));
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
      setData(payload);
      setRevealed(true);
      revealedRef.current = true;
      setTab('prompt');
      setManualCopy(true);
    }
  };

  const errorText =
    error !== null && STALE_COMMAND_RE.test(error) ? t('devboxPage.handoffErrorStale') : error;

  const clientOptions = [
    { value: 'universal', label: t('devboxPage.promptClientUniversal') },
    ...AGENT_CLIENTS.map(([value, label]) => ({ value, label })),
  ];

  const clientHint =
    client === 'universal'
      ? t('devboxPage.promptHintUniversal')
      : t('devboxPage.promptHintClient', {
          client: clientOptions.find(option => option.value === client)?.label ?? client,
        });

  const copyButton = (
    <Button
      variant="primary"
      size="sm"
      disabled={copyDisabled}
      className={cn(
        copyFlash &&
          'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:border-emerald-400/60 hover:bg-emerald-500/25 hover:text-white',
      )}
      leftIcon={copyFlash ? <Check size={14} /> : <Copy size={14} />}
      data-testid="devbox-prompt-copy"
      onClick={() => void copy()}
    >
      {copyFlash ? t('devboxPage.promptCopied') : t('devboxPage.promptCopy')}
    </Button>
  );

  const alertPlate = (testId: string, text: string) => (
    <span
      className="flex shrink-0 items-center gap-1 self-start rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
      data-testid={testId}
    >
      <AlertTriangle size={12} className="shrink-0" aria-hidden />
      {text}
    </span>
  );

  const blockingAlert = (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 self-start rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
      data-testid="devbox-prompt-stack-warning"
    >
      <span className="flex items-center gap-1">
        <AlertTriangle size={12} className="shrink-0" aria-hidden />
        {t('devboxPage.promptStackDownWarning')}
      </span>
      {(!ready.bridge || !ready.runner) && (
        <Button
          size="xs"
          variant="outline"
          leftIcon={<Power size={12} />}
          data-testid="devbox-prompt-alert-stack-start"
          onClick={() => onAction(devboxStackStart(activeProfileName, false))}
        >
          {t('devboxPage.promptChipStackStart')}
        </Button>
      )}
      {ready.bridge && ready.runner && !ready.ingress && (
        <Button
          size="xs"
          variant="outline"
          leftIcon={<Play size={12} />}
          data-testid="devbox-prompt-alert-ingress-up"
          onClick={() => onAction(devboxIngressControl('up'))}
        >
          {t('devboxPage.promptChipIngressUp')}
        </Button>
      )}
    </div>
  );

  return (
    <DevboxSection
      title={t('devboxPage.sectionPrompt')}
      error={errorText}
      onRetry={() => load(revealedRef.current)}
      testId="devbox-prompt"
      className="flex min-h-full flex-col"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      actions={
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t('common.refresh')}
          tooltip={t('devboxPage.tipRefreshPrompt')}
          data-testid="devbox-prompt-refresh"
          onClick={() => load(revealedRef.current)}
        >
          <RefreshCw size={14} />
        </IconButton>
      }
    >
      {data !== null && error === null && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="shrink-0" data-testid="devbox-prompt-mode">
            <SegmentedControl
              size="sm"
              value={mode}
              onChange={value => setMode(value === 'remote' ? 'remote' : 'sandbox')}
              options={[
                { value: 'sandbox', label: t('devboxPage.promptModeSandbox') },
                { value: 'remote', label: t('devboxPage.promptModeRemote') },
              ]}
            />
          </div>

          {mode === 'remote' ? (
            <div className="flex flex-col gap-3" data-testid="devbox-remote-panel">
              <Select
                label={t('devboxPage.remoteAuthLabel')}
                options={AUTH_TYPES.map(([value, label]) => ({
                  value,
                  label:
                    value === 'bearer'
                      ? label
                      : `${label} ${t('devboxPage.remoteAuthSoon')}`,
                }))}
                value={authType}
                containerClassName="shrink-0"
                data-testid="devbox-remote-auth"
                onValueChange={setAuthType}
              />
              {authType !== 'bearer' && (
                <span
                  className="flex shrink-0 items-start gap-1.5 self-start rounded border border-sky-500/40 bg-sky-500/10 px-2 py-1 text-xs text-sky-200"
                  data-testid="devbox-remote-auth-unsupported"
                >
                  <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
                  {t('devboxPage.remoteAuthBadge')}
                </span>
              )}

              {remoteEndpoint !== null && (
                <div
                  className="flex shrink-0 flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                  data-testid="devbox-remote-box"
                >
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-300" htmlFor="devbox-remote-url">
                      {t('devboxPage.remoteUrlLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={remoteEndpoint.url}
                        readOnly
                        containerClassName="min-w-0 flex-1"
                        className="font-mono text-xs"
                        data-testid="devbox-remote-url"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={remoteCopied === 'url' ? <Check size={14} /> : <Copy size={14} />}
                        data-testid="devbox-remote-copy-url"
                        onClick={() => void copyRemote('url', remoteEndpoint.url)}
                      >
                        {remoteCopied === 'url'
                          ? t('devboxPage.remoteCopied')
                          : t('devboxPage.remoteCopyUrl')}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-300" htmlFor="devbox-remote-token">
                      {t('devboxPage.remoteTokenLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={remoteEndpoint.token}
                        readOnly
                        type={revealed ? 'text' : 'password'}
                        containerClassName="min-w-0 flex-1"
                        className="font-mono text-xs"
                        data-testid="devbox-remote-token"
                      />
                      <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={t('devboxPage.promptTokens')}
                        data-testid="devbox-remote-reveal"
                        onClick={() => void ensureRevealed()}
                      >
                        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                      </IconButton>
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={remoteCopied === 'token' ? <Check size={14} /> : <Copy size={14} />}
                        data-testid="devbox-remote-copy-token"
                        onClick={() => void (async () => {
                          const current = await revealedToken();
                          if (current === null) return;
                          await copyRemote('token', current);
                        })()}
                      >
                        {remoteCopied === 'token'
                          ? t('devboxPage.remoteCopied')
                          : t('devboxPage.remoteCopyToken')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={remoteCopied === 'header' ? <Check size={14} /> : <Copy size={14} />}
                        data-testid="devbox-remote-copy-header"
                        onClick={() => void (async () => {
                          const current = await revealedToken();
                          if (current === null) return;
                          await copyRemote('header', `Bearer ${current}`);
                        })()}
                      >
                        {remoteCopied === 'header'
                          ? t('devboxPage.remoteCopied')
                          : t('devboxPage.remoteCopyHeader')}
                      </Button>
                    </div>
                    <span className="text-2xs text-slate-500" data-testid="devbox-remote-hint">
                      {t('devboxPage.remoteHint')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<Zap size={14} />}
                      disabled={check.status === 'running'}
                      data-testid="devbox-remote-check"
                      onClick={() => void runCheck()}
                    >
                      {check.status === 'running'
                        ? t('devboxPage.remoteChecking')
                        : t('devboxPage.remoteCheck')}
                    </Button>
                    {check.status === 'ok' && (
                      <span
                        className="flex items-center gap-1.5 text-xs text-emerald-300"
                        data-testid="devbox-remote-check-ok"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                        {t('devboxPage.remoteCheckOk', {
                          tools: check.tools,
                          latency: check.latency,
                        })}
                      </span>
                    )}
                    {check.status === 'fail' && (
                      <span
                        className="flex min-w-0 items-center gap-1.5 text-xs text-red-300"
                        data-testid="devbox-remote-check-fail"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" aria-hidden />
                        <span className="truncate" title={check.error}>
                          {t('devboxPage.remoteCheckFail', { error: check.error })}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {(connection?.endpoints.length ?? 0) > 1 && (
                <div className="flex shrink-0 flex-col rounded-lg border border-white/[0.08] bg-white/[0.02]">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-2.5 py-2 text-left text-2xs uppercase tracking-wider text-slate-400 hover:text-slate-300"
                    data-testid="devbox-remote-endpoints-toggle"
                    onClick={() => setEndpointsOpen(v => !v)}
                  >
                    {endpointsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {t('devboxPage.remoteOtherEndpoints')}
                  </button>
                  {endpointsOpen && (
                    <div
                      className="flex flex-col gap-1.5 border-t border-white/[0.06] p-2.5"
                      data-testid="devbox-remote-endpoints"
                    >
                      {connection?.endpoints.slice(1).map(endpoint => (
                        <div key={endpoint.id} className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-2xs text-slate-300">{endpoint.id}</span>
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-2xs text-slate-400"
                            title={endpoint.url}
                          >
                            {endpoint.url}
                          </span>
                          <Button
                            size="xs"
                            variant="ghost"
                            leftIcon={
                              remoteCopied === `url-${endpoint.id}` ? <Check size={12} /> : <Copy size={12} />
                            }
                            data-testid={`devbox-remote-copy-url-${endpoint.id}`}
                            onClick={() => void copyRemote(`url-${endpoint.id}`, endpoint.url)}
                          >
                            {remoteCopied === `url-${endpoint.id}`
                              ? t('devboxPage.remoteCopied')
                              : t('devboxPage.remoteCopyUrl')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {copyDisabled ? blockingAlert : null}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="shrink-0" data-testid="devbox-prompt-tabs">
                <SegmentedControl
                  size="sm"
                  value={tab}
                  onChange={value => setTab(value === 'prompt' ? 'prompt' : 'editor')}
                  options={[
                    { value: 'editor', label: t('devboxPage.promptTabEditor') },
                    { value: 'prompt', label: t('devboxPage.promptTabPrompt') },
                  ]}
                />
              </div>
              {tab === 'editor' ? (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <Select
                    label={t('devboxPage.promptClientLabel')}
                    options={clientOptions}
                    value={client}
                    containerClassName="shrink-0"
                    data-testid="devbox-prompt-client"
                    onValueChange={value => {
                      clientRef.current = value;
                      setClient(value);
                      load(false);
                    }}
                  />

                  <Textarea
                    value={task}
                    placeholder={t('devboxPage.promptTaskPlaceholder')}
                    data-testid="devbox-prompt-task"
                    containerClassName="min-h-0"
                    shellClassName="flex flex-col"
                    className="min-h-[200px] max-h-[420px] resize-y overflow-y-auto placeholder:text-slate-400"
                    onChange={e => {
                      taskRef.current = e.target.value;
                      setTask(e.target.value);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        if (!copyDisabled) void copy();
                      }
                    }}
                  />

                  {acceptanceOpen && (
                    <div
                      className="shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]"
                      data-testid="devbox-prompt-acceptance-panel"
                    >
                      <div className="border-b border-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-slate-300">
                        {t('devboxPage.promptCriteriaHeader')}
                      </div>
                      <Textarea
                        rows={3}
                        className="min-h-0 text-xs placeholder:text-slate-400"
                        shellClassName="rounded-none border-0 bg-transparent"
                        value={acceptance}
                        placeholder={t('devboxPage.promptAcceptancePlaceholder')}
                        data-testid="devbox-prompt-acceptance"
                        onChange={e => {
                          acceptanceRef.current = e.target.value;
                          setAcceptance(e.target.value);
                        }}
                      />
                    </div>
                  )}

                  {copyDisabled
                    ? blockingAlert
                    : !ready.runner
                      ? alertPlate(
                          'devbox-prompt-runner-warning',
                          t('devboxPage.promptRunnerDownHint'),
                        )
                      : null}

                  {gatewayDown
                    ? alertPlate(
                        'devbox-prompt-gateway-warning',
                        t('devboxPage.gatewayWarnChip'),
                      )
                    : null}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {data.masked && (
                      <Badge
                        variant="info"
                        size="sm"
                        className="normal-case tracking-normal"
                        data-testid="devbox-prompt-preview-locked"
                      >
                        <Lock size={12} aria-hidden />
                        {t('devboxPage.promptPreviewLocked')}
                      </Badge>
                    )}
                    {manualCopy && (
                      <span className="text-xs text-red-300" data-testid="devbox-prompt-manual-copy">
                        {t('devboxPage.promptManualCopy')}
                      </span>
                    )}
                  </div>
                  <pre
                    data-testid="devbox-prompt-preview"
                    className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap break-words"
                  >
                    {data.prompt}
                  </pre>
                </div>
              )}
            </div>
          )}

          {mode === 'sandbox' && stale && (
            <span
              className="text-xs text-amber-300 shrink-0"
              data-testid="devbox-prompt-stale"
            >
              {t('devboxPage.promptStale')}
            </span>
          )}

          <div
            className="flex shrink-0 items-start justify-between gap-3"
            data-testid="devbox-prompt-footer"
          >
            {mode === 'sandbox' ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="xs"
                    variant={acceptanceOpen ? 'secondary' : 'ghost'}
                    leftIcon={acceptanceOpen ? <X size={12} /> : <Plus size={12} />}
                    data-testid="devbox-prompt-acceptance-toggle"
                    onClick={() => setAcceptanceOpen(v => !v)}
                  >
                    {acceptanceOpen
                      ? t('devboxPage.promptCriteriaClose')
                      : t('devboxPage.promptCriteria')}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    leftIcon={revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                    data-testid="devbox-prompt-reveal"
                    onClick={() => load(!revealed)}
                  >
                    {t('devboxPage.promptTokens')}
                  </Button>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {copyDisabled ? (
                    <Tooltip
                      content={t('devboxPage.promptBlockedTip', {
                        fix: blockingLabels.join(' · '),
                      })}
                    >
                      {copyButton}
                    </Tooltip>
                  ) : (
                    copyButton
                  )}
                  <span
                    className="max-w-[320px] text-right text-2xs text-slate-500"
                    data-testid="devbox-prompt-hint"
                  >
                    {clientHint}
                  </span>
                </div>
              </>
            ) : (
              <span
                className="max-w-[480px] text-2xs text-slate-500"
                data-testid="devbox-remote-footer-hint"
              >
                {t('devboxPage.remoteFooterHint')}
              </span>
            )}
          </div>
        </div>
      )}
    </DevboxSection>
  );
}
