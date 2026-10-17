import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Play,
  Plus,
  Power,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
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
  devboxIngressControl,
  devboxStackStart,
  devboxVitalValue,
  type DevboxAccepted,
  type DevboxActionStatus,
  type DevboxAgentPrompt as DevboxAgentPromptPayload,
  type DevboxAgentPromptReady,
  type DevboxProfileRow,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

const STALE_COMMAND_RE = /method not found|-32601/i;

const STALE_ROTATION_CMDS = new Set(['issue_tokens', 'ingress_control', 'stack_start']);

const COPY_FLASH_MS = 2000;

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
  actionStatus: DevboxActionStatus | null;
  onAction: (action: Promise<DevboxAccepted>) => void;
  reloadTick?: number;
}

type PromptTab = 'editor' | 'prompt';

export function DevboxPrompt({
  profiles,
  overviewCards,
  actionStatus,
  onAction,
  reloadTick = 0,
}: DevboxPromptProps) {
  const [data, setData] = useState<DevboxAgentPromptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [tab, setTab] = useState<PromptTab>('editor');
  const [manualCopy, setManualCopy] = useState(false);
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  const [task, setTask] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [client, setClient] = useState('universal');
  const [copied, setCopied] = useState<{ at: number; fingerprint: string } | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);
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
      size="md"
      disabled={copyDisabled}
      className={cn(
        copyFlash &&
          'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:border-emerald-400/60 hover:bg-emerald-500/25 hover:text-white',
      )}
      leftIcon={copyFlash ? <Check size={16} /> : <Copy size={16} />}
      data-testid="devbox-prompt-copy"
      onClick={() => void copy()}
    >
      {copyFlash ? t('devboxPage.promptCopied') : t('devboxPage.promptCopy')}
    </Button>
  );

  const alertPlate = (testId: string, text: string) => (
    <span
      className="flex shrink-0 items-center gap-1 self-start rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-2xs text-amber-200"
      data-testid={testId}
    >
      <AlertTriangle size={12} className="shrink-0" aria-hidden />
      {text}
    </span>
  );

  const blockingAlert = (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 self-start rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-2xs text-amber-200"
      data-testid="devbox-prompt-stack-warning"
    >
      <span className="flex items-center gap-1">
        <AlertTriangle size={12} className="shrink-0" aria-hidden />
        {t('devboxPage.promptStackDownWarning')}
      </span>
      {!ready.bridge && (
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
      {!ready.ingress && (
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
                containerClassName="min-h-0 flex-1"
                shellClassName="flex min-h-0 flex-1 flex-col"
                className="min-h-[160px] flex-1 resize-none overflow-y-auto"
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

              {copyDisabled
                ? blockingAlert
                : !ready.runner
                  ? alertPlate(
                      'devbox-prompt-runner-warning',
                      t('devboxPage.promptRunnerDownHint'),
                    )
                  : null}

              {acceptanceOpen && (
                <div
                  className="shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.02]"
                  data-testid="devbox-prompt-acceptance-panel"
                >
                  <div className="border-b border-white/[0.06] px-2.5 py-1.5 text-2xs font-medium text-slate-300">
                    {t('devboxPage.promptCriteriaHeader')}
                  </div>
                  <Textarea
                    rows={3}
                    className="min-h-0 text-xs"
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
                  <span className="text-2xs text-red-300" data-testid="devbox-prompt-manual-copy">
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

          {stale && (
            <span
              className="text-2xs text-amber-300 shrink-0"
              data-testid="devbox-prompt-stale"
            >
              {t('devboxPage.promptStale')}
            </span>
          )}

          <div
            className="flex shrink-0 items-start justify-between gap-3"
            data-testid="devbox-prompt-footer"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<Plus size={12} />}
                data-testid="devbox-prompt-acceptance-toggle"
                onClick={() => setAcceptanceOpen(v => !v)}
              >
                {t('devboxPage.promptCriteria')}
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
              <span className="text-2xs text-slate-500" data-testid="devbox-prompt-hint">
                {clientHint}
              </span>
            </div>
          </div>
        </div>
      )}
    </DevboxSection>
  );
}
