import { useState, useCallback } from 'react';
import { toast } from 'sonner';

import { getProxySettings, updateProxySettings } from '@/lib/backend/modules/aiProxy';
import { Button, GlassCard, Input } from '@/components/ui';

export function FreeModelBridgeSection() {
  const [freemodelApiKey, setFreemodelApiKey] = useState('');
  const [freemodelSavedKey, setFreemodelSavedKey] = useState('');
  const [isSavingFreemodel, setIsSavingFreemodel] = useState(false);
  const [isTestingFreemodel, setIsTestingFreemodel] = useState(false);
  const [freemodelTestResult, setFreemodelTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

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

  const handleTestFreemodel = useCallback(async () => {
    setIsTestingFreemodel(true);
    setFreemodelTestResult(null);
    try {
      const resp = await fetch('http://127.0.0.1:25583/v1/models', {
        headers: { Authorization: `Bearer ${freemodelApiKey || 'freemodel-local'}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const fmModels = (data.data || []).filter((m: { id: string }) => m.id?.startsWith('FM-'));
        setFreemodelTestResult({ ok: true, msg: `${fmModels.length} FreeModel models available` });
      } else {
        setFreemodelTestResult({ ok: false, msg: `HTTP ${resp.status}` });
      }
    } catch (e) {
      setFreemodelTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Connection failed' });
    } finally {
      setIsTestingFreemodel(false);
    }
  }, [freemodelApiKey]);

  return (
    <GlassCard>
      <div className="p-5 space-y-4">
        <h3 className="text-sm font-medium text-white/90">FreeModel Bridge</h3>
        <p className="text-xs text-slate-400">
          Access Claude models via FreeModel. Set your API key to enable FM-* models in the proxy.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">API Key</label>
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
                Save
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
              Test Connection
            </Button>
            {freemodelTestResult && (
              <span className={`text-xs ${freemodelTestResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {freemodelTestResult.msg}
              </span>
            )}
          </div>

          <div className="text-xs text-slate-500 pt-2 border-t border-white/5">
            <p>Available models: FM-claude-sonnet-4-6, FM-claude-opus-4-8, FM-claude-haiku-4-5</p>
            <p className="mt-1">Gateway: http://127.0.0.1:25583</p>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
