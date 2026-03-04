import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Trash2,
  Settings2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  Plus,
  Copy,
  ShieldCheck,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { ChatHistory, ChatInput } from '../components/chat';
import { useChat } from '../hooks/useChat';
import { useChatStore } from '../stores/chat';
import { useAppStore } from '../stores/app';
import type { ContentBlock } from '../types/generated';
import { t } from '../lib/i18n';
import { Button } from '../components/ui/Button';
import { LoadingSpinner, Select, Textarea, Input, Checkbox } from '../components/ui';
import { Tooltip } from '../components/Tooltip';
import {
  getAvailableModelsSafe as getAiProxyAvailableModels,
  getProxySettings,
  getProxyStatus,
  startAiProxy,
  getProviderCapabilities,
  getProviderModelMappings,
  getRequestHistorySafe,
  getDailyStatsSafe,
  getCostEstimateSafe,
} from '@/lib/tauri/modules/aiProxy';
import {
  getAntigravityApiKeys,
  getGeminiApiKeys,
  getOpenAIApiKeys,
} from '@/lib/tauri/modules/apiKeys';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  source: 'aiProxy';
}

interface SetupSnapshot {
  geminiKeys: number;
  openaiKeys: number;
  antigravityKeys: number;
  enabledProviderAccounts: number;
  totalProviderAccounts: number;
  mappingCount: number;
}

const CHAT_PROXY_API_KEY = 'proxypal-local';

/**
 * Chat page component for debugging the AI Proxy endpoint.
 * Features streaming responses, message history, and error handling.
 */
export default function Chat() {
  const navigate = useNavigate();
  const { language } = useAppStore();
  const {
    model,
    setModel,
    profiles,
    activeProfileId,
    createProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    forceOverride,
    setForceOverride,
    resetForceOverride,
  } = useChatStore();

  const [showSettings, setShowSettings] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [proxyRunning, setProxyRunning] = useState(false);
  const [proxyMode, setProxyMode] = useState('full');
  const [proxyPort, setProxyPort] = useState(8317);
  const [setup, setSetup] = useState<SetupSnapshot>({
    geminiKeys: 0,
    openaiKeys: 0,
    antigravityKeys: 0,
    enabledProviderAccounts: 0,
    totalProviderAccounts: 0,
    mappingCount: 0,
  });

  const [aiProxyModels, setAiProxyModels] = useState<ModelInfo[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [requestLogs, setRequestLogs] = useState<Array<import('../types/generated').RequestLog>>(
    []
  );
  const [dailyStats, setDailyStats] = useState<import('../types/generated').DailyStats | null>(
    null
  );
  const [costEstimate, setCostEstimate] = useState<number | null>(null);
  const [inspectorMessageId, setInspectorMessageId] = useState<string | null>(null);

  // Chat is a debug client for AI Proxy OpenAI-compatible endpoint
  const apiUrl = `http://127.0.0.1:${proxyPort}/v1/chat/completions`;

  // Force re-render when language changes
  void language;

  const { messages, isLoading, error, sendMessage, clearMessages, stopGeneration } = useChat({
    apiUrl,
    model,
    apiKey: CHAT_PROXY_API_KEY,
  });

  const fetchSetup = useCallback(async () => {
    setSetupLoading(true);
    setSetupError(null);

    try {
      const [proxyStatus, proxySettings] = await Promise.all([
        getProxyStatus(),
        getProxySettings(),
      ]);

      const [geminiKeys, openaiKeys, antigravityKeys, capabilities, mappings] = await Promise.all([
        getGeminiApiKeys(),
        getOpenAIApiKeys(),
        getAntigravityApiKeys(),
        getProviderCapabilities(),
        getProviderModelMappings(),
      ]);

      const availableModels = proxyStatus.running ? await getAiProxyAvailableModels() : [];

      const [history, stats, cost] = await Promise.all([
        getRequestHistorySafe(20, 0),
        getDailyStatsSafe(),
        getCostEstimateSafe(),
      ]);

      const hasAnyConfiguredKey =
        geminiKeys.length > 0 || openaiKeys.length > 0 || antigravityKeys.length > 0;

      setProxyRunning(proxyStatus.running);
      setProxyMode(proxySettings.appMode);
      setProxyPort(proxySettings.proxyPort);

      const enabledProviderAccounts = capabilities.reduce(
        (acc, item) => acc + item.enabledAccounts,
        0
      );
      const totalProviderAccounts = capabilities.reduce((acc, item) => acc + item.totalAccounts, 0);

      setSetup({
        geminiKeys: geminiKeys.length,
        openaiKeys: openaiKeys.length,
        antigravityKeys: antigravityKeys.length,
        enabledProviderAccounts,
        totalProviderAccounts,
        mappingCount: mappings.length,
      });

      setAiProxyModels(
        availableModels.map(m => ({
          id: m.id,
          name: m.id,
          provider: m.provider || m.ownedBy || 'Unknown',
          source: 'aiProxy',
        }))
      );

      if (availableModels.length === 0 && proxyStatus.running && hasAnyConfiguredKey) {
        setSetupError(
          'Proxy is running but returned no models yet. Check provider mappings/accounts or restart AI Proxy.'
        );
      }
      setRequestLogs(history);
      setDailyStats(stats);
      setCostEstimate(cost);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to load provider setup');
      setAiProxyModels([]);
      setRequestLogs([]);
      setDailyStats(null);
      setCostEstimate(null);
    } finally {
      setSetupLoading(false);
    }
  }, []);

  const modelList = aiProxyModels;

  const totalApiKeys = setup.geminiKeys + setup.openaiKeys + setup.antigravityKeys;
  const hasProviderSetup = setup.enabledProviderAccounts > 0 || totalApiKeys > 0;
  const hasModels = modelList.length > 0;

  const setupBlockReason = !proxyRunning
    ? 'AI Proxy isn’t running. Start it in Settings to enable debug chat.'
    : proxyMode === 'quota-only'
      ? 'AI Proxy is in quota-only mode. Switch to Full mode to use debug chat.'
      : !hasProviderSetup
        ? 'Set up providers or API keys in AI Proxy → Providers/Keys to enable debug chat.'
        : !hasModels
          ? 'No models available from the current AI Proxy setup.'
          : null;

  const handleStartProxy = useCallback(async () => {
    try {
      setSetupError(null);
      await startAiProxy();
      await fetchSetup();
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to start AI Proxy');
    }
  }, [fetchSetup]);

  // Fetch AI Proxy setup on mount
  useEffect(() => {
    fetchSetup();
  }, [fetchSetup]);

  useEffect(() => {
    const modelExists = modelList.some(m => m.id === model);
    if ((!model || !modelExists) && modelList.length > 0) {
      setModel(modelList[0].id);
    }
  }, [model, modelList, setModel]);

  const handleClearChat = useCallback(() => {
    if (messages.length > 0) {
      clearMessages();
    }
  }, [messages.length, clearMessages]);

  const groupedMergedModels = modelList.reduce(
    (acc, m) => {
      const provider = m.provider || 'Other';
      if (!acc[provider]) acc[provider] = [];
      acc[provider].push(m);
      return acc;
    },
    {} as Record<string, ModelInfo[]>
  );

  const selectedModel = modelList.find(m => m.id === model);
  const selectedModelSupportsVision = useMemo(() => {
    if (!selectedModel) return false;
    const id = selectedModel.id.toLowerCase();
    return (
      id.includes('vision') ||
      id.includes('gpt-4o') ||
      id.includes('omni') ||
      id.includes('gemini') ||
      id.includes('claude-3') ||
      id.includes('claude-sonnet-4') ||
      id.includes('claude-opus-4')
    );
  }, [selectedModel]);
  const activeProfile = profiles.find(profile => profile.id === activeProfileId) || profiles[0];
  const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
  const lastRoutedProvider = lastAssistantMessage?.routedProvider;
  const lastRoutedModel = lastAssistantMessage?.routedModel;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('chat.title') || 'Chat'}
        subtitle={t('chat.subtitle') || 'AI Proxy Debug Client'}
        icon={<MessageSquare size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <Tooltip content="Settings">
              <Button
                onClick={() => setShowSettings(!showSettings)}
                variant="secondary"
                size="sm"
                className={showSettings ? 'bg-white/10' : ''}
                leftIcon={<Settings2 className="w-3.5 h-3.5" />}
              >
                {t('chat.settings') || 'Settings'}
              </Button>
            </Tooltip>
            <Tooltip content="Clear chat">
              <Button
                onClick={handleClearChat}
                disabled={messages.length === 0}
                variant="secondary"
                size="sm"
                leftIcon={<Trash2 className="w-3.5 h-3.5" />}
              >
                {t('chat.clear') || 'Clear'}
              </Button>
            </Tooltip>
          </div>
        }
      />

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b border-vsc-border bg-vsc-sidebar/30 p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-vsc-text">{'AI Proxy Debug Client'}</h3>
              {!proxyRunning && (
                <span className="text-xs text-vsc-yellow flex items-center gap-1">
                  <AlertCircle size={12} />
                  {'AI Proxy not running (debug chat disabled)'}
                </span>
              )}
            </div>
            <p className="text-2xs text-vsc-text-muted mb-3">
              {
                'Debug-only. Use this page to validate AI Proxy routing; configure providers and keys in AI Proxy settings for IDE/CLI usage.'
              }
            </p>

            <div className="mb-3 p-3 bg-vsc-panel/50 rounded-lg border border-vsc-border">
              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-vsc-text">
                <ShieldCheck size={14} />
                Debug Profiles & Force Routing
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="chat-profile" className="block text-2xs text-vsc-text-muted mb-1">
                    Profile
                  </label>
                  <div className="flex gap-2">
                    <Select
                      id="chat-profile"
                      value={activeProfileId}
                      onChange={e => setActiveProfile(e.target.value)}
                      className="flex-1 px-2 py-1.5 bg-vsc-input border border-vsc-border rounded text-xs text-vsc-text"
                      shellClassName="bg-vsc-input border-vsc-border"
                    >
                      {profiles.map(profile => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => createProfile(`Profile ${profiles.length + 1}`)}
                      leftIcon={<Plus size={12} />}
                    />
                    {profiles.length > 1 && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => deleteProfile(activeProfileId)}
                      >
                        Del
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="chat-temperature"
                    className="block text-2xs text-vsc-text-muted mb-1"
                  >
                    Temperature
                  </label>
                  <Input
                    id="chat-temperature"
                    type="number"
                    step="0.1"
                    min={0}
                    max={2}
                    value={String(activeProfile?.temperature ?? 1)}
                    onChange={e =>
                      updateProfile(activeProfileId, {
                        temperature: Number(e.target.value),
                      })
                    }
                    className="bg-vsc-input border-vsc-border text-xs text-vsc-text"
                    shellClassName="bg-vsc-input border-vsc-border"
                  />
                </div>
                <div>
                  <label
                    htmlFor="chat-max-tokens"
                    className="block text-2xs text-vsc-text-muted mb-1"
                  >
                    Max Tokens
                  </label>
                  <Input
                    id="chat-max-tokens"
                    type="number"
                    min={128}
                    max={32768}
                    value={String(activeProfile?.maxTokens ?? 4096)}
                    onChange={e =>
                      updateProfile(activeProfileId, {
                        maxTokens: Number(e.target.value),
                      })
                    }
                    className="bg-vsc-input border-vsc-border text-xs text-vsc-text"
                    shellClassName="bg-vsc-input border-vsc-border"
                  />
                </div>
              </div>
              <div className="mt-2">
                <label
                  htmlFor="chat-system-prompt"
                  className="block text-2xs text-vsc-text-muted mb-1"
                >
                  System Prompt
                </label>
                <Textarea
                  id="chat-system-prompt"
                  value={activeProfile?.systemPrompt ?? ''}
                  onChange={e => updateProfile(activeProfileId, { systemPrompt: e.target.value })}
                  rows={2}
                  className="bg-vsc-input border-vsc-border text-xs text-vsc-text"
                  shellClassName="bg-vsc-input border-vsc-border"
                  placeholder="Optional debug system prompt"
                />
              </div>
              <div className="mt-3 border-t border-vsc-border pt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                <Checkbox
                  checked={forceOverride.enabled}
                  onChange={e => setForceOverride({ enabled: e.target.checked })}
                  label="Force routing"
                  className="px-0 py-0 hover:bg-transparent"
                />
                <Input
                  value={forceOverride.provider}
                  onChange={e => setForceOverride({ provider: e.target.value })}
                  placeholder="provider"
                  disabled={!forceOverride.enabled}
                  className="bg-vsc-input border-vsc-border text-2xs text-vsc-text"
                  shellClassName="bg-vsc-input border-vsc-border"
                />
                <Input
                  value={forceOverride.modelId}
                  onChange={e => setForceOverride({ modelId: e.target.value })}
                  placeholder="model id"
                  disabled={!forceOverride.enabled}
                  className="bg-vsc-input border-vsc-border text-2xs text-vsc-text"
                  shellClassName="bg-vsc-input border-vsc-border"
                />
                <div className="flex gap-2">
                  <Input
                    value={forceOverride.accountId}
                    onChange={e => setForceOverride({ accountId: e.target.value })}
                    placeholder="account id"
                    disabled={!forceOverride.enabled}
                    className="bg-vsc-input border-vsc-border text-2xs text-vsc-text"
                    shellClassName="bg-vsc-input border-vsc-border"
                  />
                  <Button variant="ghost" size="xs" onClick={resetForceOverride} type="button">
                    Reset
                  </Button>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="block text-xs font-medium text-vsc-text-muted mb-1.5">
                  {t('chat.apiUrl') || 'AI Proxy Endpoint (Debug)'}
                </div>
                <div
                  className="w-full px-3 py-2 bg-vsc-input border border-vsc-border rounded-lg 
                               text-sm text-vsc-text font-mono"
                >
                  {apiUrl}
                </div>
                <p className="text-2xs text-vsc-text-muted mt-1">
                  {'IDE/CLI clients should use the AI Proxy settings pages for setup.'}
                </p>
              </div>
              <div>
                <div className="block text-xs font-medium text-vsc-text-muted mb-1.5">
                  {t('chat.availableModels') || 'AI Proxy Models'}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-vsc-text">{modelList.length} models</span>
                  <Button
                    onClick={fetchSetup}
                    disabled={setupLoading}
                    variant="secondary"
                    size="xs"
                    leftIcon={setupLoading ? <LoadingSpinner size="xs" /> : <RefreshCw size={12} />}
                  />
                </div>
                {setupError && <p className="text-2xs text-vsc-red mt-1">{setupError}</p>}
                <div className="mt-2 text-2xs text-vsc-text-muted space-y-1">
                  <div>
                    API keys: gemini {setup.geminiKeys}, openai {setup.openaiKeys}, antigravity{' '}
                    {setup.antigravityKeys}
                  </div>
                  <div>
                    Provider accounts: {setup.enabledProviderAccounts} active /{' '}
                    {setup.totalProviderAccounts} total
                  </div>
                  <div>Model mappings: {setup.mappingCount}</div>
                  <div>AI Proxy mode: {proxyMode}</div>
                  {dailyStats && (
                    <div>
                      Requests today: {dailyStats.totalRequests} (ok {dailyStats.successfulRequests}{' '}
                      / fail {dailyStats.failedRequests}), avg{' '}
                      {Math.round(dailyStats.avgDurationMs)} ms
                    </div>
                  )}
                  {costEstimate != null && <div>Estimated cost: ${costEstimate.toFixed(4)}</div>}
                </div>
              </div>
            </div>

            {setupBlockReason && (
              <div className="mt-3 rounded-lg border border-vsc-yellow/40 bg-vsc-yellow/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-vsc-yellow">{setupBlockReason}</div>
                  <div className="flex items-center gap-2">
                    {!proxyRunning && (
                      <Button variant="secondary" size="xs" onClick={handleStartProxy}>
                        Start AI Proxy
                      </Button>
                    )}
                    <Button variant="secondary" size="xs" onClick={() => navigate('/settings')}>
                      AI Proxy Settings
                    </Button>
                    <Button variant="secondary" size="xs" onClick={() => navigate('/api-keys')}>
                      API Keys
                    </Button>
                    <Button variant="secondary" size="xs" onClick={() => navigate('/ai-providers')}>
                      Providers
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="border-b border-vsc-red/30 bg-vsc-red/10 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-vsc-red shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-vsc-red font-medium">{t('chat.error') || 'Error'}</p>
              <p className="text-xs text-vsc-red/80 truncate">{error}</p>
            </div>
            <Button
              onClick={() => {
                const previousContent = messages[messages.length - 2]?.content;
                const retryText =
                  typeof previousContent === 'string'
                    ? previousContent
                    : previousContent
                        ?.filter(block => block.type === 'text')
                        .map(block => block.text)
                        .join('\n') || '';
                const retryAttachments =
                  typeof previousContent === 'string'
                    ? []
                    : (previousContent?.filter(
                        (block): block is ContentBlock & { type: 'image' } => block.type === 'image'
                      ) ?? []);
                void sendMessage(retryText, retryAttachments);
              }}
              variant="danger"
              size="xs"
              leftIcon={<RefreshCw size={12} />}
            >
              {t('chat.retry') || 'Retry'}
            </Button>
          </div>
        </div>
      )}

      {/* Chat History */}
      <ChatHistory messages={messages} isLoading={isLoading} />

      {/* Inspector */}
      {messages.some(m => m.role === 'assistant' && m.debug) && (
        <div className="border-t border-vsc-border bg-vsc-sidebar/40 px-4 py-3">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-medium text-vsc-text">Request / Response Inspector</div>
              <div className="flex items-center gap-2">
                <Select
                  value={inspectorMessageId || ''}
                  onChange={e => setInspectorMessageId(e.target.value || null)}
                  className="px-2 py-1 bg-vsc-input border border-vsc-border rounded text-2xs text-vsc-text"
                  shellClassName="bg-vsc-input border-vsc-border"
                >
                  <option value="">Latest</option>
                  {[...messages]
                    .filter(m => m.role === 'assistant' && m.debug)
                    .slice()
                    .reverse()
                    .map(m => (
                      <option key={m.id} value={m.id}>
                        {new Date(m.timestamp).toLocaleTimeString()} •{' '}
                        {m.routedProvider || 'unknown'}
                      </option>
                    ))}
                </Select>
                <Button
                  variant="ghost"
                  size="xs"
                  leftIcon={<Copy size={12} />}
                  onClick={async () => {
                    const target =
                      messages.find(m => m.id === inspectorMessageId) ||
                      [...messages].reverse().find(m => m.role === 'assistant' && m.debug);
                    if (!target?.debug) return;
                    await navigator.clipboard.writeText(JSON.stringify(target.debug, null, 2));
                  }}
                >
                  Copy JSON
                </Button>
              </div>
            </div>
            {(() => {
              const target =
                messages.find(m => m.id === inspectorMessageId) ||
                [...messages].reverse().find(m => m.role === 'assistant' && m.debug);
              if (!target?.debug) return null;
              const debug = target.debug;
              const requestLog = requestLogs.find(
                log => log.model === (target.routedModel || target.requestedModel)
              );
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <pre className="text-2xs text-vsc-text bg-vsc-input border border-vsc-border rounded p-2 overflow-auto max-h-48">
                    {JSON.stringify(
                      {
                        apiUrl: debug.apiUrl,
                        startedAt: debug.startedAt,
                        durationMs: debug.durationMs,
                        force: {
                          provider: debug.forceProvider,
                          modelId: debug.forceModelId,
                          accountId: debug.forceAccountId,
                        },
                        requestHeaders: debug.requestHeaders,
                        requestBody: debug.requestBody,
                      },
                      null,
                      2
                    )}
                  </pre>
                  <pre className="text-2xs text-vsc-text bg-vsc-input border border-vsc-border rounded p-2 overflow-auto max-h-48">
                    {JSON.stringify(
                      {
                        routedProvider: target.routedProvider,
                        routedModel: target.routedModel,
                        requestedModel: target.requestedModel,
                        responseStatus: debug.responseStatus,
                        responseHeaders: debug.responseHeaders,
                        error: debug.error,
                        requestLog,
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Model Selector + Chat Input */}
      <div className="border-t border-vsc-border bg-vsc-sidebar/50">
        {/* Model Selector Row */}
        <div className="px-4 py-2 border-b border-vsc-border/50">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <span className="text-xs text-vsc-text-muted">{t('chat.model') || 'Model'}:</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                disabled={setupLoading || modelList.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 bg-vsc-input border border-vsc-border 
                             rounded-lg text-sm text-vsc-text hover:border-vsc-blue/50 transition-colors
                             disabled:opacity-50 min-w-[200px] justify-between"
              >
                <span className="truncate">
                  {setupLoading ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner size="xs" />
                      Loading...
                    </span>
                  ) : selectedModel ? (
                    `${selectedModel.name}${selectedModel.source === 'aiProxy' ? ' • AI Proxy' : ''}`
                  ) : (
                    'Select model...'
                  )}
                </span>
                <ChevronDown
                  size={14}
                  className={`transition-transform ${showModelDropdown ? 'rotate-180' : ''}`}
                />
              </button>

              {/* Dropdown */}
              {showModelDropdown && !setupLoading && (
                <div
                  className="absolute bottom-full left-0 mb-1 w-80 max-h-80 overflow-y-auto
                               bg-vsc-sidebar border border-vsc-border rounded-lg shadow-xl z-50"
                >
                  {Object.entries(groupedMergedModels).map(([provider, providerModels]) => (
                    <div key={provider}>
                      <div className="px-3 py-1.5 text-xs font-medium text-vsc-text-muted bg-vsc-panel/50 sticky top-0">
                        {provider}
                      </div>
                      {providerModels.map(m => (
                        <button
                          type="button"
                          key={m.id}
                          onClick={() => {
                            setModel(m.id);
                            setShowModelDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-vsc-hover transition-colors
                                     ${m.id === model ? 'bg-vsc-blue/20 text-vsc-blue' : 'text-vsc-text'}`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span>{m.name}</span>
                            <span className="text-2xs text-vsc-text-muted">{'AI Proxy'}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {modelList.length === 0 && (
                    <div className="px-3 py-4 text-center text-sm text-vsc-text-muted">
                      No models available
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedModel && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-vsc-text-muted px-2 py-0.5 bg-vsc-input rounded">
                  {selectedModel.provider}
                </span>
                {lastRoutedProvider && (
                  <span className="text-xs text-vsc-text-muted px-2 py-0.5 bg-vsc-input rounded border border-vsc-border capitalize">
                    routed: {lastRoutedProvider}
                    {lastRoutedModel ? ` (${lastRoutedModel})` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Chat Input */}
        <ChatInput
          onSend={sendMessage}
          onStop={stopGeneration}
          isLoading={isLoading}
          disabled={!!setupBlockReason || !selectedModel}
          allowImageAttachments={selectedModelSupportsVision}
          placeholder={t('chat.placeholder') || 'Type a message...'}
        />
      </div>
    </div>
  );
}
