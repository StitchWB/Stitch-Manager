import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../components/layout/Header';

import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import { appToast } from '@/lib/observability/toast';
import { Zap } from 'lucide-react';
import { t } from '../lib/i18n';

import {
  providerAuthFlowStart,
  providerAuthFlowStatus,
  openUrlInBrowser,
  scanAuthFiles,
} from '@/lib/tauri/modules/aiProxy';

import type { AuthFile } from '../types/generated';
import { Button, EmptyState, GlassCard, Modal, SectionHeader } from '@/components/ui';

type OAuthSession = {
  provider: string;
  sessionId: string;
  url: string;
};

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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header
        title={t('aiHub.sections.antigravity.title')}
        subtitle={t('aiHub.sections.antigravity.subtitle')}
        icon={<Zap size={18} />}
      />
      <AiTopTabs />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl space-y-4">
          <GlassCard glow="purple" gradient className="p-5">
            <SectionHeader
              title={t('aiHub.antigravity.modal.oauthTitle')}
              description={t('aiHub.sections.antigravity.subtitle')}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleStartLogin} variant="primary">
                  {t('aiHub.antigravity.actions.loginOAuth')}
                </Button>
                <Button variant="secondary" onClick={refreshAuthFiles} disabled={isLoading}>
                  {t('aiHub.antigravity.actions.refresh')}
                </Button>
              </div>
            </SectionHeader>
          </GlassCard>

          <GlassCard gradient className="p-5">
            {antigravityFiles.length === 0 ? (
              <EmptyState
                icon={Zap}
                title={t('aiHub.antigravity.empty.noCredentialsTitle')}
                description={t('aiHub.antigravity.empty.noCredentialsDescription')}
              />
            ) : (
              <SectionHeader title={t('aiHub.antigravity.list.detectedTitle')}>
                <div className="space-y-2">
                  {antigravityFiles.map(file => (
                    <div
                      key={file.path}
                      className="p-3 rounded-lg bg-black/30 border border-white/10 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-white truncate">{file.path}</div>
                        <div className="text-xs text-slate-400">
                          {t('aiHub.antigravity.list.expiresLabel')}:{' '}
                          {file.expiresAt
                            ? new Date(file.expiresAt * 1000).toLocaleString()
                            : t('aiHub.antigravity.list.unknownExpiry')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionHeader>
            )}
          </GlassCard>
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
              <div className="text-xs text-slate-400">
                {t('aiHub.antigravity.modal.authUrlLabel')}
              </div>
              <div className="text-xs font-mono text-slate-200 break-all">{oauthSession.url}</div>
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
