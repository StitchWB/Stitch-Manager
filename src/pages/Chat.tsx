import { useState, useCallback, useEffect } from 'react';
import { MessageSquare, Trash2, Settings2, AlertCircle, RefreshCw, ChevronDown } from 'lucide-react';
import Header from '../components/layout/Header';
import { ChatHistory, ChatInput } from '../components/chat';
import { useChat } from '../hooks/useChat';
import { useChatStore } from '../stores/chat';
import { useAppStore } from '../stores/app';
import { useLLMServerStore } from '../stores/llmServer';
import { t } from '../lib/i18n';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui';
import { Tooltip } from '../components/Tooltip';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

/**
 * Chat page component for interacting with the LLM API server.
 * Features streaming responses, message history, and error handling.
 */
export default function Chat() {
  const { language } = useAppStore();
  const { config, running } = useLLMServerStore();
  const { model, setModel } = useChatStore();
  
  const [showSettings, setShowSettings] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  
  // Build API URL from server config
  const apiUrl = `http://${config.host}:${config.port}/v1/chat/completions`;
  
  // Force re-render when language changes
  void language;

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    stopGeneration,
  } = useChat({
    apiUrl,
    model,
  });

  // Fetch available models from server
  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    
    try {
      const response = await fetch(`http://${config.host}:${config.port}/v1/chat/models`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      
      // Parse models - they come as { models: [{ id, name, provider }] }
      const modelList: ModelInfo[] = (data.models || data.data || []).map((m: Record<string, unknown>) => ({
        id: String(m.id || ''),
        name: String(m.name || m.display_name || m.id || ''),
        provider: String(m.provider || m.owned_by || 'Unknown'),
      }));
      setModels(modelList);
      
      // Set default model if not set or current model not in list
      const modelExists = modelList.some(m => m.id === model);
      if (!model || !modelExists) {
        if (modelList.length > 0) {
          setModel(modelList[0].id);
        }
      }
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : 'Failed to load models');
      // Set fallback Kiro models (with prefixes to match server format)
      setModels([
        { id: '[Kiro] claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Kiro' },
        { id: '[Kiro] claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'Kiro' },
        { id: '[Kiro] claude-3-opus', name: 'Claude 3 Opus', provider: 'Kiro' },
        { id: '[Kiro] nova-pro', name: 'Nova Pro', provider: 'Kiro' },
      ]);
      if (!model || !model.startsWith('[')) {
        setModel('[Kiro] claude-3.5-sonnet');
      }
    } finally {
      setModelsLoading(false);
    }
  }, [config.host, config.port, model, setModel]);

  // Fetch models on mount and when server config changes
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleClearChat = useCallback(() => {
    if (messages.length > 0) {
      clearMessages();
    }
  }, [messages.length, clearMessages]);

  // Group models by provider
  const groupedModels = models.reduce((acc, m) => {
    const provider = m.provider || 'Other';
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(m);
    return acc;
  }, {} as Record<string, ModelInfo[]>);

  const selectedModel = models.find(m => m.id === model);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('chat.title') || 'Chat'}
        subtitle={t('chat.subtitle') || 'AI Assistant'}
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
              <h3 className="text-sm font-medium text-vsc-text">
                {t('chat.serverConfig') || 'Server Configuration'}
              </h3>
              {!running && (
                <span className="text-xs text-vsc-yellow flex items-center gap-1">
                  <AlertCircle size={12} />
                  {t('chat.serverNotRunning') || 'Server not running'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-vsc-text-muted mb-1.5">
                  {t('chat.apiUrl') || 'API Endpoint'}
                </label>
                <div className="w-full px-3 py-2 bg-vsc-input border border-vsc-border rounded-lg 
                               text-sm text-vsc-text font-mono">
                  {apiUrl}
                </div>
                <p className="text-2xs text-vsc-text-muted mt-1">
                  {t('chat.configuredInServer') || 'Configured in Server page'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-vsc-text-muted mb-1.5">
                  {t('chat.availableModels') || 'Available Models'}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-vsc-text">{models.length} models</span>
                  <Button
                    onClick={fetchModels}
                    disabled={modelsLoading}
                    variant="secondary"
                    size="xs"
                    leftIcon={modelsLoading ? <LoadingSpinner size="xs" /> : <RefreshCw size={12} />}
                  />
                </div>
                {modelsError && (
                  <p className="text-2xs text-vsc-red mt-1">{modelsError}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="border-b border-vsc-red/30 bg-vsc-red/10 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-vsc-red shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-vsc-red font-medium">
                {t('chat.error') || 'Error'}
              </p>
              <p className="text-xs text-vsc-red/80 truncate">{error}</p>
            </div>
            <Button
              onClick={() => sendMessage(messages[messages.length - 2]?.content || '')}
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

      {/* Model Selector + Chat Input */}
      <div className="border-t border-vsc-border bg-vsc-sidebar/50">
        {/* Model Selector Row */}
        <div className="px-4 py-2 border-b border-vsc-border/50">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <span className="text-xs text-vsc-text-muted">{t('chat.model') || 'Model'}:</span>
            <div className="relative">
              <button
                onClick={() => setShowModelDropdown(!showModelDropdown)}
                disabled={modelsLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-vsc-input border border-vsc-border 
                           rounded-lg text-sm text-vsc-text hover:border-vsc-blue/50 transition-colors
                           disabled:opacity-50 min-w-[200px] justify-between"
              >
                <span className="truncate">
                  {modelsLoading ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner size="xs" />
                      Loading...
                    </span>
                  ) : selectedModel ? (
                    selectedModel.name
                  ) : (
                    'Select model...'
                  )}
                </span>
                <ChevronDown size={14} className={`transition-transform ${showModelDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              {/* Dropdown */}
              {showModelDropdown && !modelsLoading && (
                <div className="absolute bottom-full left-0 mb-1 w-80 max-h-80 overflow-y-auto
                               bg-vsc-sidebar border border-vsc-border rounded-lg shadow-xl z-50">
                  {Object.entries(groupedModels).map(([provider, providerModels]) => (
                    <div key={provider}>
                      <div className="px-3 py-1.5 text-xs font-medium text-vsc-text-muted bg-vsc-panel/50 sticky top-0">
                        {provider}
                      </div>
                      {providerModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setModel(m.id);
                            setShowModelDropdown(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-sm hover:bg-vsc-hover transition-colors
                                     ${m.id === model ? 'bg-vsc-blue/20 text-vsc-blue' : 'text-vsc-text'}`}
                        >
                          {m.name}
                        </button>
                      ))}
                    </div>
                  ))}
                  {models.length === 0 && (
                    <div className="px-3 py-4 text-center text-sm text-vsc-text-muted">
                      No models available
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {selectedModel && (
              <span className="text-xs text-vsc-text-muted px-2 py-0.5 bg-vsc-input rounded">
                {selectedModel.provider}
              </span>
            )}
          </div>
        </div>
        
        {/* Chat Input */}
        <ChatInput
          onSend={sendMessage}
          onStop={stopGeneration}
          isLoading={isLoading}
          placeholder={t('chat.placeholder') || 'Type a message...'}
        />
      </div>
    </div>
  );
}
