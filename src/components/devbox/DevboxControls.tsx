import { ExternalLink, Play, Power } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { Toggle } from '@/components/ui/Toggle';
import { Tooltip } from '@/components/ui/Tooltip';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import {
  devboxCockpitOpen,
  devboxIngressControl,
  devboxIssueTokens,
  devboxLatestFinishedPayload,
  devboxRunDoctor,
  devboxStackDown,
  devboxStackFullDown,
  devboxTime,
  devboxVitalValue,
  devboxWatchdogControl,
  type DevboxAccepted,
  type DevboxActionStatus,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

export interface DevboxControlsProps {
  overviewCards: DevboxVitalCard[] | null;
  actionStatus: DevboxActionStatus | null;
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
}

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function DevboxControls({
  overviewCards,
  actionStatus,
  busy,
  onAction,
}: DevboxControlsProps) {
  const recent = actionStatus?.recent;
  const ingressUp = devboxVitalValue(overviewCards, 'ingress') === 'up';
  const watchdogValue = devboxVitalValue(overviewCards, 'watchdog');
  const watchdogOn = watchdogValue === 'on' || watchdogValue === 'up' || watchdogValue === 'true';

  const chatBlock = payloadString(devboxLatestFinishedPayload(recent, 'issue_tokens'), 'chatBlock');
  const doctorReport = payloadString(devboxLatestFinishedPayload(recent, 'run_doctor'), 'report');
  const cockpitUrl = payloadString(devboxLatestFinishedPayload(recent, 'cockpit_open'), 'url');

  const copyChatBlock = async () => {
    if (!chatBlock) return;
    try {
      await navigator.clipboard.writeText(chatBlock);
      appToast.success(t('pluginUi.copied'));
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
    }
  };

  const current = actionStatus?.current;

  return (
    <DevboxSection title={t('devboxPage.sectionControls')} testId="devbox-controls">
      <div className="flex flex-col gap-4">
        {busy && current && (
          <div className="flex items-center gap-2 text-2xs text-slate-400" data-testid="devbox-progress">
            <LoadingSpinner size="xs" />
            <span>
              {t('devboxPage.progress', {
                cmd: current.cmd,
                time: devboxTime(current.startedAt),
              })}
            </span>
          </div>
        )}

        {!chatBlock && (
          <p className="text-2xs text-slate-400" data-testid="devbox-next-steps">
            {t('devboxPage.nextStepsHint')}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <ConfirmActionButton
            size="sm"
            variant="secondary"
            disabled={busy}
            leftIcon={<Power size={14} />}
            data-testid="devbox-control-stop-services"
            tooltip={t('devboxPage.tipStopServices')}
            onConfirm={() => onAction(devboxStackDown())}
          >
            {t('devboxPage.controlStopServices')}
          </ConfirmActionButton>
          <ConfirmActionButton
            size="sm"
            variant="danger"
            disabled={busy}
            leftIcon={<Power size={14} />}
            data-testid="devbox-control-stop-all"
            tooltip={t('devboxPage.tipStopAll')}
            onConfirm={() => onAction(devboxStackFullDown())}
          >
            {t('devboxPage.controlStopAll')}
          </ConfirmActionButton>
          <ConfirmActionButton
            size="sm"
            variant="secondary"
            disabled={busy}
            data-testid="devbox-control-tokens"
            tooltip={t('devboxPage.tipRotateTokens')}
            onConfirm={() => onAction(devboxIssueTokens())}
          >
            {t('devboxPage.controlTokens')}
          </ConfirmActionButton>
          <Tooltip content={t('devboxPage.tipDoctor')}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="devbox-control-doctor"
              onClick={() => onAction(devboxRunDoctor())}
            >
              {t('devboxPage.controlDoctor')}
            </Button>
          </Tooltip>
          <Tooltip content={t('devboxPage.tipIngress')}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !overviewCards}
              data-testid="devbox-control-ingress"
              onClick={() => onAction(devboxIngressControl(ingressUp ? 'down' : 'up'))}
            >
              {ingressUp ? t('devboxPage.controlIngressOn') : t('devboxPage.controlIngressOff')}
            </Button>
          </Tooltip>
          <Toggle
            size="sm"
            label={t('devboxPage.controlWatchdog')}
            tooltip={t('devboxPage.tipWatchdog')}
            checked={watchdogOn}
            disabled={busy}
            onChange={next => onAction(devboxWatchdogControl(next ? 'start' : 'stop'))}
          />
          <Tooltip content={t('devboxPage.tipCockpit')}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              leftIcon={<Play size={14} />}
              data-testid="devbox-control-cockpit"
              onClick={() => onAction(devboxCockpitOpen())}
            >
              {t('devboxPage.controlCockpit')}
            </Button>
          </Tooltip>
        </div>

        {chatBlock && (
          <div className="flex flex-col gap-2" data-testid="devbox-chat-block">
            <span className="text-2xs uppercase tracking-wider text-slate-400">
              {t('devboxPage.chatBlockLabel')}
            </span>
            <Textarea
              readOnly
              rows={Math.min(8, chatBlock.split('\n').length + 1)}
              value={chatBlock}
              className="font-mono text-xs"
              data-testid="devbox-chat-block-text"
            />
            <Button
              size="xs"
              variant="secondary"
              className="self-start"
              data-testid="devbox-chat-block-copy"
              onClick={() => void copyChatBlock()}
            >
              {t('common.copy')}
            </Button>
          </div>
        )}

        {doctorReport && (
          <div className="flex flex-col gap-2">
            <span className="text-2xs uppercase tracking-wider text-slate-400">
              {t('devboxPage.doctorReportLabel')}
            </span>
            <pre
              data-testid="devbox-doctor-report"
              className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-2xs text-slate-300 whitespace-pre-wrap"
            >
              {doctorReport}
            </pre>
          </div>
        )}

        {cockpitUrl && (
          <div className="flex items-center gap-2">
            <span className="text-2xs uppercase tracking-wider text-slate-400">
              {t('devboxPage.cockpitUrlLabel')}
            </span>
            <Button
              size="xs"
              variant="ghost"
              data-testid="devbox-cockpit-url"
              rightIcon={<ExternalLink size={12} />}
              onClick={() => window.open(cockpitUrl, '_blank', 'noopener,noreferrer')}
            >
              {cockpitUrl}
            </Button>
          </div>
        )}
      </div>
    </DevboxSection>
  );
}
