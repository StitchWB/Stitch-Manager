import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  X,
  Pencil,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import { ChatHistory, ChatInput } from '../components/chat';
import { useChat } from '../hooks/useChat';
import { useChatStore, type ChatSession } from '../stores/chat';
import { useAppStore } from '../stores/app';
import type { ContentBlock, ModelInfo } from '../types/generated';
import { t } from '../lib/i18n';
import { isZaiChatModel, resolveChatCompletionsUrl } from './chatRouting';

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
  getZaiApiKeys,
} from '@/lib/tauri/modules/apiKeys';
import { Button, ButtonBase, Checkbox, EmptyState, Input, LoadingSpinner, Select, StatusBadge, Textarea, Tooltip } from '@/components/ui';

interface ChatModelInfo extends ModelInfo {
  name: string;
}

interface SetupSnapshot {
  geminiKeys: number;
  openaiKeys: number;
  antigravityKeys: number;
  zaiKeys: number;
  freemodelKey: boolean;
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
  const location = useLocation();
  const { language } = useAppStore();
  // Individual selectors: Zustand guarantees function identity is stable,
  // and primitive/string values are compared by Object.is. Only array/object
  // selectors that compute a new value each call need special handling.
  const sessions = useChatStore(state => state.sessions);
  const activeSessionId = useChatStore(state => state.activeSessionId);
  const model = useChatStore(
    useCallback(
      (state: { sessions: ChatSession[]; activeSessionId: string }) =>
        state.sessions.find(s => s.id === state.activeSessionId)?.model ?? 'auto',
      []
    )
  );
  const inspectorOpen = useChatStore(state => state.inspectorOpen);
  const setSessionModel = useChatStore(state => state.setSessionModel);
  const createSession = useChatStore(state => state.createSession);
  const switchSession = useChatStore(state => state.switchSession);
  const deleteSession = useChatStore(state => state.deleteSession);
  const renameSession = useChatStore(state => state.renameSession);
  const setInspectorOpen = useChatStore(state => state.setInspectorOpen);
  const profiles = useChatStore(state => state.profiles);
  const activeProfileId = useChatStore(state => state.activeProfileId);
  const createProfile = useChatStore(state => state.createProfile);
  const updateProfile = useChatStore(state => state.updateProfile);
  const deleteProfile = useChatStore(state => state.deleteProfile);
  const setActiveProfile = useChatStore(state => state.setActiveProfile);
  const forceOverride = useChatStore(state => state.forceOverride);
  const setForceOverride = useChatStore(state => state.setForceOverride);
  const resetForceOverride = useChatStore(state => state.resetForceOverride);

  const [showSettings, setShowSettings] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [proxyRunning, setProxyRunning] = useState(false);
  const [proxyMode, setProxyMode] = useState('full');
  const [proxyPort, setProxyPort] = useState(25583);
  const [setup, setSetup] = useState<SetupSnapshot>({
    geminiKeys: 0,
    openaiKeys: 0,
    antigravityKeys: 0,
    zaiKeys: 0,
    freemodelKey: false,
    enabledProviderAccounts: 0,
    totalProviderAccounts: 0,
    mappingCount: 0,
  });

  const [aiProxyModels, setAiProxyModels] = useState<ChatModelInfo[]>([]);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [requestLogs, setRequestLogs] = useState<Array<import('../types/generated').RequestLog>>(
    []
  );
  const [dailyStats, setDailyStats] = useState<import('../types/generated').DailyStats | null>(
    null
  );
  const [costEstimate, setCostEstimate] = useState<number | null>(null);
  const [inspectorMessageId, setInspectorMessageId] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const modelList = aiProxyModels;
  const activeRouteModel = modelList.find(m => m.id === model);
  const selectedModelUsesZaiRoute = isZaiChatModel(activeRouteModel);
  const chatApiUrl = resolveChatCompletionsUrl(activeRouteModel, proxyPort);
  const chatProvider = selectedModelUsesZaiRoute ? 'zai' : undefined;
  const apiUrl = chatApiUrl; // For display purposes

  // Force re-render when language changes
  void language;

  const { messages, isLoading, error, sendMessage, clearMessages, stopGeneration } = useChat({
    apiUrl: chatApiUrl,
    model,
    provider: chatProvider,
    apiKey: CHAT_PROXY_API_KEY,
  });

  // Reset error dismissed state when a new error appears
  useEffect(() => {
    if (error) setErrorDismissed(false);
  }, [error]);

  const fetchSetup = useCallback(async () => {
    setSetupLoading(true);
    setSetupError(null);

    try {
      const [proxyStatus, proxySettings] = await Promise.all([
        getProxyStatus(),
        getProxySettings(),
      ]);

      const [geminiKeys, openaiKeys, antigravityKeys, zaiKeys, capabilities, mappings] = await Promise.all([
        getGeminiApiKeys(),
        getOpenAIApiKeys(),
        getAntigravityApiKeys(),
        getZaiApiKeys(),
        getProviderCapabilities(),
        getProviderModelMappings(),
      ]);

      const availableModels = await getAiProxyAvailableModels();

      const [history, stats, cost] = await Promise.all([
        getRequestHistorySafe(20, 0),
        getDailyStatsSafe(),
        getCostEstimateSafe(),
      ]);

      const hasAnyConfiguredKey =
        geminiKeys.length > 0 || openaiKeys.length > 0 || antigravityKeys.length > 0 || zaiKeys.length > 0 || !!proxySettings.freemodelApiKey;

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
        zaiKeys: zaiKeys.length,
        freemodelKey: !!proxySettings.freemodelApiKey,
        enabledProviderAccounts,
        totalProviderAccounts,
        mappingCount: mappings.length,
      });

      setAiProxyModels(
        availableModels.map(m => ({
          id: m.id,
          name: m.id.startsWith('kiro-') ? `[kiro] ${m.id.replace('kiro-', '')}` : m.id,
          provider: m.id.startsWith('kiro-') ? 'kiro' : (m.provider || m.ownedBy || 'Unknown'),
          ownedBy: m.ownedBy || m.provider || 'Unknown',
          source: (m.source as 'aiProxy' | 'freemodel') || 'aiProxy',
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

  const totalApiKeys = setup.geminiKeys + setup.openaiKeys + setup.antigravityKeys + setup.zaiKeys;
  const hasProviderSetup = setup.enabledProviderAccounts > 0 || totalApiKeys > 0 || setup.freemodelKey;
  const hasModels = modelList.length > 0;

  const setupBlockReason = !selectedModelUsesZaiRoute && !proxyRunning
    ? 'AI Proxy is not running. Start it in Settings to enable debug chat.'
    : !selectedModelUsesZaiRoute && proxyMode === 'quota-only'
      ? 'AI Proxy is in quota-only mode. Switch to Full mode to use debug chat.'
      : !hasProviderSetup
        ? 'Set up providers or API keys in AI Proxy to enable debug chat.'
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
      setSessionModel(modelList[0].id);
    }
  }, [model, modelList, setSessionModel]);

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
    {} as Record<string, ChatModelInfo[]>
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

      {/* AI Hub tabs — shown when accessed via /ai/chat */}
      {location.pathname.startsWith('/ai/') && <AiTopTabs />}

      {/* Main content: session sidebar + chat area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Session sidebar */}
        <div className="w-52 shrink-0 border-r border-vsc-border bg-vsc-sidebar/30 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-vsc-border">
            <span className="text-xs font-medium text-vsc-text-muted">{t('chat.sessions')}</span>
            <ButtonBase
              type="button"
              onClick={() => createSession()}
              className="p-1 rounded hover:bg-vsc-hover text-vsc-text-muted hover:text-vsc-text transition-colors"
              title={t('chat.newChat')}
            >
              <Plus size={14} />
            </ButtonBase>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => switchSession(s.id)}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-vsc-hover transition-colors ${
                  s.id === activeSessionId ? 'bg-vsc-blue/10 border-l-2 border-vsc-blue' : ''
                }`}
              >
                <MessageSquare size={12} className="shrink-0 text-vsc-text-muted" />
                <span className="text-xs text-vsc-text truncate flex-1">{s.title}</span>
                <div className="hidden group-hover:flex items-center gap-0.5">
                  <ButtonBase
                    type="button"
                    onClick={e => { e.stopPropagation(); renameSession(s.id, prompt(t('chat.rename')) || s.title); }}
                    className="p-0.5 rounded hover:bg-vsc-hover text-vsc-text-muted hover:text-vsc-text transition-colors"
                    title={t('chat.rename')}
                  >
                    <Pencil size={10} />
                  </ButtonBase>
                  {sessions.length > 1 && (
                    <ButtonBase
                      type="button"
                      onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                      className="p-0.5 rounded hover:bg-vsc-hover text-vsc-text-muted hover:text-vsc-red transition-colors"
                      title={t('chat.deleteSession')}
                    >
                      <Trash2 size={10} />
                    </ButtonBase>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex flex-col flex-1 overflow-hidden">

      {/* Settings Panel */}
      {showSettings && (
        <div className="border-b border-vsc-border bg-vsc-sidebar/30 p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-vsc-text">
                AI Proxy Debug Client
              </h3>
              {!proxyRunning && (
                <span className="text-xs text-vsc-yellow flex items-center gap-1">
                  <AlertCircle size={12} />
                  {'AI Proxy not running (debug chat disabled)'}
                </span>
              )}
            </div>
            <p className="text-2xs text-vsc-text-muted mb-3">
              Debug-only. Use this page to validate AI Proxy routing; configure providers and keys in AI Proxy settings for IDE/CLI usage.
            </p>

            <div className="mb-3 p-3 bg-vsc-panel/50 rounded-lg border border-vsc-border">
              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-vsc-text">
                <ShieldCheck size={14} />
                {t('chat.debugProfilesTitle')}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="chat-profile" className="block text-2xs text-vsc-text-muted mb-1">
                    {t('chat.profileLabel')}
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
                        {t('chat.deleteProfile')}
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="chat-temperature"
                    className="block text-2xs text-vsc-text-muted mb-1"
                  >
                    {t('chat.temperatureLabel')}
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
                    {t('chat.maxTokensLabel')}
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
                  {t('chat.systemPromptLabel')}
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
                  label={t('chat.forceRouting')}
                  className="px-0 py-0 hover:bg-transparent"
                />
                <Input
                  value={forceOverride.provider}
                  onChange={e => setForceOverride({ provider: e.target.value })}
                  placeholder={t('chat.providerPlaceholder')}
                  disabled={!forceOverride.enabled}
                  className="bg-vsc-input border-vsc-border text-2xs text-vsc-text"
                  shellClassName="bg-vsc-input border-vsc-border"
                />
                <Input
                  value={forceOverride.modelId}
                  onChange={e => setForceOverride({ modelId: e.target.value })}
                  placeholder={t('chat.modelIdPlaceholder')}
                  disabled={!forceOverride.enabled}
                  className="bg-vsc-input border-vsc-border text-2xs text-vsc-text"
                  shellClassName="bg-vsc-input border-vsc-border"
                />
                <div className="flex gap-2">
                  <Input
                    value={forceOverride.accountId}
                    onChange={e => setForceOverride({ accountId: e.target.value })}
                    placeholder={t('chat.accountIdPlaceholder')}
                    disabled={!forceOverride.enabled}
                    className="bg-vsc-input border-vsc-border text-2xs text-vsc-text"
                    shellClassName="bg-vsc-input border-vsc-border"
                  />
                  <Button variant="ghost" size="xs" onClick={resetForceOverride} type="button">
                    {t('chat.reset')}
                  </Button>
                </div>
              </div>
            </div>

            {/* AI Proxy info */}
            {proxyRunning && (
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
                    <span className="text-sm text-vsc-text">{t('chat.modelsCount', { count: modelList.length })}</span>
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
                      {t('chat.setupApiKeys', { gemini: setup.geminiKeys, openai: setup.openaiKeys, antigravity: setup.antigravityKeys })}
                    </div>
                    <div>
                      {t('chat.setupProviderAccounts', { active: setup.enabledProviderAccounts, total: setup.totalProviderAccounts })}
                    </div>
                    <div>{t('chat.setupModelMappings', { count: setup.mappingCount })}</div>
                    <div>{t('chat.setupProxyMode', { mode: proxyMode })}</div>
                    {dailyStats && (
                      <div>
                        {t('chat.setupRequestsToday', {
                          total: dailyStats.totalRequests,
                          ok: dailyStats.successfulRequests,
                          fail: dailyStats.failedRequests,
                          avg: Math.round(dailyStats.avgDurationMs),
                        })}
                      </div>
                    )}
                    {costEstimate != null && <div>{t('chat.setupEstimatedCost', { cost: costEstimate.toFixed(4) })}</div>}
                  </div>
                </div>
              </div>
            )}

            {setupBlockReason && (
              <div className="mt-3 rounded-lg border border-vsc-yellow/40 bg-vsc-yellow/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-vsc-yellow">{setupBlockReason}</div>
                  <div className="flex items-center gap-2">
                    {!proxyRunning && (
                      <Button variant="secondary" size="xs" onClick={handleStartProxy}>
                        {t('chat.startProxy')}
                      </Button>
                    )}
                    <>
                      <Button variant="secondary" size="xs" onClick={() => navigate('/settings')}>
                        {t('chat.proxySettings')}
                      </Button>
                      <Button variant="secondary" size="xs" onClick={() => navigate('/api-keys')}>
                        {t('chat.apiKeys')}
                      </Button>
                      <Button variant="secondary" size="xs" onClick={() => navigate('/ai-providers')}>
                        {t('chat.providers')}
                      </Button>
                    </>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat History or Empty State */}
      {messages.length === 0 && !error ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={MessageSquare}
                title={`Send a message to test the AI Proxy connection`}
            description={selectedModel ? `Using ${selectedModel.name}` : undefined}
          />
        </div>
      ) : (
        <ChatHistory messages={messages} isLoading={isLoading} />
      )}

      {/* Inspector — collapsible */}
      {messages.some(m => m.role === 'assistant' && m.debug) && (
        <div className="border-t border-vsc-border bg-vsc-sidebar/40">
          <button
            type="button"
            onClick={() => setInspectorOpen(!inspectorOpen)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-vsc-text hover:bg-vsc-hover transition-colors"
          >
            <span>{t('chat.inspectorToggle')}</span>
            <span className="text-vsc-text-muted">{inspectorOpen ? '▲' : '▼'}</span>
          </button>
          {inspectorOpen && (
            <div className="px-4 py-3 border-t border-vsc-border/50 max-w-4xl mx-auto">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs font-medium text-vsc-text">{t('chat.inspectorTitle')}</div>
                <div className="flex items-center gap-2">
                  <Select
                    value={inspectorMessageId || ''}
                    onChange={e => setInspectorMessageId(e.target.value || null)}
                    className="px-2 py-1 bg-vsc-input border border-vsc-border rounded text-2xs text-vsc-text"
                    shellClassName="bg-vsc-input border-vsc-border"
                  >
                    <option value="">{t('chat.latest')}</option>
                    {[...messages]
                      .filter(m => m.role === 'assistant' && m.debug)
                      .slice()
                      .reverse()
                      .map(m => (
                        <option key={m.id} value={m.id}>
                          {new Date(m.timestamp).toLocaleTimeString()} •{' '}
                          {m.routedProvider || t('chat.unknownProvider')}
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
                    {t('chat.copyJson')}
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
                          promptTokens: debug.promptTokens,
                          completionTokens: debug.completionTokens,
                          totalTokens: debug.totalTokens,
                          contextUsagePct: debug.contextUsagePct,
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
          )}
        </div>
      )}

      {/* Compact Error Toast — shown inline near input */}
      {error && !errorDismissed && (
        <div className="px-4 py-2 border-t border-vsc-border">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <StatusBadge status="error" withDot size="sm">
              {t('chat.error') || 'Error'}
            </StatusBadge>
            <span className="text-xs text-vsc-text-muted truncate flex-1">{error}</span>
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
              variant="secondary"
              size="xs"
              leftIcon={<RefreshCw size={12} />}
            >
              {t('chat.retry') || 'Retry'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setErrorDismissed(true)}
              leftIcon={<X size={12} />}
            />
          </div>
        </div>
      )}

      {/* Model Selector + Chat Input */}
      <div className="border-t border-vsc-border bg-vsc-sidebar/50">
        {/* Endpoint + Model Selector Row */}
        <div className="px-4 py-2 border-b border-white/5">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <StatusBadge
              status={proxyRunning ? 'active' : 'error'}
              withDot
              withPulse={proxyRunning}
              size="sm"
            >
              {proxyRunning ? 'connected' : 'disconnected'}
            </StatusBadge>
            <span className="text-xs text-vsc-text-muted">{t('chat.model') || 'Model'}:</span>
            <div className="relative">
              <ButtonBase
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
              </ButtonBase>

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
                        <ButtonBase
                          type="button"
                          key={m.id}
                          onClick={() => {
                            setSessionModel(m.id);
                            setShowModelDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-vsc-hover transition-colors
                                     ${m.id === model ? 'bg-vsc-blue/20 text-vsc-blue' : 'text-vsc-text'}`}
                        >
                          <span className="flex items-center justify-between gap-3">
                            <span>{m.name}</span>
                            <span className="text-2xs text-vsc-text-muted">{'AI Proxy'}</span>
                          </span>
                        </ButtonBase>
                      ))}
                    </div>
                  ))}
                  {modelList.length === 0 && (
                    <div className="px-3 py-4 text-center text-sm text-vsc-text-muted">
                      {t('chat.noModels')}
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
                    {lastRoutedModel
                      ? t('chat.routedWithModel', { provider: lastRoutedProvider, model: lastRoutedModel })
                      : t('chat.routed', { provider: lastRoutedProvider })}
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
        </div>{/* end chat area */}
      </div>{/* end flex-row (sidebar + chat) */}
    </div>
  );
}
