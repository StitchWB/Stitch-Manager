import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Eye, EyeOff, HelpCircle, KeyRound, RefreshCw, Save, Settings, ShieldCheck, Terminal } from 'lucide-react';
import { Alert, type AlertVariant } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { RadioCard } from '@/components/ui/RadioCard';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { Tooltip } from '@/components/ui/Tooltip';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { DevboxConnectionEndpoint } from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { devboxIngressModeLabel, devboxModeLabel } from './labels';
import {
  buildChatConfig,
  type DevboxAccessMode,
  type DevboxAgentLocation,
  type DevboxIngressMode,
  type UseDevboxConnectResult,
} from './useDevboxConnect';

interface ModeCopy {
  titleKey: string;
  descKey: string;
  kindKey: string;
  whenKey: string;
  tipKey: string;
  nowKey: string;
  needKey: string;
  flowKey: string;
}

interface AccessCopy {
  labelKey: string;
  hintKey: string;
  derivedKey: string;
}

const MODES: DevboxIngressMode[] = ['auto', 'cloudflare', 'relay', 'manual'];
const ACCESS_MODES: DevboxAccessMode[] = ['readonly', 'standard', 'full'];

const MODE_COPY: Record<DevboxIngressMode, ModeCopy> = {
  auto: {
    titleKey: 'devboxPage.connectModeAutoTitle',
    descKey: 'devboxPage.connectModeAutoDesc',
    kindKey: 'devboxPage.connectModeAutoKind',
    whenKey: 'devboxPage.connectModeAutoWhen',
    tipKey: 'devboxPage.connectModeAutoTip',
    nowKey: 'devboxPage.connectModeAutoNow',
    needKey: 'devboxPage.connectModeAutoNeed',
    flowKey: 'devboxPage.connectModeAutoFlow',
  },
  cloudflare: {
    titleKey: 'devboxPage.connectModeCloudflareTitle',
    descKey: 'devboxPage.connectModeCloudflareDesc',
    kindKey: 'devboxPage.connectModeCloudflareKind',
    whenKey: 'devboxPage.connectModeCloudflareWhen',
    tipKey: 'devboxPage.connectModeCloudflareTip',
    nowKey: 'devboxPage.connectModeCloudflareNow',
    needKey: 'devboxPage.connectModeCloudflareNeed',
    flowKey: 'devboxPage.connectModeCloudflareFlow',
  },
  relay: {
    titleKey: 'devboxPage.connectModeRelayTitle',
    descKey: 'devboxPage.connectModeRelayDesc',
    kindKey: 'devboxPage.connectModeRelayKind',
    whenKey: 'devboxPage.connectModeRelayWhen',
    tipKey: 'devboxPage.connectModeRelayTip',
    nowKey: 'devboxPage.connectModeRelayNow',
    needKey: 'devboxPage.connectModeRelayNeed',
    flowKey: 'devboxPage.connectModeRelayFlow',
  },
  manual: {
    titleKey: 'devboxPage.connectModeManualTitle',
    descKey: 'devboxPage.connectModeManualDesc',
    kindKey: 'devboxPage.connectModeManualKind',
    whenKey: 'devboxPage.connectModeManualWhen',
    tipKey: 'devboxPage.connectModeManualTip',
    nowKey: 'devboxPage.connectModeManualNow',
    needKey: 'devboxPage.connectModeManualNeed',
    flowKey: 'devboxPage.connectModeManualFlow',
  },
};

const ACCESS_COPY: Record<DevboxAccessMode, AccessCopy> = {
  readonly: {
    labelKey: 'devboxPage.connectAccessReadonly',
    hintKey: 'devboxPage.connectAccessReadonlyHint',
    derivedKey: 'devboxPage.connectAccessReadonlyDerived',
  },
  standard: {
    labelKey: 'devboxPage.connectAccessStandard',
    hintKey: 'devboxPage.connectAccessStandardHint',
    derivedKey: 'devboxPage.connectAccessStandardDerived',
  },
  full: {
    labelKey: 'devboxPage.connectAccessFull',
    hintKey: 'devboxPage.connectAccessFullHint',
    derivedKey: 'devboxPage.connectAccessFullDerived',
  },
};

function endpointLabel(id: string): string {
  if (id === 'bridge') return t('devboxPage.connectEndpointBridge');
  if (id === 'runner') return t('devboxPage.connectEndpointRunner');
  if (id === 'gateway') return t('devboxPage.connectEndpointGateway');
  return id;
}

function permissionLabel(value: string): string {
  if (value === 'deny') return t('devboxPage.connectPermDeny');
  if (value === 'ask') return t('devboxPage.connectPermAsk');
  return t('devboxPage.connectPermAllow');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface DevboxConnectProps {
  connect: UseDevboxConnectResult;
  busy: boolean;
}

export function DevboxConnect({ connect, busy }: DevboxConnectProps) {
  const { copy } = useCopyToClipboard();
  const [location, setLocation] = useState<DevboxAgentLocation>('sandbox');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const modeCopy = MODE_COPY[connect.draftMode];
  const relayUrl = connect.draft.RELAY_URL ?? connect.savedRelayUrl;
  const cloudflareIncomplete =
    connect.draftMode === 'cloudflare' &&
    ((connect.draft.PUBLIC_URL ?? '').trim() === '' ||
      ((connect.draft.TUNNEL_TOKEN ?? '').trim() === '' &&
        (connect.savedTunnelToken ?? '') === ''));
  const recommendedMode = connect.detection.recommendedMode;
  const detectionVariant: AlertVariant =
    connect.detection.messageKey === 'devboxPage.connectDetectOk'
      ? 'success'
      : connect.detection.messageKey === 'devboxPage.connectDetectFill'
        ? 'warning'
        : 'info';
  const chatAccessMode = connect.accessMode === 'custom' ? 'standard' : connect.accessMode;
  const endpoints = connect.connection?.endpoints ?? [];

  const permissionsPretty = useMemo(() => {
    if (connect.permissionsJson === '') return '';
    try {
      const parsed: unknown = JSON.parse(connect.permissionsJson);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return connect.permissionsJson;
    }
  }, [connect.permissionsJson]);

  const secretToggle = (key: string) => (
    <IconButton
      size="sm"
      variant="ghost"
      tooltip={revealed[key] ? t('devboxPage.connectTokenHide') : t('devboxPage.connectTokenReveal')}
      aria-label={revealed[key] ? t('devboxPage.connectTokenHide') : t('devboxPage.connectTokenReveal')}
      data-testid={`devbox-connect-toggle-${key}`}
      onClick={() => setRevealed(prev => ({ ...prev, [key]: !prev[key] }))}
    >
      {revealed[key] ? <EyeOff size={13} /> : <Eye size={13} />}
    </IconButton>
  );

  const revealHandoff = async () => {
    try {
      await connect.ensureHandoffRevealed();
    } catch (err) {
      appToast.error(errorMessage(err));
    }
  };

  const copyHandoff = async () => {
    try {
      const block = await connect.ensureHandoffRevealed();
      await copy(block, { sensitive: true, successMessage: t('devboxPage.connectHandoffCopied') });
    } catch (err) {
      appToast.error(errorMessage(err) || t('devboxPage.connectHandoffError'));
    }
  };

  const copyBootstrap = async () => {
    try {
      const result = await connect.ensureConnectionRevealed();
      if (result.bootstrap === '') throw new Error(t('devboxPage.connectHandoffEmpty'));
      await copy(result.bootstrap, { sensitive: true, successMessage: t('devboxPage.connectBootstrapCopied') });
    } catch (err) {
      appToast.error(errorMessage(err));
    }
  };

  const copyChatConfig = async () => {
    try {
      const result = await connect.ensureConnectionRevealed();
      const config = buildChatConfig(result.connection);
      if (config === '') throw new Error(t('devboxPage.connectHandoffEmpty'));
      await copy(config, { sensitive: true, successMessage: t('devboxPage.connectChatConfigCopied') });
    } catch (err) {
      appToast.error(errorMessage(err));
    }
  };

  const copyEndpoint = async (endpoint: DevboxConnectionEndpoint) => {
    try {
      const result = await connect.ensureConnectionRevealed();
      const fresh = result.connection?.endpoints.find(row => row.id === endpoint.id) ?? endpoint;
      await copy(`${fresh.url}\nAuthorization: Bearer ${fresh.token}`, {
        sensitive: true,
        successMessage: t('devboxPage.connectTokenCopied'),
      });
    } catch (err) {
      appToast.error(errorMessage(err));
    }
  };

  const copyToken = async (tokenId: string) => {
    try {
      const tokens = await connect.ensureTokensRevealed();
      const value = tokens[tokenId] ?? '';
      if (value === '') throw new Error(t('devboxPage.connectHandoffEmpty'));
      await copy(value, { sensitive: true, successMessage: t('devboxPage.connectTokenCopied') });
    } catch (err) {
      appToast.error(errorMessage(err));
    }
  };

  const toggleHandoff = () => {
    if (connect.handoffRevealed) {
      connect.hideHandoff();
      return;
    }
    void revealHandoff();
  };

  const statusAlert = () => {
    if (connect.checking) return <Alert variant="info" message={t('devboxPage.overviewChecking')} />;
    if (connect.probeStale) return <Alert variant="warning" message={t('devboxPage.overviewProbeStale')} />;
    if (connect.probeResult === null) return <Alert variant="info" message={t('devboxPage.overviewProbeNone')} />;
    if (connect.probeResult.ok) {
      const statusText = (code: number | undefined) =>
        code === undefined || code === 0 ? 'timeout/unreachable' : `HTTP ${code}`;
      const manifestBad =
        connect.probeResult.manifest_status !== undefined && connect.probeResult.manifest_status !== 200;
      const publicBad =
        connect.probeResult.public_status !== undefined && connect.probeResult.public_status !== 200;
      return (
        <div className="flex flex-col gap-2">
          <Alert
            variant="success"
            message={t('devboxPage.connectToolsOk', { tools: connect.tools, latency: connect.latency ?? 0 })}
          />
          {manifestBad && (
            <Alert
              variant="warning"
              message={t('devboxPage.connectManifestDown', { status: statusText(connect.probeResult.manifest_status) })}
            />
          )}
          {publicBad && (
            <Alert
              variant="warning"
              message={t('devboxPage.connectPublicUrlDown', { status: statusText(connect.probeResult.public_status) })}
            />
          )}
        </div>
      );
    }
    return (
      <Alert
        variant="danger"
        message={t('devboxPage.connectToolsFail', { error: connect.probeResult.error ?? '' })}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="devbox-connect">
      <DevboxSection
        title={t('devboxPage.connectTitle')}
        testId="devbox-connect-settings"
        error={connect.envError}
        onRetry={connect.reload}
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {connect.hasChanges && (
              <Badge variant="warning" size="sm" data-testid="devbox-connect-dirty">
                {t('devboxPage.connectDirty')}
              </Badge>
            )}
            {connect.saved && (
              <Badge variant="success" size="sm" data-testid="devbox-connect-saved">
                {t('devboxPage.connectSaved')}
              </Badge>
            )}
            <Button
              size="xs"
              variant="secondary"
              isLoading={connect.checking}
              disabled={busy}
              leftIcon={<ShieldCheck size={12} />}
              data-testid="devbox-connect-check"
              onClick={() => void connect.runCheck()}
            >
              {t('devboxPage.connectCheck')}
            </Button>
            <Button
              size="xs"
              variant="primary"
              disabled={!connect.hasChanges || connect.saving || busy}
              isLoading={connect.saving}
              leftIcon={<Save size={12} />}
              data-testid="devbox-connect-save"
              onClick={() => void connect.saveEnv()}
            >
              {t('devboxPage.connectSave')}
            </Button>
          </div>
        }
      >
        {connect.envLoading ? (
          <div className="p-4 text-center text-2xs text-slate-400" data-testid="devbox-connect-loading">
            {t('devboxPage.connectLoading')}
          </div>
        ) : connect.entries.length === 0 ? (
          <EmptyState
            compact
            icon={Settings}
            title={t('devboxPage.connectEmpty')}
            action={
              <Button size="xs" variant="secondary" data-testid="devbox-connect-retry" onClick={connect.reload}>
                {t('common.retry')}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            {connect.restartKinds.length > 0 && (
              <div data-testid="devbox-connect-restart">
                <Alert
                  variant="warning"
                  message={t('devboxPage.connectRestartHint')}
                  actions={
                    <>
                      {connect.restartKinds.includes('ingress') && (
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={busy}
                          leftIcon={<RefreshCw size={12} />}
                          data-testid="devbox-connect-restart-ingress"
                          onClick={connect.restartIngress}
                        >
                          {t('devboxPage.connectRestartIngress')}
                        </Button>
                      )}
                      {connect.restartKinds.includes('stack') && (
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={busy || connect.activeProfile === ''}
                          leftIcon={<RefreshCw size={12} />}
                          data-testid="devbox-connect-restart-stack"
                          onClick={connect.startStack}
                        >
                          {t('devboxPage.connectRestartStack')}
                        </Button>
                      )}
                    </>
                  }
                />
              </div>
            )}
            {connect.errors.length > 0 && (
              <div data-testid="devbox-connect-errors">
                <Alert
                  variant="danger"
                  title={t('devboxPage.connectErrorsTitle')}
                  message={
                    <ul className="list-disc space-y-0.5 pl-4">
                      {connect.errors.map((err, index) => (
                        <li key={`${err}-${index}`}>{err}</li>
                      ))}
                    </ul>
                  }
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="flex flex-col gap-4">
                <DevboxSection
                  title={t('devboxPage.connectDetectTitle')}
                  testId="devbox-connect-detect"
                  actions={
                    recommendedMode !== null ? (
                      <Button
                        size="xs"
                        variant="secondary"
                        disabled={busy || connect.saving}
                        data-testid="devbox-connect-apply-recommendation"
                        onClick={() => connect.setField('INGRESS_MODE', recommendedMode)}
                      >
                        {t('devboxPage.connectApplyRecommendation', {
                          mode: devboxIngressModeLabel(recommendedMode),
                        })}
                      </Button>
                    ) : undefined
                  }
                >
                  <Alert variant={detectionVariant} message={t(connect.detection.messageKey)} />
                </DevboxSection>

                <DevboxSection
                  title={t('devboxPage.connectFieldLocation')}
                  caption={t('devboxPage.connectFieldLocationHelp')}
                  testId="devbox-connect-location"
                >
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <RadioCard
                      selected={location === 'sandbox'}
                      onSelect={() => setLocation('sandbox')}
                      data-testid="devbox-connect-location-sandbox"
                      title={
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          {t('devboxPage.connectLocationSandboxTitle')}
                          <Badge size="sm" variant="indigo">
                            {t('devboxPage.connectLocationSandboxTag')}
                          </Badge>
                        </span>
                      }
                      description={
                        <span className="flex flex-col gap-1">
                          <span className="font-medium text-slate-300">
                            {t('devboxPage.connectLocationSandboxHead')}
                          </span>
                          <span>{t('devboxPage.connectLocationSandboxDesc')}</span>
                        </span>
                      }
                    />
                    <RadioCard
                      selected={location === 'chat'}
                      onSelect={() => setLocation('chat')}
                      data-testid="devbox-connect-location-chat"
                      title={
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          {t('devboxPage.connectLocationChatTitle')}
                          <Badge size="sm" variant="indigo">
                            {t('devboxPage.connectLocationChatTag')}
                          </Badge>
                        </span>
                      }
                      description={
                        <span className="flex flex-col gap-1">
                          <span className="font-medium text-slate-300">
                            {t('devboxPage.connectLocationChatHead')}
                          </span>
                          <span>{t('devboxPage.connectLocationChatDesc')}</span>
                        </span>
                      }
                    />
                  </div>
                  <div className="mt-3">
                    <Alert
                      variant="info"
                      message={
                        location === 'sandbox'
                          ? t('devboxPage.connectHintSandbox')
                          : t('devboxPage.connectHintChat')
                      }
                    />
                  </div>
                </DevboxSection>

                <DevboxSection
                  title={t('devboxPage.connectFieldIngress')}
                  caption={t('devboxPage.connectFieldIngressHelp')}
                  testId="devbox-connect-ingress"
                >
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {MODES.map(mode => {
                        const copyMode = MODE_COPY[mode];
                        return (
                          <div key={mode} className="relative">
                            <RadioCard
                              selected={connect.draftMode === mode}
                              onSelect={() => connect.setField('INGRESS_MODE', mode)}
                              disabled={busy || connect.saving}
                              data-testid={`devbox-connect-mode-${mode}`}
                              className="h-full"
                              title={
                                <span className="flex flex-wrap items-center gap-2 pr-6">
                                  {t(copyMode.titleKey)}
                                  {recommendedMode === mode && (
                                    <Badge size="sm" variant="success">
                                      {t('devboxPage.connectModeRecommended')}
                                    </Badge>
                                  )}
                                </span>
                              }
                              description={t(copyMode.descKey)}
                            />
                            <Tooltip
                              wrapperClassName="absolute right-1.5 top-1.5"
                              className="w-64 whitespace-normal text-left"
                              content={
                                <span
                                  className="flex flex-col gap-1"
                                  data-testid={`devbox-connect-mode-help-content-${mode}`}
                                >
                                  <span>{t(copyMode.kindKey)}</span>
                                  <span>{t(copyMode.whenKey)}</span>
                                  <span>{t(copyMode.needKey)}</span>
                                </span>
                              }
                            >
                              <IconButton
                                size="sm"
                                variant="ghost"
                                aria-label={`${t(copyMode.titleKey)} — ${t('common.more')}`}
                                data-testid={`devbox-connect-mode-help-${mode}`}
                              >
                                <HelpCircle size={13} aria-hidden />
                              </IconButton>
                            </Tooltip>
                          </div>
                        );
                      })}
                    </div>

                    <div
                      className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-2xs text-slate-400"
                      data-testid="devbox-connect-mode-details"
                    >
                      <p className="text-slate-300">{t(modeCopy.tipKey)}</p>
                      <p className="mt-2">
                        <span className="text-slate-500">{t('devboxPage.connectModeNowLabel')}:</span>{' '}
                        {t(modeCopy.nowKey)}
                      </p>
                      <p>
                        <span className="text-slate-500">{t('devboxPage.connectModeNeedLabel')}:</span>{' '}
                        {t(modeCopy.needKey)}
                      </p>
                      <p>
                        <span className="text-slate-500">{t('devboxPage.connectModeFlowLabel')}:</span>{' '}
                        {t(modeCopy.flowKey)}
                      </p>
                    </div>

                    {connect.draftMode === 'relay' ? (
                      <div className="space-y-2">
                        <Input
                          label={t('devboxPage.connectSubdomainLabel')}
                          hint={t('devboxPage.connectSubdomainHint')}
                          id="devbox-connect-RELAY_SUBDOMAIN"
                          data-testid="devbox-connect-input-RELAY_SUBDOMAIN"
                          value={connect.draft.RELAY_SUBDOMAIN ?? ''}
                          placeholder="devbox-d473f6"
                          disabled={connect.saving || busy}
                          onChange={event => connect.setField('RELAY_SUBDOMAIN', event.target.value)}
                        />
                        {relayUrl !== '' && (
                          <div className="px-0.5 text-2xs text-slate-400" data-testid="devbox-connect-relay-url">
                            <span className="text-slate-500">{t('devboxPage.connectRelayUrlLabel')}:</span>{' '}
                            <span className="font-mono">{relayUrl}</span>
                          </div>
                        )}
                      </div>
                    ) : connect.draftMode === 'cloudflare' ? (
                      <div className="space-y-2">
                        <Input
                          label={t('devboxPage.connectDomainLabel')}
                          hint={t('devboxPage.connectDomainTip')}
                          id="devbox-connect-PUBLIC_URL"
                          data-testid="devbox-connect-input-PUBLIC_URL"
                          value={connect.draft.PUBLIC_URL ?? ''}
                          placeholder="https://devbox.example.com"
                          disabled={connect.saving || busy}
                          onChange={event => connect.setField('PUBLIC_URL', event.target.value)}
                        />
                        <Input
                          label={t('devboxPage.connectTunnelTokenLabel')}
                          hint={t('devboxPage.connectTunnelTokenTip')}
                          id="devbox-connect-TUNNEL_TOKEN"
                          data-testid="devbox-connect-input-TUNNEL_TOKEN"
                          type={revealed.TUNNEL_TOKEN ? 'text' : 'password'}
                          placeholder={
                            (connect.savedTunnelToken ?? '') !== '' ? '••••••••' : undefined
                          }
                          value={connect.draft.TUNNEL_TOKEN ?? ''}
                          disabled={connect.saving || busy}
                          onChange={event => connect.setField('TUNNEL_TOKEN', event.target.value)}
                          rightElement={secretToggle('TUNNEL_TOKEN')}
                        />
                        {cloudflareIncomplete && (
                          <Alert variant="warning" message={t('devboxPage.connectCloudflareWarning')} />
                        )}
                      </div>
                    ) : connect.draftMode === 'manual' ? (
                      <Input
                        label={t('devboxPage.connectManualUrlLabel')}
                        hint={t('devboxPage.connectManualUrlHint')}
                        id="devbox-connect-PUBLIC_URL"
                        data-testid="devbox-connect-input-PUBLIC_URL"
                        value={connect.draft.PUBLIC_URL ?? ''}
                        placeholder="https://my-vps.example.com"
                        disabled={connect.saving || busy}
                        onChange={event => connect.setField('PUBLIC_URL', event.target.value)}
                      />
                    ) : (
                      <div className="space-y-2">
                        <Input
                          label={t('devboxPage.connectPublicUrlLabel')}
                          hint={t('devboxPage.connectPublicUrlHint')}
                          id="devbox-connect-PUBLIC_URL"
                          data-testid="devbox-connect-input-PUBLIC_URL"
                          value={connect.draft.PUBLIC_URL ?? ''}
                          placeholder="https://devbox.example.com"
                          disabled={connect.saving || busy}
                          onChange={event => connect.setField('PUBLIC_URL', event.target.value)}
                        />
                        {relayUrl !== '' && (
                          <div className="px-0.5 text-2xs text-slate-400" data-testid="devbox-connect-relay-url">
                            <span className="text-slate-500">{t('devboxPage.connectRelayUrlLabel')}:</span>{' '}
                            <span className="font-mono">{relayUrl}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div data-testid="devbox-connect-status">{statusAlert()}</div>
                  </div>
                </DevboxSection>

                <DevboxSection
                  title={t('devboxPage.connectFieldAccess')}
                  caption={t('devboxPage.connectFieldAccessHelp')}
                  testId="devbox-connect-access"
                >
                  <div className="flex flex-col gap-3">
                    {connect.activeProfile === '' && (
                      <Alert variant="warning" message={t('devboxPage.connectAccessNoProfile')} />
                    )}
                    {connect.profileError !== null && (
                      <div data-testid="devbox-connect-access-error">
                        <Alert variant="danger" message={connect.profileError} />
                      </div>
                    )}
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      {ACCESS_MODES.map(mode => {
                        const accessCopy = ACCESS_COPY[mode];
                        return (
                          <RadioCard
                            key={mode}
                            selected={connect.accessMode === mode}
                            onSelect={() => {
                              if (mode !== 'full') {
                                void connect.saveAccess(mode);
                                return;
                              }
                              void askConfirm({
                                title: t('devboxPage.connectAccessFullConfirmTitle'),
                                message: t('devboxPage.connectAccessFullConfirmMessage'),
                                confirmText: t('common.confirm'),
                                cancelText: t('common.cancel'),
                                variant: 'warning',
                              }).then(confirmed => {
                                if (confirmed) void connect.saveAccess(mode);
                              });
                            }}
                            disabled={busy || connect.accessSaving || connect.activeProfile === ''}
                            data-testid={`devbox-connect-access-${mode}`}
                            title={t(accessCopy.labelKey)}
                            description={t(accessCopy.hintKey)}
                          />
                        );
                      })}
                    </div>
                    {connect.accessMode !== 'custom' && (
                      <p className="text-2xs text-slate-400" data-testid="devbox-connect-access-derived">
                        {t(ACCESS_COPY[connect.accessMode].derivedKey)}
                      </p>
                    )}
                    {connect.accessPermissions !== null && (
                      <div className="flex flex-wrap gap-2" data-testid="devbox-connect-access-permissions">
                        <Badge size="sm" variant="outline">
                          {t('devboxPage.connectPermEdit')}: {permissionLabel(connect.accessPermissions.edit)}
                        </Badge>
                        <Badge size="sm" variant="outline">
                          {t('devboxPage.connectPermWrite')}: {permissionLabel(connect.accessPermissions.write)}
                        </Badge>
                        <Badge size="sm" variant="outline">
                          {t('devboxPage.connectPermBash')}: {permissionLabel(connect.accessPermissions.bash)}
                        </Badge>
                      </div>
                    )}
                  </div>
                </DevboxSection>

                <DevboxSection
                  title={t('devboxPage.connectFieldReliability')}
                  caption={t('devboxPage.connectFieldReliabilityHelp')}
                  testId="devbox-connect-reliability"
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <Input
                      label={t('devboxPage.connectTimeoutTitle')}
                      hint={t('devboxPage.connectTimeoutHint', { minutes: connect.timeoutMinutes })}
                      id="devbox-connect-JOB_TIMEOUT_SECONDS"
                      data-testid="devbox-connect-input-JOB_TIMEOUT_SECONDS"
                      type="number"
                      min={60}
                      max={3600}
                      value={connect.draft.JOB_TIMEOUT_SECONDS ?? ''}
                      disabled={connect.saving || busy}
                      onChange={event => connect.setField('JOB_TIMEOUT_SECONDS', event.target.value)}
                    />
                    <Select
                      label={t('devboxPage.connectEgressTitle')}
                      hint={t('devboxPage.connectEgressHint')}
                      id="devbox-connect-EGRESS_CONTAINER"
                      data-testid="devbox-connect-select-EGRESS_CONTAINER"
                      value={connect.egressValue}
                      options={[
                        { value: 'rdm-egress', label: t('devboxPage.connectEgressWarp') },
                        { value: 'rdm-vpn', label: t('devboxPage.connectEgressVless') },
                      ]}
                      disabled={connect.saving || busy}
                      onValueChange={value => connect.setField('EGRESS_CONTAINER', value)}
                    />
                    <div className="space-y-2" data-testid="devbox-connect-watchdog">
                      <Toggle
                        label={t('devboxPage.connectWatchdogEnabled')}
                        checked={connect.watchdogEnabled}
                        onChange={connect.toggleWatchdog}
                        disabled={busy}
                        tooltip={t('devboxPage.connectWatchdogTip')}
                        ariaLabel={t('devboxPage.connectWatchdogTitle')}
                      />
                      <p className="text-2xs text-slate-400">{t('devboxPage.connectWatchdogDesc')}</p>
                    </div>
                  </div>
                </DevboxSection>

                <div data-testid="devbox-connect-advanced">
                  <CollapsibleSection
                    title={t('devboxPage.connectAdvancedTitle')}
                    defaultExpanded={false}
                    icon={<Settings size={16} className="text-slate-400" />}
                  >
                    <div className="flex flex-col gap-3">
                      <Input
                        label={t('devboxPage.connectVlessLabel')}
                        id="devbox-connect-VLESS_SUB_URL"
                        data-testid="devbox-connect-input-VLESS_SUB_URL"
                        type={revealed.VLESS_SUB_URL ? 'text' : 'password'}
                        placeholder={
                          connect.entries.find(e => e.key === 'VLESS_SUB_URL' && e.value !== '') !==
                          undefined
                            ? '••••••••'
                            : undefined
                        }
                        value={connect.draft.VLESS_SUB_URL ?? ''}
                        disabled={connect.saving || busy}
                        onChange={event => connect.setField('VLESS_SUB_URL', event.target.value)}
                        rightElement={secretToggle('VLESS_SUB_URL')}
                      />
                      <div className="space-y-1">
                        <p className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                          {t('devboxPage.connectDenyMountsLabel')}
                        </p>
                        <p className="text-2xs text-slate-500">{t('devboxPage.connectDenyMountsHint')}</p>
                        <p
                          className="break-all font-mono text-2xs text-slate-300"
                          data-testid="devbox-connect-deny-mounts"
                        >
                          {connect.denyMounts.length === 0 ? '—' : connect.denyMounts.join(', ')}
                        </p>
                      </div>
                      <div data-testid="devbox-connect-permissions">
                        <CodeBlock
                          label={t('devboxPage.connectPermissionsLabel')}
                          code={permissionsPretty === '' ? '—' : permissionsPretty}
                          copyable={false}
                          maxHeight={160}
                        />
                      </div>
                    </div>
                  </CollapsibleSection>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {location === 'sandbox' ? (
                  <DevboxSection
                    title={t('devboxPage.connectHandoffTitle')}
                    caption={t('devboxPage.connectHandoffDesc')}
                    testId="devbox-connect-handoff"
                    actions={
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Button
                          size="xs"
                          variant="ghost"
                          data-testid="devbox-connect-handoff-reveal"
                          onClick={toggleHandoff}
                        >
                          {connect.handoffRevealed
                            ? t('devboxPage.connectTokenHide')
                            : t('devboxPage.connectTokenReveal')}
                        </Button>
                        <Button
                          size="xs"
                          variant="primary"
                          leftIcon={<Copy size={12} />}
                          data-testid="devbox-connect-handoff-copy"
                          onClick={() => void copyHandoff()}
                        >
                          {t('devboxPage.connectCopy')}
                        </Button>
                      </div>
                    }
                  >
                    <div className="flex flex-col gap-3">
                      {connect.handoffStale && (
                        <Alert variant="warning" message={t('devboxPage.connectHandoffStale')} />
                      )}
                      {connect.handoffError !== null && (
                        <div data-testid="devbox-connect-handoff-error">
                          <Alert variant="danger" message={connect.handoffError} />
                        </div>
                      )}
                      {connect.handoffLoading ? (
                        <div className="p-4 text-center text-2xs text-slate-400" data-testid="devbox-connect-handoff-loading">
                          {t('devboxPage.connectHandoffLoading')}
                        </div>
                      ) : connect.handoffBlock === '' ? (
                        <EmptyState
                          compact
                          icon={Terminal}
                          title={t('devboxPage.connectHandoffEmpty')}
                          action={
                            <Button size="xs" variant="secondary" onClick={connect.reload}>
                              {t('common.retry')}
                            </Button>
                          }
                        />
                      ) : (
                        <div data-testid="devbox-connect-handoff-block">
                          <CodeBlock
                            label={t('devboxPage.connectHandoffLabel')}
                            code={connect.handoffBlock}
                            copyable={false}
                            maxHeight={260}
                          />
                        </div>
                      )}

                      {connect.bootstrap !== '' && (
                        <div className="space-y-2" data-testid="devbox-connect-bootstrap">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                              {t('devboxPage.connectBootstrapLabel')}
                            </p>
                            <Button
                              size="xs"
                              variant="secondary"
                              leftIcon={<Copy size={12} />}
                              data-testid="devbox-connect-bootstrap-copy"
                              onClick={() => void copyBootstrap()}
                            >
                              {t('devboxPage.connectCopy')}
                            </Button>
                          </div>
                          <CodeBlock code={connect.bootstrap} copyable={false} maxHeight={180} />
                          <Alert
                            variant="info"
                            title={t('devboxPage.connectBootstrapCheckTitle')}
                            message={t('devboxPage.connectBootstrapCheckText')}
                          />
                        </div>
                      )}
                    </div>
                  </DevboxSection>
                ) : (
                  <DevboxSection
                    title={t('devboxPage.connectChatTitle')}
                    caption={t('devboxPage.connectChatDesc')}
                    testId="devbox-connect-chat"
                    actions={
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          isLoading={connect.checking}
                          data-testid="devbox-connect-check-tools"
                          onClick={() => void connect.runCheck()}
                        >
                          {t('devboxPage.connectCheckTools')}
                        </Button>
                        <Button
                          size="xs"
                          variant="primary"
                          leftIcon={<Copy size={12} />}
                          data-testid="devbox-connect-chat-copy"
                          onClick={() => void copyChatConfig()}
                        >
                          {t('devboxPage.connectCopy')}
                        </Button>
                      </div>
                    }
                  >
                    <div className="flex flex-col gap-3">
                      {connect.connectionStale && (
                        <Alert variant="warning" message={t('devboxPage.connectHandoffStale')} />
                      )}
                      {connect.connectionError !== null && (
                        <div data-testid="devbox-connect-chat-error">
                          <Alert variant="danger" message={connect.connectionError} />
                        </div>
                      )}
                      {connect.connectionLoading ? (
                        <div className="p-4 text-center text-2xs text-slate-400" data-testid="devbox-connect-chat-loading">
                          {t('devboxPage.connectHandoffLoading')}
                        </div>
                      ) : connect.chatConfig === '' ? (
                        <EmptyState
                          compact
                          icon={Terminal}
                          title={t('devboxPage.connectHandoffEmpty')}
                          action={
                            <Button size="xs" variant="secondary" onClick={connect.reload}>
                              {t('common.retry')}
                            </Button>
                          }
                        />
                      ) : (
                        <div data-testid="devbox-connect-chat-config">
                          <CodeBlock
                            label={t('devboxPage.connectChatConfigLabel')}
                            code={connect.chatConfig}
                            copyable={false}
                            maxHeight={220}
                          />
                        </div>
                      )}

                      {endpoints.length > 0 && (
                        <div className="space-y-2" data-testid="devbox-connect-endpoints">
                          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-400">
                            {t('devboxPage.connectEndpoints')}
                          </p>
                          {endpoints.map(endpoint => (
                            <div
                              key={endpoint.id}
                              className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                              data-testid={`devbox-connect-endpoint-${endpoint.id}`}
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-white">{endpointLabel(endpoint.id)}</p>
                                <p className="truncate font-mono text-2xs text-slate-300">{endpoint.url}</p>
                                <p className="truncate font-mono text-2xs text-slate-500">
                                  {connect.connectionRevealed ? endpoint.token : '••••••••'}
                                </p>
                                {endpoint.note !== '' && (
                                  <p className="text-2xs text-slate-500">{endpoint.note}</p>
                                )}
                              </div>
                              <IconButton
                                size="sm"
                                variant="ghost"
                                tooltip={t('devboxPage.connectCopy')}
                                aria-label={t('devboxPage.connectCopy')}
                                data-testid={`devbox-connect-endpoint-copy-${endpoint.id}`}
                                onClick={() => void copyEndpoint(endpoint)}
                              >
                                <Copy size={14} />
                              </IconButton>
                            </div>
                          ))}
                        </div>
                      )}

                      {chatAccessMode === 'standard' ? (
                        <Alert
                          variant="warning"
                          title={t('devboxPage.connectChatCompatStandardTitle')}
                          message={t('devboxPage.connectChatCompatStandardText')}
                        />
                      ) : (
                        <Alert
                          variant="info"
                          title={t('devboxPage.connectChatCompatOtherTitle', {
                            mode: devboxModeLabel(chatAccessMode),
                          })}
                          message={t('devboxPage.connectChatCompatOtherText')}
                        />
                      )}
                    </div>
                  </DevboxSection>
                )}

                <DevboxSection
                  title={t('devboxPage.connectTokensTitle')}
                  testId="devbox-connect-tokens"
                  actions={
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        data-testid="devbox-connect-tokens-reveal"
                        onClick={toggleHandoff}
                      >
                        {connect.handoffRevealed
                          ? t('devboxPage.connectTokenHide')
                          : t('devboxPage.connectTokenReveal')}
                      </Button>
                      <ConfirmActionButton
                        size="xs"
                        variant="secondary"
                        disabled={busy}
                        tooltip={t('devboxPage.connectRotateAll')}
                        data-testid="devbox-connect-rotate-tokens"
                        onConfirm={connect.rotateTokens}
                      >
                        {t('devboxPage.connectRotateAll')}
                      </ConfirmActionButton>
                    </div>
                  }
                >
                  <div className="flex flex-col gap-3">
                    {connect.tokensStale && (
                      <Alert variant="warning" message={t('devboxPage.connectTokensStale')} />
                    )}
                    {connect.tokenRows.map(row => (
                      <div
                        key={row.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3"
                        data-testid={`devbox-connect-token-${row.id}`}
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-white">
                            <KeyRound size={13} className="text-slate-500" aria-hidden />
                            {t(row.labelKey)}
                          </p>
                          <p className="text-2xs text-slate-400">{t(row.descKey)}</p>
                          <p
                            className={cn(
                              'mt-1 truncate font-mono text-2xs',
                              row.masked ? 'text-slate-500' : 'text-emerald-300',
                            )}
                            data-testid={`devbox-connect-token-value-${row.id}`}
                          >
                            {row.available ? row.value : '—'}
                          </p>
                        </div>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          tooltip={t('devboxPage.connectTokenCopy')}
                          aria-label={t('devboxPage.connectTokenCopy')}
                          disabled={!row.available}
                          data-testid={`devbox-connect-token-copy-${row.id}`}
                          onClick={() => void copyToken(row.id)}
                        >
                          <Copy size={14} />
                        </IconButton>
                      </div>
                    ))}
                  </div>
                </DevboxSection>

                <DevboxSection title={t('devboxPage.connectCockpitOpen')} testId="devbox-connect-cockpit">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="min-w-0 text-2xs text-slate-400">{t('devboxPage.connectCockpitHint')}</p>
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy}
                      data-testid="devbox-connect-cockpit-open"
                      onClick={() => {
                        void connect.openCockpit().then(url => {
                          if (url === null) {
                            appToast.error(t('devboxPage.connectCockpitOpen'));
                            return;
                          }
                          window.open(url, '_blank', 'noopener,noreferrer');
                          toast.success(t('devboxPage.toastCockpitDone'), {
                            action: {
                              label: t('devboxPage.toastCockpitOpen'),
                              onClick: () => window.open(url, '_blank', 'noopener,noreferrer'),
                            },
                          });
                        });
                      }}
                    >
                      {t('devboxPage.connectCockpitOpen')}
                    </Button>
                  </div>
                </DevboxSection>
              </div>
            </div>
          </div>
        )}
      </DevboxSection>
    </div>
  );
}
