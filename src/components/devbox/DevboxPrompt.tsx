import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
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
  const [copied, setCopied] = useState<{ at: number; fingerprint: string } | null>(null);
  const revealedRef = useRef(false);
  const taskRef = useRef('');
  const acceptanceRef = useRef('');

  const load = useCallback((reveal: boolean) => {
    devboxAgentPrompt({
      task: taskRef.current,
      acceptance: acceptanceRef.current,
      reveal,
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
      payload = await devboxAgentPrompt({ task, acceptance, reveal: true });
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

  const scrollToProfiles = () => {
    document
      .querySelector('[data-testid="devbox-profiles"]')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const errorText =
    error !== null && STALE_COMMAND_RE.test(error) ? t('devboxPage.handoffErrorStale') : error;

  const chip = (
    id: string,
    ok: boolean,
    okLabel: string,
    actionLabel: string,
    variant: 'danger' | 'warning' | 'slate',
    onClick: () => void,
  ) =>
    ok ? (
      <Badge variant="success" size="sm" withDot data-testid={`devbox-prompt-chip-${id}`}>
        {okLabel}
      </Badge>
    ) : (
      <Badge
        variant={variant}
        size="sm"
        className="cursor-pointer"
        data-testid={`devbox-prompt-chip-${id}`}
        onClick={onClick}
      >
        {actionLabel}
      </Badge>
    );

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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="devbox-prompt-chips">
            {chip(
              'profile',
              ready.profile,
              t('devboxPage.promptChipProfile'),
              t('devboxPage.promptChipProfile'),
              'slate',
              scrollToProfiles,
            )}
            {chip(
              'bridge',
              ready.bridge,
              t('devboxPage.promptChipStack'),
              t('devboxPage.promptChipStackStart'),
              'danger',
              () => onAction(devboxStackStart(activeProfileName, false)),
            )}
            {chip(
              'ingress',
              ready.ingress,
              t('devboxPage.promptChipIngress'),
              t('devboxPage.promptChipIngressUp'),
              'danger',
              () => onAction(devboxIngressControl('up')),
            )}
            {chip(
              'runner',
              ready.runner,
              t('devboxPage.promptChipRunner'),
              t('devboxPage.restart'),
              'warning',
              () => onAction(devboxStackStart(activeProfileName, false)),
            )}
          </div>

          <Textarea
            rows={3}
            value={task}
            placeholder={t('devboxPage.promptTaskPlaceholder')}
            data-testid="devbox-prompt-task"
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

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="ghost"
              data-testid="devbox-prompt-acceptance-toggle"
              onClick={() => setAcceptanceOpen(v => !v)}
            >
              {t('devboxPage.promptAcceptanceToggle')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              leftIcon={revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              data-testid="devbox-prompt-reveal"
              onClick={() => load(!revealed)}
            >
              {revealed ? t('devboxPage.promptHide') : t('devboxPage.promptReveal')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              data-testid="devbox-prompt-preview-toggle"
              onClick={() => setPreviewOpen(v => !v)}
            >
              {previewOpen
                ? t('devboxPage.promptPreviewHide')
                : t('devboxPage.promptPreviewShow')}
            </Button>
          </div>

          {acceptanceOpen && (
            <Textarea
              rows={2}
              className="min-h-[48px] text-xs"
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
            <span className="text-2xs text-amber-300" data-testid="devbox-prompt-stale">
              {t('devboxPage.promptStale')}
            </span>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {copyDisabled ? (
              <Tooltip
                content={t('devboxPage.promptBlockedTip', { fix: blockingLabels.join(' · ') })}
              >
                {copyButton}
              </Tooltip>
            ) : (
              copyButton
            )}
          </div>

          {previewOpen && (
            <div className="flex flex-col gap-2">
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
