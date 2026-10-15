import { useCallback, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';

import { getProxySettings, updateProxySettings } from '@/lib/backend/modules/aiProxy';
import {
  getFreeModelBridgeStatus,
  startFreeModelBridge,
  stopFreeModelBridge,
  type FreeModelBridgeStatus,
} from '@/lib/backend/modules/freeModelBridge';
import { Button, GlassCard, Input } from '@/components/ui';

export function FreeModelBridgeSection() {
  const [freemodelApiKey, setFreemodelApiKey] = useState('');
  const [freemodelSavedKey, setFreemodelSavedKey] = useState('');
  const [isSavingFreemodel, setIsSavingFreemodel] = useState(false);
  const [isTestingFreemodel, setIsTestingFreemodel] = useState(false);
  const [freemodelTestResult, setFreemodelTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<FreeModelBridgeStatus | null>(null);
  const [isTogglingBridge, setIsTogglingBridge] = useState(false);

  // Load FreeModel API key from proxy settings on mount
  const loadFreemodelKey = useCallback(async () => {
    if (isLoaded) return;
    try {
      const settings = await getProxySettings();
      if (settings.freemodelApiKey) {
        setFreemodelApiKey(settings.freemodelApiKey);
        setFreemodelSavedKey(settings.freemodelApiKey);
      }
      setIsLoaded(true);
    } catch {
      // Settings may not exist yet — that's fine
      setIsLoaded(true);
    }
  }, [isLoaded]);

  // Load on first render
  if (!isLoaded) {
    loadFreemodelKey();
  }

  const refreshBridgeStatus = useCallback(async () => {
    try {
      setBridgeStatus(await getFreeModelBridgeStatus());
    } catch {
      setBridgeStatus(null);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      refreshBridgeStatus();
    });
  }, [refreshBridgeStatus]);

  const handleSaveFreemodel = useCallback(async () => {
    setIsSavingFreemodel(true);
    try {
      const settings = await getProxySettings();
      settings.freemodelApiKey = freemodelApiKey || undefined;
      await updateProxySettings(settings);
      setFreemodelSavedKey(freemodelApiKey);
      toast.success('FreeModel API key saved');
    } catch (e) {
      toast.error(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSavingFreemodel(false);
    }
  }, [freemodelApiKey]);

  const handleStartBridge = useCallback(async () => {
    setIsTogglingBridge(true);
    try {
      const st = await startFreeModelBridge();
      setBridgeStatus(st);
      if (st.status !== 'running') {
        toast.error(t('aiHub.failedGeneric', { msg: st.errorMessage || t('aiHub.fmStatusStopped') }));
      }
    } catch (e) {
      toast.error(t('aiHub.failedGeneric', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setIsTogglingBridge(false);
    }
  }, []);

  const handleStopBridge = useCallback(async () => {
    setIsTogglingBridge(true);
    try {
      setBridgeStatus(await stopFreeModelBridge());
    } catch (e) {
      toast.error(t('aiHub.failedGeneric', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setIsTogglingBridge(false);
    }
  }, []);

  const handleTestFreemodel = useCallback(async () => {
    setIsTestingFreemodel(true);
    setFreemodelTestResult(null);
    const port = bridgeStatus?.port;
    if (!port) {
      setFreemodelTestResult({ ok: false, msg: t('aiHub.fmBridgeNotRunning') });
      setIsTestingFreemodel(false);
      return;
    }
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        headers: { Authorization: `Bearer ${freemodelApiKey || 'freemodel-local'}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const fmModels = (data.data || []).filter((m: { id: string }) => m.id?.startsWith('FM-'));
        setFreemodelTestResult({ ok: true, msg: t('aiHub.fmModelsAvailable', { count: fmModels.length }) });
      } else {
        setFreemodelTestResult({ ok: false, msg: `HTTP ${resp.status}` });
      }
    } catch (e) {
      setFreemodelTestResult({ ok: false, msg: e instanceof Error ? e.message : t('aiGateway.cred.connectionFailed') });
    } finally {
      setIsTestingFreemodel(false);
    }
  }, [freemodelApiKey, bridgeStatus]);

  const bridgeRunning = bridgeStatus?.status === 'running';
  const statusText = bridgeStatus?.status === 'error'
    ? t('aiHub.fmStatusError', { error: bridgeStatus.errorMessage || '' })
    : bridgeRunning
      ? t('aiHub.fmStatusRunning', { port: bridgeStatus?.port ?? '' })
      : t('aiHub.fmStatusStopped');

  return (
    <GlassCard>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-white/90">{t('aiHub.fmTitle')}</h3>
          <div className="flex items-center gap-3">
            <span
              className={`text-xs ${
                bridgeRunning
                  ? 'text-emerald-400'
                  : bridgeStatus?.status === 'error'
                    ? 'text-red-400'
                    : 'text-slate-400'
              }`}
            >
              {statusText}
            </span>
            {bridgeRunning ? (
              <Button variant="secondary" size="sm" onClick={handleStopBridge} isLoading={isTogglingBridge}>
                {t('common.stop')}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleStartBridge} isLoading={isTogglingBridge}>
                {t('common.start')}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {t('aiHub.fmDesc')}
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">{t('aiHub.apiKeyLabel')}</label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={freemodelApiKey}
                onChange={e => setFreemodelApiKey(e.target.value)}
                placeholder="fe_oa_..."
                className="flex-1"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveFreemodel}
                isLoading={isSavingFreemodel}
                disabled={freemodelApiKey === freemodelSavedKey}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleTestFreemodel}
              isLoading={isTestingFreemodel}
            >
              {t('apiKeys.testConnection')}
            </Button>
            {freemodelTestResult && (
              <span className={`text-xs ${freemodelTestResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {freemodelTestResult.msg}
              </span>
            )}
          </div>

          <div className="text-xs text-slate-500 pt-2 border-t border-white/5">
            <p>{t('aiHub.fmAvailableModels')}</p>
            <p className="mt-1">{t('aiHub.fmGateway')}</p>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
