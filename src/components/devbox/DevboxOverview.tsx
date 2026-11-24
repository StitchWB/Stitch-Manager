import { useMemo } from 'react';
import { Activity, Copy, Play, Power, RefreshCw } from 'lucide-react';
import { Alert, type AlertVariant } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { formatTime } from '@/lib/utils';
import {
  devboxTime,
  type DevboxEventRow,
  type DevboxObserved,
  type DevboxOverviewGateway,
  type DevboxPermissionRow,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { devboxEventLine } from './eventLine';
import { devboxIngressModeLabel } from './labels';
import { DEVBOX_TOTAL_TOOLS, type DevboxTab, type UseDevboxConnectResult } from './useDevboxConnect';

type HeroVariant = 'ok' | 'plugin' | 'stack' | 'bridge' | 'blocked' | 'fallback' | 'session';

interface HeroCopy {
  titleKey: string;
  subKey: string;
  stateKey: string;
  alertTitleKey: string;
  alertTextKey: string;
  actionKey: string;
  badgeVariant: NonNullable<React.ComponentProps<typeof Badge>['variant']>;
  alertVariant: AlertVariant;
}

const HERO_COPY: Record<HeroVariant, HeroCopy> = {
  plugin: {
    titleKey: 'devboxPage.overviewHeroPluginTitle',
    subKey: 'devboxPage.overviewHeroPluginSub',
    stateKey: 'devboxPage.overviewHeroPluginState',
    alertTitleKey: 'devboxPage.overviewHeroPluginAlertTitle',
    alertTextKey: 'devboxPage.overviewHeroPluginAlertText',
    actionKey: 'devboxPage.overviewHeroPluginAction',
    badgeVariant: 'danger',
    alertVariant: 'danger',
  },
  ok: {
    titleKey: 'devboxPage.overviewHeroOkTitle',
    subKey: 'devboxPage.overviewHeroOkSub',
    stateKey: 'devboxPage.overviewHeroOkState',
    alertTitleKey: 'devboxPage.overviewHeroOkAlertTitle',
    alertTextKey: 'devboxPage.overviewHeroOkAlertText',
    actionKey: 'devboxPage.overviewHeroOkAction',
    badgeVariant: 'success',
    alertVariant: 'success',
  },
  stack: {
    titleKey: 'devboxPage.overviewHeroStackTitle',
    subKey: 'devboxPage.overviewHeroStackSub',
    stateKey: 'devboxPage.overviewHeroStackState',
    alertTitleKey: 'devboxPage.overviewHeroStackAlertTitle',
    alertTextKey: 'devboxPage.overviewHeroStackAlertText',
    actionKey: 'devboxPage.overviewHeroStackAction',
    badgeVariant: 'danger',
    alertVariant: 'danger',
  },
  bridge: {
    titleKey: 'devboxPage.overviewHeroBridgeTitle',
    subKey: 'devboxPage.overviewHeroBridgeSub',
    stateKey: 'devboxPage.overviewHeroBridgeState',
    alertTitleKey: 'devboxPage.overviewHeroBridgeAlertTitle',
    alertTextKey: 'devboxPage.overviewHeroBridgeAlertText',
    actionKey: 'devboxPage.overviewHeroBridgeAction',
    badgeVariant: 'warning',
    alertVariant: 'warning',
  },
  blocked: {
    titleKey: 'devboxPage.overviewHeroBlockedTitle',
    subKey: 'devboxPage.overviewHeroBlockedSub',
    stateKey: 'devboxPage.overviewHeroBlockedState',
    alertTitleKey: 'devboxPage.overviewHeroBlockedAlertTitle',
    alertTextKey: 'devboxPage.overviewHeroBlockedAlertText',
    actionKey: 'devboxPage.overviewHeroBlockedAction',
    badgeVariant: 'warning',
    alertVariant: 'warning',
  },
  fallback: {
    titleKey: 'devboxPage.overviewHeroFallbackTitle',
    subKey: 'devboxPage.overviewHeroFallbackSub',
    stateKey: 'devboxPage.overviewHeroFallbackState',
    alertTitleKey: 'devboxPage.overviewHeroFallbackAlertTitle',
    alertTextKey: 'devboxPage.overviewHeroFallbackAlertText',
    actionKey: 'devboxPage.overviewHeroFallbackAction',
    badgeVariant: 'warning',
    alertVariant: 'warning',
  },
  session: {
    titleKey: 'devboxPage.overviewHeroSessionTitle',
    subKey: 'devboxPage.overviewHeroSessionSub',
    stateKey: 'devboxPage.overviewHeroSessionState',
    alertTitleKey: 'devboxPage.overviewHeroSessionAlertTitle',
    alertTextKey: 'devboxPage.overviewHeroSessionAlertText',
    actionKey: 'devboxPage.overviewHeroSessionAction',
    badgeVariant: 'warning',
    alertVariant: 'warning',
  },
};

function Metric({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2" data-testid={testId}>
      <p className="text-2xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="truncate text-xs font-medium text-slate-200">{value}</p>
    </div>
  );
}

export interface DevboxOverviewProps {
  connect: UseDevboxConnectResult;
  gateway: DevboxOverviewGateway | null;
  permissions: DevboxObserved<DevboxPermissionRow> | null;
  events: DevboxEventRow[];
  busy: boolean;
  pollError: string | null;
  onOpenTab: (tab: DevboxTab) => void;
  onConfigureMcp: () => void;
  onRefresh: () => void;
}

export function DevboxOverview({
  connect,
  gateway,
  permissions,
  events,
  busy,
  pollError,
  onOpenTab,
  onConfigureMcp,
  onRefresh,
}: DevboxOverviewProps) {
  const { copy } = useCopyToClipboard();

  const heroVariant = useMemo<HeroVariant>(() => {
    if (connect.stackState === 'unknown' && pollError !== null) return 'plugin';
    if (connect.resolvedUrl === '') return 'blocked';
    if (connect.stackState === 'down' || connect.stackState === 'unknown') return 'stack';
    if (connect.bridgeState !== 'healthy') return 'bridge';
    if (connect.handoffStale || connect.connectionStale) return 'session';
    if (connect.fallbackActive) return 'fallback';
    if (connect.probeOk) return 'ok';
    return 'bridge';
  }, [
    connect.resolvedUrl,
    connect.stackState,
    connect.bridgeState,
    connect.handoffStale,
    connect.connectionStale,
    connect.fallbackActive,
    connect.probeOk,
    pollError,
  ]);

  const hero = HERO_COPY[heroVariant];
  const modeLabel = devboxIngressModeLabel(connect.effectiveMode);
  const reason =
    connect.blockedReason ??
    (heroVariant === 'fallback'
      ? connect.savedPublicUrl
      : t('devboxPage.overviewEndpointMissing'));
  const heroSub =
    heroVariant === 'blocked' || heroVariant === 'fallback'
      ? t(hero.subKey, { mode: modeLabel, reason })
      : t(hero.subKey);
  const heroAlertText =
    heroVariant === 'blocked'
      ? t(hero.alertTextKey, { reason })
      : heroVariant === 'plugin' && pollError !== null
        ? t(hero.alertTextKey, { error: pollError })
        : t(hero.alertTextKey);

  const approvalCount = permissions?.rows.length ?? 0;
  const mcpCount = gateway?.exposed_mcps.length ?? 0;
  const recentEvents = useMemo(() => events.slice(-5).reverse(), [events]);
  const startDisabled = busy || connect.activeProfile === '';

  const copyEndpoint = () => {
    if (connect.resolvedUrl === '') return;
    void copy(connect.resolvedUrl, { successMessage: t('devboxPage.overviewEndpointCopy') });
  };

  const copyHandoff = async () => {
    try {
      const block = await connect.ensureHandoffRevealed();
      await copy(block, { sensitive: true, successMessage: t('devboxPage.connectHandoffCopied') });
    } catch (err) {
      appToast.error(err instanceof Error ? err.message : t('devboxPage.connectHandoffError'));
    }
  };

  const onHeroAction = () => {
    if (heroVariant === 'ok') {
      void connect.runCheck();
      return;
    }
    if (heroVariant === 'plugin') {
      onRefresh();
      return;
    }
    if (heroVariant === 'stack' || heroVariant === 'bridge') {
      connect.startStack();
      return;
    }
    if (heroVariant === 'session') {
      void copyHandoff();
      return;
    }
    onOpenTab('connect');
  };

  const probeValue =
    connect.probe === null
      ? t('devboxPage.overviewProbeNone')
      : connect.probeStale
        ? t('devboxPage.overviewProbeStale')
        : t('devboxPage.overviewProbeFresh', { at: formatTime(connect.probe.checkedAt) });

  return (
    <div className="flex flex-col gap-4" data-testid="devbox-overview">
      <GlassCard className="p-4" data-testid="devbox-overview-hero">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wider text-slate-500" data-testid="devbox-overview-eyebrow">
              {t('devboxPage.overviewEyebrow')}
            </p>
            <h2 className="text-lg font-semibold text-white" data-testid="devbox-overview-hero-title">
              {t(hero.titleKey)}
            </h2>
            <p className="text-xs text-slate-400" data-testid="devbox-overview-hero-sub">
              {heroSub}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={hero.badgeVariant} data-testid="devbox-overview-hero-state">
              {t(hero.stateKey)}
            </Badge>
            <Button
              size="sm"
              variant={heroVariant === 'ok' ? 'secondary' : 'primary'}
              disabled={busy || (heroVariant === 'stack' || heroVariant === 'bridge' ? startDisabled : false)}
              data-testid="devbox-overview-hero-action"
              onClick={onHeroAction}
            >
              {t(hero.actionKey)}
            </Button>
          </div>
        </div>
        {heroVariant !== 'ok' && (
          <div className="mt-3" data-testid="devbox-overview-hero-alert">
            <Alert variant={hero.alertVariant} title={t(hero.alertTitleKey)} message={heroAlertText} />
          </div>
        )}
      </GlassCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4 xl:col-span-2">
          <GlassCard className="p-4" data-testid="devbox-overview-endpoint">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wider text-slate-500">
                  {t('devboxPage.overviewEndpointLabel', { mode: modeLabel })}
                </p>
                <p
                  className="break-all font-mono text-xs text-slate-200"
                  data-testid="devbox-overview-endpoint-url"
                >
                  {connect.resolvedUrl === '' ? t('devboxPage.overviewEndpointMissing') : connect.resolvedUrl}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <IconButton
                  size="md"
                  variant="ghost"
                  tooltip={t('devboxPage.overviewEndpointCopy')}
                  aria-label={t('devboxPage.overviewEndpointCopy')}
                  disabled={connect.resolvedUrl === ''}
                  data-testid="devbox-overview-copy-endpoint"
                  onClick={copyEndpoint}
                >
                  <Copy size={16} />
                </IconButton>
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={connect.checking}
                  disabled={busy}
                  data-testid="devbox-overview-check"
                  onClick={() => void connect.runCheck()}
                >
                  {connect.checking ? t('devboxPage.overviewChecking') : t('devboxPage.overviewCheck')}
                </Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label={t('devboxPage.overviewToolsLabel')}
                value={t('devboxPage.overviewToolsValue', { count: connect.tools, total: DEVBOX_TOTAL_TOOLS })}
                testId="devbox-overview-tools"
              />
              <Metric
                label={t('devboxPage.overviewLatencyLabel')}
                value={
                  connect.latency === null
                    ? t('devboxPage.overviewLatencyNone')
                    : t('devboxPage.overviewLatencyValue', { ms: connect.latency })
                }
                testId="devbox-overview-latency"
              />
              <Metric label={t('devboxPage.overviewModeLabel')} value={modeLabel} testId="devbox-overview-mode" />
              <Metric label={t('devboxPage.overviewCheck')} value={probeValue} testId="devbox-overview-probe" />
            </div>
          </GlassCard>

          <DevboxSection
            title={t('devboxPage.overviewNextTitle')}
            caption={t('devboxPage.overviewNextEta')}
            testId="devbox-overview-next"
            actions={
              <Button
                size="xs"
                variant="secondary"
                data-testid="devbox-overview-show-handoff"
                onClick={() => onOpenTab('connect')}
              >
                {t('devboxPage.overviewShowHandoff')}
              </Button>
            }
          >
            <ol className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-overview-next-1">
                <p className="text-xs font-medium text-white">{t('devboxPage.overviewNextStep1Title')}</p>
                <p className="text-2xs text-slate-400">{t('devboxPage.overviewNextStep1Text')}</p>
              </li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-overview-next-2">
                <p className="text-xs font-medium text-white">{t('devboxPage.overviewNextStep2Title')}</p>
                <p className="text-2xs text-slate-400">{t('devboxPage.overviewNextStep2Text')}</p>
              </li>
              <li className="rounded-lg border border-white/10 bg-white/[0.02] p-3" data-testid="devbox-overview-next-3">
                <p className="text-xs font-medium text-white">{t('devboxPage.overviewNextStep3Title')}</p>
                <p className="text-2xs text-slate-400">{t('devboxPage.overviewNextStep3Text')}</p>
              </li>
            </ol>
          </DevboxSection>

          <DevboxSection
            title={t('devboxPage.overviewStackTitle')}
            caption={t('devboxPage.overviewStackHint')}
            testId="devbox-overview-stack"
            actions={
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {connect.stackState === 'healthy' ? (
                  <>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={startDisabled}
                      leftIcon={<RefreshCw size={12} />}
                      data-testid="devbox-overview-restart-stack"
                      onClick={connect.startStack}
                    >
                      {t('devboxPage.overviewRestartStack')}
                    </Button>
                    <ConfirmActionButton
                      size="xs"
                      variant="danger"
                      disabled={busy}
                      leftIcon={<Power size={12} />}
                      data-testid="devbox-overview-stop-stack"
                      onConfirm={connect.stopStack}
                    >
                      {t('devboxPage.overviewStopStack')}
                    </ConfirmActionButton>
                  </>
                ) : (
                  <Button
                    size="xs"
                    variant="primary"
                    disabled={startDisabled}
                    leftIcon={<Play size={12} />}
                    data-testid="devbox-overview-start-stack"
                    onClick={connect.startStack}
                  >
                    {t('devboxPage.overviewStartStack')}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  data-testid="devbox-overview-open-services"
                  onClick={() => onOpenTab('services')}
                >
                  {t('devboxPage.overviewOpenServices')}
                </Button>
              </div>
            }
          >
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={connect.bridgeState === 'healthy' ? 'success' : 'danger'}
                data-testid="devbox-overview-pill-bridge"
              >
                {t('devboxPage.overviewPillBridge')} ·{' '}
                {connect.bridgeState === 'healthy'
                  ? t('devboxPage.overviewBridgeReady')
                  : t('devboxPage.overviewBridgeStopped')}
              </Badge>
              <Badge variant={connect.probeOk ? 'success' : 'warning'} data-testid="devbox-overview-pill-path">
                {t('devboxPage.overviewPillPath')} ·{' '}
                {connect.probeOk ? t('devboxPage.overviewFocusOnline') : t('devboxPage.overviewFocusStopped')}
              </Badge>
              <Badge
                variant={connect.handoffStale ? 'warning' : 'success'}
                data-testid="devbox-overview-pill-session"
              >
                {t('devboxPage.overviewPillSession')} ·{' '}
                {connect.handoffStale
                  ? t('devboxPage.overviewSessionStale')
                  : t('devboxPage.overviewFocusReady')}
              </Badge>
            </div>
          </DevboxSection>

          <DevboxSection
            title={t('devboxPage.overviewActivityTitle')}
            testId="devbox-overview-activity"
            actions={
              <Button
                size="xs"
                variant="ghost"
                data-testid="devbox-overview-all-events"
                onClick={() => onOpenTab('logs')}
              >
                {t('devboxPage.overviewAllEvents')}
              </Button>
            }
          >
            {recentEvents.length === 0 ? (
              <EmptyState compact icon={Activity} title={t('devboxPage.overviewActivityEmpty')} />
            ) : (
              <ul className="flex flex-col gap-1" data-testid="devbox-overview-activity-list">
                {recentEvents.map((row, index) => (
                  <li
                    key={`${String(row.ts ?? index)}-${index}`}
                    className="flex items-center justify-between gap-2 rounded border border-white/5 bg-white/[0.02] px-2 py-1"
                  >
                    <span className="min-w-0 truncate text-2xs text-slate-300">{devboxEventLine(row)}</span>
                    <span className="shrink-0 text-2xs text-slate-500">{devboxTime(row.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </DevboxSection>
        </div>

        <div className="flex flex-col gap-4">
          <DevboxSection title={t('devboxPage.overviewQuickTitle')} testId="devbox-overview-quick">
            <div className="flex flex-col gap-2">
              <div
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                data-testid="devbox-overview-quick-agent"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-white">{t('devboxPage.overviewQuickAgent')}</p>
                  <p className="text-2xs text-slate-400">
                    {t('devboxPage.overviewQuickApprovals', { count: approvalCount })}
                  </p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => onOpenTab('agent')}>
                  {t('devboxPage.overviewOpenAgent')}
                </Button>
              </div>
              <div
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                data-testid="devbox-overview-quick-mcp"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-white">{t('devboxPage.overviewQuickMcp')}</p>
                  <p className="text-2xs text-slate-400">
                    {t('devboxPage.overviewQuickMcpCount', { count: mcpCount })}
                  </p>
                </div>
                <Button size="xs" variant="ghost" onClick={onConfigureMcp}>
                  {t('devboxPage.overviewConfigureMcp')}
                </Button>
              </div>
              <div
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                data-testid="devbox-overview-quick-tokens"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-white">{t('devboxPage.overviewQuickTokens')}</p>
                  <p className="text-2xs text-slate-400">{t('devboxPage.overviewQuickTokensDesc')}</p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => onOpenTab('connect')}>
                  {t('devboxPage.overviewOpenConnect')}
                </Button>
              </div>
            </div>
          </DevboxSection>

        </div>
      </div>
    </div>
  );
}
