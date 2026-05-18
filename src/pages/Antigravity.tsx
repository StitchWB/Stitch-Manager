import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../components/layout/Header';

import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import { appToast } from '@/lib/observability/toast';
import { toast } from 'sonner';
import { Copy, Zap } from 'lucide-react';
import { t } from '../lib/i18n';

import {
  providerAuthFlowStart,
  providerAuthFlowStatus,
  openUrlInBrowser,
  scanAuthFiles,
} from '@/lib/tauri/modules/aiProxy';

import type { AuthFile } from '../types/generated';
import {
  Button,
  EmptyState,
  GlassCard,
  IconButton,
  Modal,
  PageHeader,
  ProviderLogo,
  StatusBadge,
  Tooltip,
} from '@/components/ui';
import { cn } from '@/lib/utils';

type OAuthSession = {
  provider: string;
  sessionId: string;
  url: string;
};

type ExpiryState = 'expired' | 'expiring' | 'valid' | 'unknown';

const EXPIRY_SOON_THRESHOLD_SECONDS = 24 * 60 * 60; // 24h

function getExpiryState(expiresAt: number | null): ExpiryState {
  if (expiresAt == null) return 'unknown';
  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = expiresAt - nowSeconds;
  if (diff <= 0) return 'expired';
  if (diff <= EXPIRY_SOON_THRESHOLD_SECONDS) return 'expiring';
  return 'valid';
}

function formatExpiry(expiresAt: number | null): string {
  if (expiresAt == null) return '';
  const d = new Date(expiresAt * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  // YYYY-MM-DD HH:mm in local time, deterministic format.
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getFileShortLabel(path: string): string {
  // last 1–2 segments, defensive for both / and \ separators.
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return path;
  if (parts.length === 1) return parts[0];
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export default function Antigravity() {
  const [authFiles, setAuthFiles] = useState<AuthFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [oauthSession, setOauthSession] = useState<OAuthSession | null>(null);
  const [isOauthModalOpen, setIsOauthModalOpen] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const antigravityFiles = useMemo(
    () => authFiles.filter(f => f.provider.toLowerCase() === 'antigravity'),
    [authFiles]
  );

  const expiredCount = useMemo(
    () => antigravityFiles.filter(f => getExpiryState(f.expiresAt) === 'expired').length,
    [antigravityFiles]
  );

  const refreshAuthFiles = useCallback(async () => {
    try {
      setIsLoading(true);
      const files = await scanAuthFiles();
      setAuthFiles(files);
    } catch (e) {
      appToast.error(
        t('aiHub.antigravity.errors.scanAuthFilesFailed', {
          msg: e instanceof Error ? e.message : String(e),
        }),
        'antigravity.scan'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuthFiles();
  }, [refreshAuthFiles]);

  const handleStartLogin = useCallback(async () => {
    try {
      const res = await providerAuthFlowStart({ provider: 'antigravity' });
      setOauthSession({ provider: 'antigravity', sessionId: res.sessionId, url: res.authUrl });
      setIsOauthModalOpen(true);
      try {
        await openUrlInBrowser(res.authUrl);
      } catch {
        // ok: user can open manually
      }
    } catch (e) {
      appToast.error(
        t('aiHub.antigravity.errors.startLoginFailed', {
          msg: e instanceof Error ? e.message : String(e),
        }),
        'antigravity.oauth.start'
      );
    }
  }, []);

  const pollOnce = useCallback(async (): Promise<{
    status: string;
    error: string | null;
  } | null> => {
    if (!oauthSession) return null;
    try {
      const res = await providerAuthFlowStatus({ sessionId: oauthSession.sessionId });
      return {
        status: res.phase,
        error: res.error,
      };
    } catch (e) {
      appToast.error(
        t('aiHub.antigravity.errors.oauthPollFailed', {
          msg: e instanceof Error ? e.message : String(e),
        }),
        'antigravity.oauth.poll'
      );
      return null;
    }
  }, [oauthSession]);

  const handlePollUntilDone = useCallback(async () => {
    if (!oauthSession) return;
    if (isPolling) return;

    setIsPolling(true);
    try {
      for (let i = 0; i < 90; i++) {
        const res = await pollOnce();
        if (!res) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        if (res.status === 'token_ready') {
          appToast.success(
            t('aiHub.antigravity.toasts.loginCompletedRefreshing'),
            'antigravity.oauth.poll'
          );
          await refreshAuthFiles();
          return;
        }
        if (res.status === 'failed' || res.status === 'expired' || res.status === 'cancelled') {
          appToast.error(
            res.error || t('aiHub.antigravity.toasts.oauthFailedGeneric'),
            'antigravity.oauth.poll'
          );
          return;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      appToast.error(t('aiHub.antigravity.toasts.oauthTimedOut'), 'antigravity.oauth.poll');
    } finally {
      setIsPolling(false);
    }
  }, [oauthSession, isPolling, pollOnce, refreshAuthFiles]);

  const handleCopyAuthUrl = useCallback(async () => {
    if (!oauthSession?.url) {
      toast.error(t('aiHub.copy.empty'));
      return;
    }
    try {
      await navigator.clipboard.writeText(oauthSession.url);
      toast.success(t('aiHub.copy.success', { label: t('aiHub.antigravity.modal.authUrlLabel') }));
    } catch (e) {
      console.error('[Antigravity] Copy auth URL failed:', e);
      toast.error(t('aiHub.copy.fail', { label: t('aiHub.antigravity.modal.authUrlLabel') }));
    }
  }, [oauthSession]);

  const renderStatusPill = () => {
    if (antigravityFiles.length === 0) return null;
    const status = expiredCount > 0 ? 'warning' : 'success';
    const label =
      expiredCount > 0
        ? t('aiHub.antigravity.status.credentialsWithExpired', {
            count: antigravityFiles.length,
            expired: expiredCount,
          })
        : t('aiHub.antigravity.status.credentials', { count: antigravityFiles.length });
    return (
      <StatusBadge status={status} size="sm" withDot>
        {label}
      </StatusBadge>
    );
  };

  const renderAuthFileRow = (file: AuthFile) => {
    const state = getExpiryState(file.expiresAt);
    const expiryClass = cn(
      state === 'expired' && 'text-red-400',
      state === 'expiring' && 'text-amber-400',
      state === 'valid' && 'text-emerald-400',
      state === 'unknown' && 'text-slate-400'
    );
    const expiryStatusLabel =
      state === 'expired'
        ? t('aiHub.antigravity.list.expiryStatus.expired')
        : state === 'expiring'
          ? t('aiHub.antigravity.list.expiryStatus.expiring')
          : state === 'valid'
            ? t('aiHub.antigravity.list.expiryStatus.valid')
            : t('aiHub.antigravity.list.unknownExpiry');

    return (
      <GlassCard key={file.path} className="p-3">
        <div className="flex items-center gap-3">
          <ProviderLogo provider="antigravity" size={28} colored />
          <div className="min-w-0 flex-1">
            <Tooltip content={file.path} side="top">
              <div className="text-sm text-white truncate">{getFileShortLabel(file.path)}</div>
            </Tooltip>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">{t('aiHub.antigravity.list.expiresLabel')}:</span>
              <span className={cn('font-mono', expiryClass)}>
                {file.expiresAt ? formatExpiry(file.expiresAt) : t('aiHub.antigravity.list.unknownExpiry')}
              </span>
              <span className={cn('text-[10px] uppercase tracking-wider', expiryClass)}>
                {expiryStatusLabel}
              </span>
            </div>
          </div>
        </div>
      </GlassCard>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ds-surface-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />
      <AiTopTabs />

      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.sections.antigravity.title')}
        description={t('aiHub.sections.antigravity.subtitle')}
        actions={
          <>
            <Button onClick={handleStartLogin} variant="primary" size="sm">
              {t('aiHub.antigravity.actions.loginOAuth')}
            </Button>
            <Button variant="secondary" size="sm" onClick={refreshAuthFiles} disabled={isLoading}>
              {t('aiHub.antigravity.actions.refresh')}
            </Button>
          </>
        }
        meta={renderStatusPill()}
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl space-y-4">
          {antigravityFiles.length === 0 ? (
            <GlassCard gradient className="p-5">
              <EmptyState
                icon={Zap}
                title={t('aiHub.antigravity.empty.noCredentialsTitle')}
                description={t('aiHub.antigravity.empty.noCredentialsDescription')}
              />
            </GlassCard>
          ) : (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {t('aiHub.antigravity.list.detectedTitle')}
              </div>
              <div className="space-y-2">
                {antigravityFiles.map(renderAuthFileRow)}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={isOauthModalOpen}
        onClose={() => setIsOauthModalOpen(false)}
        title={t('aiHub.antigravity.modal.oauthTitle')}
        size="lg"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-300">{t('aiHub.antigravity.modal.oauthInstructions')}</p>
          {oauthSession && (
            <div className="p-3 rounded-lg bg-black/30 border border-white/10">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-400">
                  {t('aiHub.antigravity.modal.authUrlLabel')}
                </div>
                <Tooltip content={t('aiHub.antigravity.modal.copyAuthUrlTooltip')} side="left">
                  <IconButton
                    size="sm"
                    variant="ghost"
                    onClick={handleCopyAuthUrl}
                    aria-label={t('aiHub.antigravity.actions.copyAuthUrl')}
                  >
                    <Copy size={14} />
                  </IconButton>
                </Tooltip>
              </div>
              <div className="mt-1 text-xs font-mono text-slate-200 break-all">
                {oauthSession.url}
              </div>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" onClick={() => openUrlInBrowser(oauthSession.url)}>
                  {t('aiHub.antigravity.actions.openUrl')}
                </Button>
                <Button onClick={handlePollUntilDone} disabled={isPolling}>
                  {isPolling
                    ? t('aiHub.antigravity.actions.checking')
                    : t('aiHub.antigravity.actions.checkStatus')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
