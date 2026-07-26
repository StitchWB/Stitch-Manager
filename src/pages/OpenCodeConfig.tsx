import { useCallback, useEffect, useState } from 'react';
import { Save, Settings, Server, Bot, Package, TestTube, Sliders } from 'lucide-react';
import { toast } from 'sonner';

import Header from '../components/layout/Header';
import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import {
  getOpenCodeConfig,
  setOpenCodeConfig,
  getOhMyOpenAgentConfig,
  setOhMyOpenAgentConfig,
  type OpenCodeConfig,
  type OhMyOpenAgentConfig,
  type ProviderConfig,
} from '@/lib/tauri/modules/opencodeConfig';
import { Button, SegmentedControl, LoadingSpinner } from '@/components/ui';
import type { SegmentedOption } from '@/components/ui';

import { ProvidersSection } from '../components/opencode/ProvidersSection';
import { AgentsSection } from '../components/opencode/AgentsSection';
import { GeneralSection } from '../components/opencode/GeneralSection';
import { ModelsSection } from '../components/opencode/ModelsSection';
import { ApiTesterSection } from '../components/opencode/ApiTesterSection';

type ConfigTab = 'providers' | 'agents' | 'general' | 'models' | 'tester';

const TAB_OPTIONS: SegmentedOption[] = [
  { value: 'providers', label: 'Providers', icon: <Server className="w-4 h-4" /> },
  { value: 'agents', label: 'Agents', icon: <Bot className="w-4 h-4" /> },
  { value: 'general', label: 'General', icon: <Sliders className="w-4 h-4" /> },
  { value: 'models', label: 'Models', icon: <Package className="w-4 h-4" /> },
  { value: 'tester', label: 'API Tester', icon: <TestTube className="w-4 h-4" /> },
];

export default function OpenCodeConfig() {
  const [activeTab, setActiveTab] = useState<ConfigTab>('providers');
  const [config, setConfig] = useState<OpenCodeConfig>({});
  const [ohMyConfig, setOhMyConfig] = useState<OhMyOpenAgentConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const [oc, om] = await Promise.all([
        getOpenCodeConfig(),
        getOhMyOpenAgentConfig(),
      ]);
      setConfig(oc || { provider: {} });
      setOhMyConfig(om || {});
    } catch (error) {
      toast.error('Failed to load config');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const handleSave = useCallback(async () => {
    try {
      setSaving(true);
      await Promise.all([
        setOpenCodeConfig(config),
        setOhMyOpenAgentConfig(ohMyConfig),
      ]);
      toast.success('Configuration saved');
    } catch (error) {
      toast.error('Failed to save config');
      console.error(error);
    } finally {
      setSaving(false);
    }
  }, [config, ohMyConfig]);

  const updateConfig = useCallback((updater: (c: OpenCodeConfig) => OpenCodeConfig) => {
    setConfig(prev => updater(prev));
  }, []);

  const updateOhMyConfig = useCallback((updater: (c: OhMyOpenAgentConfig) => OhMyOpenAgentConfig) => {
    setOhMyConfig(prev => updater(prev));
  }, []);

  const handleProvidersChange = useCallback((providers: Record<string, ProviderConfig>) => {
    setConfig(prev => ({ ...prev, provider: providers }));
  }, []);

  const handleToggleProvider = useCallback((providerId: string, enabled: boolean) => {
    setConfig(prev => {
      const disabled = prev.disabled_providers || [];
      const next = enabled
        ? disabled.filter(id => id !== providerId)
        : [...new Set([...disabled, providerId])];
      return { ...prev, disabled_providers: next };
    });
  }, []);

  const handleAddProvider = useCallback(
    (baseUrl: string, apiKey: string, models: string[], providerName: string) => {
      const providerId = providerName.toLowerCase().replace(/\s+/g, '-');
      const newProvider: ProviderConfig = {
        npm: '@ai-sdk/openai-compatible',
        name: providerName,
        options: { baseURL: baseUrl, apiKey },
        models: Object.fromEntries(models.map(id => [id, { name: id }])),
      };
      setConfig(prev => ({
        ...prev,
        provider: { ...prev.provider, [providerId]: newProvider },
      }));
      toast.success(`Added provider "${providerName}" with ${models.length} models`);
    },
    []
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-void-base">
        <Header
          title="OpenCode Config"
          subtitle="Manage OpenCode and Oh-My-OpenAgent configuration"
          icon={<Settings size={18} />}
        />
        <AiTopTabs />
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header
        title="OpenCode Config"
        subtitle="Manage OpenCode and Oh-My-OpenAgent configuration"
        icon={<Settings size={18} />}
        actions={
          <Button onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save All'}
          </Button>
        }
      />
      <AiTopTabs />

      <div className="flex-1 overflow-auto">
        <div className="sticky top-0 z-10 bg-vsc-bg/80 backdrop-blur-xl border-b border-vsc-border px-6 py-3">
          <SegmentedControl
            options={TAB_OPTIONS}
            value={activeTab}
            onChange={(value) => setActiveTab(value as ConfigTab)}
          />
        </div>

        <div className="p-6">
          {activeTab === 'providers' && (
            <ProvidersSection
              providers={config.provider || {}}
              disabledProviders={config.disabled_providers || []}
              onChange={handleProvidersChange}
              onToggleEnabled={handleToggleProvider}
            />
          )}

          {activeTab === 'agents' && (
            <AgentsSection
              opencodeConfig={config}
              ohMyConfig={ohMyConfig}
              onOpencodeChange={updateConfig}
              onOhMyChange={updateOhMyConfig}
            />
          )}

          {activeTab === 'general' && (
            <GeneralSection
              config={config}
              ohMyConfig={ohMyConfig}
              onChange={updateConfig}
              onOhMyChange={updateOhMyConfig}
            />
          )}

          {activeTab === 'models' && (
            <ModelsSection
              providers={config.provider || {}}
              defaultModel={config.model}
              smallModel={config.small_model}
              onSetDefault={(m) => updateConfig(prev => ({ ...prev, model: m }))}
              onSetSmall={(m) => updateConfig(prev => ({ ...prev, small_model: m }))}
            />
          )}

          {activeTab === 'tester' && (
            <ApiTesterSection onAddProvider={handleAddProvider} />
          )}
        </div>
      </div>
    </div>
  );
}
