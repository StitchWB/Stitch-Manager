import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Package, Save, Server, Settings, Sliders, TestTube } from 'lucide-react';
import { toast } from 'sonner';

import { AgentsSection } from '@/components/opencode/AgentsSection';
import { ApiTesterSection } from '@/components/opencode/ApiTesterSection';
import { GeneralSection } from '@/components/opencode/GeneralSection';
import { ModelsSection } from '@/components/opencode/ModelsSection';
import { ProvidersSection } from '@/components/opencode/ProvidersSection';
import Header from '@/components/layout/Header';
import { Button, LoadingSpinner, PageHeader, StatusBadge, TabButton } from '@/components/ui';
import { useAppStore } from '@/stores/app';
import {
  getOhMyOpenAgentConfig,
  getOpenCodeConfig,
  setOhMyOpenAgentConfig,
  setOpenCodeConfig,
  validateModelConfig,
  type OhMyOpenAgentConfig,
  type OpenCodeConfig,
  type ProviderConfig,
} from '@/lib/backend/modules/opencodeConfig';

type ConfigTab = 'providers' | 'agents' | 'general' | 'models' | 'tester';

const CONFIG_TABS: readonly ConfigTab[] = ['providers', 'agents', 'general', 'models', 'tester'];
const LEGACY_TAB_STORAGE_KEY = 'opencode-config-active-tab';

function normalizeTab(value: string | null): ConfigTab {
  return CONFIG_TABS.includes(value as ConfigTab) ? (value as ConfigTab) : 'providers';
}

export default function OpenCodeConfig() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab = normalizeTab(rawTab);
  const migratedLegacyTab = useRef(false);
  const language = useAppStore(state => state.language);
  const copy =
    language === 'ru'
      ? {
          eyebrow: 'AI Hub / Подключения / OpenCode',
          title: 'Конфигурация OpenCode',
          description: 'Провайдеры, роли агентов, модели и инструменты проверки в одном месте.',
          sectionsLabel: 'Разделы OpenCode',
          unsaved: 'Есть несохранённые изменения',
          save: 'Сохранить конфигурацию',
          loading: 'Загрузка конфигурации…',
        }
      : {
          eyebrow: 'AI Hub / Connections / OpenCode',
          title: 'OpenCode configuration',
          description: 'Manage providers, agent roles, model assignments and testing tools in one place.',
          sectionsLabel: 'OpenCode sections',
          unsaved: 'Unsaved changes',
          save: 'Save configuration',
          loading: 'Loading configuration…',
        };
  const tabOptions = useMemo(
    () =>
      language === 'ru'
        ? [
            { value: 'providers', label: 'Провайдеры', icon: Server },
            { value: 'agents', label: 'Агенты', icon: Bot },
            { value: 'general', label: 'Общее', icon: Sliders },
            { value: 'models', label: 'Модели', icon: Package },
            { value: 'tester', label: 'API-тестер', icon: TestTube },
          ]
        : [
            { value: 'providers', label: 'Providers', icon: Server },
            { value: 'agents', label: 'Agents', icon: Bot },
            { value: 'general', label: 'General', icon: Sliders },
            { value: 'models', label: 'Models', icon: Package },
            { value: 'tester', label: 'API Tester', icon: TestTube },
          ],
    [language]
  );
  const [config, setConfig] = useState<OpenCodeConfig>({});
  const [ohMyConfig, setOhMyConfig] = useState<OhMyOpenAgentConfig>({});
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const currentSnapshot = useMemo(
    () => JSON.stringify({ config, ohMyConfig }),
    [config, ohMyConfig]
  );
  const isDirty = savedSnapshot !== '' && currentSnapshot !== savedSnapshot;

  useEffect(() => {
    if (rawTab !== null && rawTab !== activeTab) {
      setSearchParams({ tab: activeTab }, { replace: true });
    }
  }, [rawTab, activeTab, setSearchParams]);

  useEffect(() => {
    if (migratedLegacyTab.current) return;
    migratedLegacyTab.current = true;
    if (searchParams.get('tab')) return;
    const legacy = window.localStorage.getItem(LEGACY_TAB_STORAGE_KEY);
    if (!legacy) return;
    setSearchParams({ tab: normalizeTab(legacy) }, { replace: true });
    window.localStorage.removeItem(LEGACY_TAB_STORAGE_KEY);
  }, [searchParams, setSearchParams]);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const [oc, om] = await Promise.all([getOpenCodeConfig(), getOhMyOpenAgentConfig()]);
      const nextConfig = oc || { provider: {} };
      const nextOhMyConfig = om || {};
      setConfig(nextConfig);
      setOhMyConfig(nextOhMyConfig);
      setSavedSnapshot(JSON.stringify({ config: nextConfig, ohMyConfig: nextOhMyConfig }));
    } catch (error) {
      toast.error('Failed to load config');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadConfig();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConfig]);

  const handleSave = useCallback(async () => {
    const errors = validateModelConfig(config);
    if (errors.length > 0) {
      errors.forEach(err => toast.error(err));
      return;
    }
    try {
      setSaving(true);
      await Promise.all([setOpenCodeConfig(config), setOhMyOpenAgentConfig(ohMyConfig)]);
      setSavedSnapshot(JSON.stringify({ config, ohMyConfig }));
      toast.success('Configuration saved');
    } catch (error) {
      toast.error('Failed to save config');
      console.error(error);
    } finally {
      setSaving(false);
    }
  }, [config, ohMyConfig]);

  const updateConfig = useCallback((updater: (value: OpenCodeConfig) => OpenCodeConfig) => {
    setConfig(previous => updater(previous));
  }, []);

  const updateOhMyConfig = useCallback(
    (updater: (value: OhMyOpenAgentConfig) => OhMyOpenAgentConfig) => {
      setOhMyConfig(previous => updater(previous));
    },
    []
  );

  const handleProvidersChange = useCallback((providers: Record<string, ProviderConfig>) => {
    setConfig(previous => ({ ...previous, provider: providers }));
  }, []);

  const handleToggleProvider = useCallback((providerId: string, enabled: boolean) => {
    setConfig(previous => {
      const disabled = previous.disabled_providers || [];
      const next = enabled
        ? disabled.filter(id => id !== providerId)
        : [...new Set([...disabled, providerId])];
      return { ...previous, disabled_providers: next };
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
      setConfig(previous => ({
        ...previous,
        provider: { ...previous.provider, [providerId]: newProvider },
      }));
      toast.success(`Added provider "${providerName}" with ${models.length} models`);
    },
    []
  );

  const pageActions = (
    <div className="flex items-center gap-2">
      {isDirty ? (
        <StatusBadge status="warning" size="sm" withDot>
          {copy.unsaved}
        </StatusBadge>
      ) : null}
      <Button
        variant="primary"
        size="sm"
        onClick={() => void handleSave()}
        disabled={saving || !isDirty}
        isLoading={saving}
        leftIcon={<Save size={14} />}
      >
        {copy.save}
      </Button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void-base">
      <Header title="AI Hub" icon={<Settings size={18} />} />
      <nav
        aria-label={copy.sectionsLabel}
        className="shrink-0 overflow-x-auto border-b border-vsc-border bg-vsc-sidebar/85 px-3 md:px-5 [scrollbar-width:thin]"
      >
        <div className="flex h-11 min-w-max items-center gap-1">
          {tabOptions.map(option => {
            const Icon = option.icon;
            const active = option.value === activeTab;
            return (
              <TabButton
                key={option.value}
                active={active}
                appearance="section"
                size="sm"
                onClick={() => setSearchParams({ tab: option.value })}
                aria-current={active ? 'page' : undefined}
                title={option.label}
                icon={<Icon size={14} />}
                label={option.label}
              />
            );
          })}
        </div>
      </nav>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={loading ? undefined : pageActions}
      />

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
          <LoadingSpinner />
          {copy.loading}
        </div>
      ) : (
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto w-full max-w-7xl">
              {activeTab === 'providers' ? (
                <ProvidersSection
                  providers={config.provider || {}}
                  disabledProviders={config.disabled_providers || []}
                  onChange={handleProvidersChange}
                  onToggleEnabled={handleToggleProvider}
                />
              ) : null}
              {activeTab === 'agents' ? (
                <AgentsSection
                  opencodeConfig={config}
                  ohMyConfig={ohMyConfig}
                  onOpencodeChange={updateConfig}
                  onOhMyChange={updateOhMyConfig}
                />
              ) : null}
              {activeTab === 'general' ? (
                <GeneralSection
                  config={config}
                  ohMyConfig={ohMyConfig}
                  onChange={updateConfig}
                  onOhMyChange={updateOhMyConfig}
                />
              ) : null}
              {activeTab === 'models' ? (
                <ModelsSection
                  providers={config.provider || {}}
                  defaultModel={config.model}
                  smallModel={config.small_model}
                  onSetDefault={model => updateConfig(previous => ({ ...previous, model }))}
                  onSetSmall={model => updateConfig(previous => ({ ...previous, small_model: model }))}
                />
              ) : null}
              {activeTab === 'tester' ? (
                <div className="max-w-4xl">
                  <ApiTesterSection onAddProvider={handleAddProvider} />
                </div>
              ) : null}
            </div>
        </main>
      )}
    </div>
  );
}
