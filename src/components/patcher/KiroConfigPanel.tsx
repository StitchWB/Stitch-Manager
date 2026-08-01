import { useState, useEffect, useCallback } from 'react';
import {
  Monitor,
  Activity,
  Shield,
  Copy,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

import {
  getKiroPatchConfig,
  saveKiroPatchConfig,
  generateNewMachineId,
  startKiroProxy,
  stopKiroProxy,
} from '@/lib/backend';
import type { KiroPatchConfig } from '../../types/kiro-patch';
import { applyPreset } from '../../types/kiro-patch';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import {
  Button,
  Input,
  SegmentedControl,
  Tooltip,
} from '@/components/ui';

export default function KiroConfigPanel() {
  const [config, setConfig] = useState<KiroPatchConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const { copy } = useCopyToClipboard();

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const kiroCfg = await getKiroPatchConfig();
      setConfig(kiroCfg);
    } catch (error) {
      console.error('Failed to load config:', error);
      toast.error('Failed to load configuration');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      await saveKiroPatchConfig(config);
      toast.success(t('kiroPatch.saveSuccess'));
    } catch (error) {
      console.error('Failed to save config:', error);
      toast.error(t('kiroPatch.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyMachineId = () => {
    if (config?.machineId) {
      copy(config.machineId);
      toast.success(t('kiroPatch.idCopied'));
    }
  };

  const handleGenerateNewMachineId = async () => {
    try {
      const newId = await generateNewMachineId();
      setConfig(prev => (prev ? { ...prev, machineId: newId } : null));
      await saveKiroPatchConfig({ ...config!, machineId: newId });
      toast.success(t('kiroPatch.generateSuccess'));
    } catch (error) {
      console.error('Failed to generate machine ID:', error);
      toast.error('Failed to generate machine ID');
    }
  };

  if (isLoading || !config) {
    return (
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-6">
        <div className="text-center text-slate-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Machine ID Section */}
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Monitor className="w-3.5 h-3.5 text-blue-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {t('kiroPatch.machineIdTitle')}
          </h3>
          <Tooltip content={t('kiroPatch.machineIdDescription')}>
            <HelpCircle className="w-3 h-3 text-slate-600 hover:text-slate-400 cursor-help" />
          </Tooltip>
        </div>
        
        <div className="flex gap-1.5">
          <Input
            value={config.machineId}
            readOnly
            className="font-mono text-[11px] flex-1 h-8"
            rightElement={
              <Button variant="ghost" size="icon" onClick={handleCopyMachineId} className="h-7 w-7">
                <Copy size={11} />
              </Button>
            }
          />
          <Button variant="secondary" size="sm" onClick={handleGenerateNewMachineId} className="h-8 px-2">
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>

      {/* Proxy Section */}
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {t('kiroPatch.proxyTitle')}
            </h3>
            <Tooltip content={t('kiroPatch.proxyDescription')}>
              <HelpCircle className="w-3 h-3 text-slate-600 hover:text-slate-400 cursor-help" />
            </Tooltip>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.proxyEnabled ?? false}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setConfig(prev => prev ? { ...prev, proxyEnabled: enabled } : null);
                
                try {
                  if (enabled) {
                    await startKiroProxy();
                    toast.success(t('kiroPatch.proxyStarted'));
                  } else {
                    await stopKiroProxy();
                    toast.success(t('kiroPatch.proxyStopped'));
                  }
                } catch (error) {
                  toast.error(String(error));
                  setConfig(prev => prev ? { ...prev, proxyEnabled: !enabled } : null);
                }
              }}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-cyan-500/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
          </label>
        </div>
        
        <Input
          label={t('kiroPatch.proxyPort')}
          type="number"
          min={1024}
          max={65535}
          value={config.proxyPort ?? 5580}
          onChange={e =>
            setConfig(prev =>
              prev ? { ...prev, proxyPort: parseInt(e.target.value) || 5580 } : null
            )
          }
          className="text-[11px] font-mono h-8"
        />
        
        <Input
          label={t('kiroPatch.outboundProxy')}
          type="text"
          placeholder="186.243.169.3:63576:user:pass"
          value={config.outboundProxy ?? ''}
          onChange={e =>
            setConfig(prev => prev ? { ...prev, outboundProxy: e.target.value } : null)
          }
          className="text-[11px] font-mono h-8"
        />
        <p className="text-[9px] text-slate-500 leading-tight">
          {t('kiroPatch.outboundProxyHint')}
        </p>
      </div>

      {/* Preset Section */}
      <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-yellow-400" />
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            {t('kiroPatch.presetTitle')}
          </h3>
          <Tooltip content={t('kiroPatch.presetDescription')}>
            <HelpCircle className="w-3 h-3 text-slate-600 hover:text-slate-400 cursor-help" />
          </Tooltip>
        </div>
        
        <SegmentedControl
          size="sm"
          options={[
            { label: 'Standard', value: 'standard' },
            { label: 'Performance', value: 'performance' },
            { label: 'Privacy', value: 'privacy' },
          ]}
          value={config.preset || 'standard'}
          onChange={preset => {
            if (preset === 'standard' || preset === 'performance' || preset === 'privacy') {
              setConfig(prev => prev ? {
                ...prev,
                preset,
                modules: applyPreset(preset),
              } : null);
            }
          }}
        />
        <p className="text-[9px] text-slate-500 leading-tight">
          {config.preset === 'standard' && 'Balanced: proxy + telemetry blocking + machine ID spoofing'}
          {config.preset === 'performance' && 'Fast: rate limit bypass + error suppression'}
          {config.preset === 'privacy' && 'Private: machine ID + OS spoofing + telemetry blocking'}
        </p>
      </div>

      {/* Save Button */}
      <Button
        variant="primary"
        size="sm"
        onClick={handleSave}
        disabled={isSaving}
        className="w-full h-9"
      >
        {isSaving ? 'Saving...' : t('kiroPatch.saveConfig')}
      </Button>
    </div>
  );
}
