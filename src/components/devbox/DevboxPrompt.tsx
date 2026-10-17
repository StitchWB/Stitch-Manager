import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, FileText, Plus, RefreshCw, RotateCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  const [task, setTask] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [client, setClient] = useState('universal');
  const [copied, setCopied] = useState<{ at: number; fingerprint: string } | null>(null);
  const revealedRef = useRef(false);
  const taskRef = useRef('');
  const acceptanceRef = useRef('');
  const clientRef = useRef('universal');

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
      appToast.success(t('pluginUi.copied'));
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
      setData(payload);
      setRevealed(true);
      revealedRef.current = true;
      setPreviewOpen(true);
      setManualCopy(true);
    }
  };

  const errorText =
    error !== null && STALE_COMMAND_RE.test(error) ? t('devboxPage.handoffErrorStale') : error;

  const actionChip = (
    id: string,
    ok: boolean,
    okLabel: string,
    actionLabel: string,
    onClick: () => void,
  ) =>
    ok ? (
      <Badge variant="success" size="sm" withDot data-testid={`devbox-prompt-chip-${id}`}>
        {okLabel}
      </Badge>
    ) : (
      <Badge
        variant="danger"
        size="sm"
        withDot
        className="cursor-pointer"
        data-testid={`devbox-prompt-chip-${id}`}
        onClick={onClick}
      >
        {actionLabel}
      </Badge>
    );

  const clientOptions = [
    { value: 'universal', label: t('devboxPage.promptClientUniversal') },
    ...AGENT_CLIENTS.map(([value, label]) => ({ value, label })),
  ];

  const copyButton = (
    <Button
      variant="primary"
      size="md"
      disabled={copyDisabled}
      leftIcon={<Copy size={16} />}
      data-testid="devbox-prompt-copy"
      onClick={() => void copy()}
    >
      {t('devboxPage.promptCopy')}
    </Button>
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
          <div
            className="flex flex-wrap items-center gap-2 shrink-0"
            data-testid="devbox-prompt-chips"
          >
            <Tooltip content={t('devboxPage.promptChipProfileTip')}>
              <Badge
                variant={ready.profile ? 'success' : 'slate'}
                size="sm"
                withDot
                data-testid="devbox-prompt-chip-profile"
              >
                {t('devboxPage.promptChipProfile')}
              </Badge>
            </Tooltip>
            {actionChip(
              'bridge',
              ready.bridge,
              t('devboxPage.promptChipStack'),
              t('devboxPage.promptChipStackStart'),
              () => onAction(devboxStackStart(activeProfileName, false)),
            )}
            {actionChip(
              'ingress',
              ready.ingress,
              t('devboxPage.promptChipIngress'),
              t('devboxPage.promptChipIngressUp'),
              () => onAction(devboxIngressControl('up')),
            )}
            {ready.runner ? (
              <Badge variant="success" size="sm" withDot data-testid="devbox-prompt-chip-runner">
                {t('devboxPage.promptChipRunner')}
              </Badge>
            ) : (
              <Button
                size="xs"
                variant="outline"
                leftIcon={<RotateCw size={12} />}
                data-testid="devbox-prompt-runner-restart"
                onClick={() => onAction(devboxStackStart(activeProfileName, false))}
              >
                {t('devboxPage.restart')}
              </Button>
            )}
          </div>

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
            containerClassName="flex max-h-[40vh] min-h-[120px] flex-1 flex-col"
            shellClassName="flex min-h-0 flex-1 flex-col"
            className="min-h-0 flex-1 resize-none"
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
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
            <Button
              size="xs"
              variant="ghost"
              leftIcon={<FileText size={14} />}
              data-testid="devbox-prompt-preview-toggle"
              onClick={() => setPreviewOpen(v => !v)}
            >
              {t('devboxPage.promptPreview')}
            </Button>
            <span className="ml-auto flex items-center">
              {copyDisabled ? (
                <Tooltip
                  content={t('devboxPage.promptBlockedTip', { fix: blockingLabels.join(' · ') })}
                >
                  {copyButton}
                </Tooltip>
              ) : (
                copyButton
              )}
            </span>
          </div>

          {acceptanceOpen && (
            <Textarea
              rows={2}
              className="min-h-[48px] text-xs"
              containerClassName="shrink-0"
              value={acceptance}
              placeholder={t('devboxPage.promptAcceptancePlaceholder')}
              data-testid="devbox-prompt-acceptance"
              onChange={e => {
                acceptanceRef.current = e.target.value;
                setAcceptance(e.target.value);
              }}
            />
          )}

          {stale && (
            <span
              className="text-2xs text-amber-300 shrink-0"
              data-testid="devbox-prompt-stale"
            >
              {t('devboxPage.promptStale')}
            </span>
          )}

          {previewOpen && (
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {data.masked && (
                  <Badge variant="warning" size="sm" data-testid="devbox-prompt-preview-masked">
                    {t('devboxPage.promptPreviewMasked')}
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
                className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap break-words"
              >
                {data.prompt}
              </pre>
            </div>
          )}
        </div>
      )}
    </DevboxSection>
  );
}
