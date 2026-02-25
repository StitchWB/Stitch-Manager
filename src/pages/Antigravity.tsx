import { useCallback, useEffect, useMemo, useState } from 'react';
import Header from '../components/layout/Header';
import { Button, EmptyState, Modal } from '../components/ui';
import { appToast } from '@/lib/observability/toast';
import { Zap } from 'lucide-react';

import {
  startOAuthFlow,
  pollOAuthStatus,
  openUrlInBrowser,
  scanAuthFiles,
} from '@/lib/tauri/modules/aiProxy';

import type { AuthFile, OAuthUrlResponse } from '../types/generated';

type OAuthSession = {
  provider: string;
  state: string;
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
        `Failed to scan auth files: ${e instanceof Error ? e.message : String(e)}`,
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
      const res: OAuthUrlResponse = await startOAuthFlow('antigravity');
      setOauthSession({ provider: 'antigravity', state: res.state, url: res.url });
      setIsOauthModalOpen(true);
      try {
        await openUrlInBrowser(res.url);
      } catch {
        // ok: user can open manually
      }
    } catch (e) {
      appToast.error(
        `Failed to start login: ${e instanceof Error ? e.message : String(e)}`,
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
      return await pollOAuthStatus(oauthSession.provider, oauthSession.state);
    } catch (e) {
      appToast.error(
        `OAuth poll failed: ${e instanceof Error ? e.message : String(e)}`,
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
        if (res.status === 'ok' || res.status === 'completed') {
          appToast.success('Login completed. Refreshing auth files...', 'antigravity.oauth.poll');
          await refreshAuthFiles();
          return;
        }
        if (res.status === 'error' || res.status === 'failed') {
          appToast.error(res.error || 'OAuth failed', 'antigravity.oauth.poll');
          return;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      appToast.error('OAuth timed out', 'antigravity.oauth.poll');
    } finally {
      setIsPolling(false);
    }
  }, [oauthSession, isPolling, pollOnce, refreshAuthFiles]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header title="Antigravity" icon={<Zap size={18} />} />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Button onClick={handleStartLogin}>Login (OAuth)</Button>
          <Button variant="secondary" onClick={refreshAuthFiles} disabled={isLoading}>
            Refresh
          </Button>
        </div>

        {antigravityFiles.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No Antigravity credentials found"
            description="Login via OAuth to generate an auth file, or refresh if you already logged in via sidecar."
          />
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-200">
              Detected Antigravity auth files
            </h3>
            <div className="space-y-2">
              {antigravityFiles.map(file => (
                <div
                  key={file.path}
                  className="p-3 rounded-lg bg-black/30 border border-white/10 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate">{file.path}</div>
                    <div className="text-xs text-slate-400">
                      Expires:{' '}
                      {file.expiresAt
                        ? new Date(file.expiresAt * 1000).toLocaleString()
                        : 'Unknown'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={isOauthModalOpen}
        onClose={() => setIsOauthModalOpen(false)}
        title="Antigravity OAuth"
        size="lg"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-300">
            Complete the login in your browser. Then click “Check status” until it completes.
          </p>
          {oauthSession && (
            <div className="p-3 rounded-lg bg-black/30 border border-white/10">
              <div className="text-xs text-slate-400">Auth URL</div>
              <div className="text-xs font-mono text-slate-200 break-all">{oauthSession.url}</div>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" onClick={() => openUrlInBrowser(oauthSession.url)}>
                  Open URL
                </Button>
                <Button onClick={handlePollUntilDone} disabled={isPolling}>
                  {isPolling ? 'Checking…' : 'Check status'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
