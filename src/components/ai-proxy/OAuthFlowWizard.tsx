import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { t } from '@/lib/i18n';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { openUrlInBrowser } from '@/lib/backend/modules/aiProxy';
import { Button, GlassCard, IconButton } from '@/components/ui';

interface OAuthFlowWizardProps {
  /** Service plugin owning the flow (commands: auth_flow_start/status/cancel). */
  pluginId: string;
  /** Logical provider id, used as a display fallback (e.g. 'antigravity'). */
  providerId: string;
  /** Poll cadence for auth_flow_status (ms). */
  pollIntervalMs?: number;
  /** Give up polling after this many ms. */
  timeoutMs?: number;
  /** Called once when the flow reaches token_ready. */
  onComplete?: () => void;
}

type WizardPhase = 'idle' | 'starting' | 'awaiting_user' | 'success' | 'error';

interface OAuthConfigInfo {
  providerId?: string;
  providerName?: string;
  oauthProviderName?: string;
  configured?: boolean;
}

interface FlowStartResponse {
  sessionId: string;
  authUrl: string;
  callbackPort?: number;
  expiresAt?: number;
}

interface FlowStatusResponse {
  phase: string;
  /** Wire constraint: the plugin RPC layer reserves the top-level `error`
   *  key for JSON-RPC errors — failures travel as `errorMessage`. */
  errorMessage?: string | null;
}

export function OAuthFlowWizard({
  pluginId,
  providerId,
  pollIntervalMs = 1000,
  timeoutMs = 90000,
  onComplete,
}: OAuthFlowWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>('idle');
  const [authUrl, setAuthUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [config, setConfig] = useState<OAuthConfigInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const pollToken = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    let cancelled = false;
    safeInvoke<OAuthConfigInfo>(`plugin.${pluginId}.get_oauth_config`, {})
      .then(cfg => {
        if (!cancelled) setConfig(cfg);
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId]);

  const stopPolling = useCallback(() => {
    pollToken.current.cancelled = true;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollUntilDone = useCallback(
    (sid: string) => {
      const token = { cancelled: false };
      pollToken.current = token;
      const startedAt = Date.now();
      const tick = async () => {
        if (token.cancelled) return;
        if (Date.now() - startedAt > timeoutMs) {
          setPhase('error');
          setErrorMsg(t('aiHub.oauthWizard.timedOut'));
          return;
        }
        try {
          const status = await safeInvoke<FlowStatusResponse>(
            `plugin.${pluginId}.auth_flow_status`,
            { sessionId: sid },
          );
          if (token.cancelled) return;
          if (status.phase === 'token_ready') {
            setPhase('success');
            toast.success(t('aiHub.oauthWizard.success'));
            onComplete?.();
            return;
          }
          if (
            status.phase === 'failed' ||
            status.phase === 'expired' ||
            status.phase === 'cancelled'
          ) {
            setPhase('error');
            setErrorMsg(
              status.errorMessage ||
                t('aiHub.oauthWizard.failed', { msg: status.phase }),
            );
            return;
          }
        } catch {
          // Transient poll failure — keep polling until the timeout hits.
        }
        setTimeout(tick, pollIntervalMs);
      };
      void tick();
    },
    [pluginId, pollIntervalMs, timeoutMs, onComplete],
  );

  const handleStart = async () => {
    setPhase('starting');
    setErrorMsg(null);
    try {
      const res = await safeInvoke<FlowStartResponse>(
        `plugin.${pluginId}.auth_flow_start`,
        {},
      );
      setSessionId(res.sessionId);
      setAuthUrl(res.authUrl);
      setPhase('awaiting_user');
      try {
        await openUrlInBrowser(res.authUrl);
      } catch {
        // The URL stays visible for manual copy/open.
      }
      pollUntilDone(res.sessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPhase('error');
      setErrorMsg(
        msg.includes('oauth_not_configured')
          ? t('aiHub.oauthWizard.notConfigured', {
              provider: config?.providerName ?? providerId,
            })
          : t('aiHub.oauthWizard.failed', { msg }),
      );
    }
  };

  const handleCancel = async () => {
    stopPolling();
    const sid = sessionId;
    setPhase('idle');
    setSessionId('');
    setAuthUrl('');
    if (sid) {
      try {
        await safeInvoke(`plugin.${pluginId}.auth_flow_cancel`, { sessionId: sid });
      } catch {
        // Best-effort cancel; the flow also expires server-side.
      }
    }
  };

  const handleCopy = async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('aiHub.copy.fail', { label: t('aiHub.oauthWizard.authUrlLabel') }));
    }
  };

  const providerName = config?.providerName ?? providerId;
  const oauthProviderName = config?.oauthProviderName ?? 'OAuth';

  return (
    <GlassCard className="m-4 p-4">
      <div className="flex flex-col gap-3">
        <div className="text-sm font-medium text-slate-200">
          {t('aiHub.oauthWizard.title', { provider: providerName })}
        </div>

        {phase === 'idle' && config?.configured === false && (
          <p className="text-xs text-amber-400">
            {t('aiHub.oauthWizard.notConfigured', { provider: providerName })}
          </p>
        )}

        {(phase === 'idle' || phase === 'starting') && (
          <div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleStart}
              disabled={phase === 'starting'}
              data-testid="oauth-flow-start"
            >
              {phase === 'starting' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('aiHub.oauthWizard.starting')}
                </>
              ) : (
                <>
                  <ExternalLink className="w-4 h-4" />
                  {t('aiHub.oauthWizard.start', { oauthProvider: oauthProviderName })}
                </>
              )}
            </Button>
          </div>
        )}

        {phase === 'awaiting_user' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              {t('aiHub.oauthWizard.waiting')}
            </div>
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2.5 border border-white/10">
              <span className="flex-1 text-xs text-slate-300 font-mono truncate">
                {authUrl}
              </span>
              <IconButton
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                aria-label={t('aiHub.oauthWizard.copyUrl')}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-400" />
                )}
              </IconButton>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void openUrlInBrowser(authUrl)}
              >
                {t('aiHub.oauthWizard.openAgain')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                data-testid="oauth-flow-cancel"
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}

        {phase === 'success' && (
          <div className="space-y-3" data-testid="oauth-flow-success">
            <p className="text-sm text-emerald-400">{t('aiHub.oauthWizard.success')}</p>
            <div>
              <Button variant="secondary" size="sm" onClick={handleStart}>
                {t('aiHub.oauthWizard.start', { oauthProvider: oauthProviderName })}
              </Button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-red-400" data-testid="oauth-flow-error">
              {errorMsg}
            </p>
            <div>
              <Button variant="secondary" size="sm" onClick={handleStart}>
                {t('aiHub.oauthWizard.retry')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </GlassCard>
  );
}

export default OAuthFlowWizard;
