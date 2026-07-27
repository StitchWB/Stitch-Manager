import { useEffect, useState } from 'react';
import { TestTube, Loader2, CheckCircle2, XCircle, Server, Key, Link2, Package, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, Button, Input, Badge, Toggle } from '@/components/ui';
import { testOpenCodeApi, type ProviderConfig, type ModelConfig } from '@/lib/tauri/modules/opencodeConfig';

interface ProviderEditorModalProps {
  isOpen: boolean;
  providerId: string | null;
  provider: ProviderConfig | null;
  onSave: (id: string, provider: ProviderConfig) => void;
  onClose: () => void;
}

type ModelInfo = {
  id: string;
  owned_by?: string;
  vision?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  status?: 'stable' | 'experimental';
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
};

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; models: ModelInfo[] }
  | { status: 'error'; message: string };

export function ProviderEditorModal({
  isOpen,
  providerId,
  provider,
  onSave,
  onClose,
}: ProviderEditorModalProps) {
  const [name, setName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeout, setTimeout_] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [removedModels, setRemovedModels] = useState<Set<string>>(new Set());
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [modelEdits, setModelEdits] = useState<Record<string, ModelConfig>>({});

  useEffect(() => {
    if (isOpen) {
      setName(provider?.name || '');
      setBaseURL(provider?.options?.baseURL || '');
      setApiKey(provider?.options?.apiKey || '');
      setTimeout_(provider?.options?.timeout ? String(provider.options.timeout) : '');
      setTest({ status: 'idle' });
      setModelsExpanded(false);
      setModelFilter('');
      setRemovedModels(new Set());
      setEditingModel(null);
      setModelEdits({});
    }
  }, [provider, isOpen]);

  const existingModels = Object.keys(provider?.models || {}).filter(m => !removedModels.has(m));
  const filteredModels = modelFilter
    ? existingModels.filter(m => m.toLowerCase().includes(modelFilter.toLowerCase()))
    : existingModels;

  const handleRemoveModel = (modelId: string) => {
    setRemovedModels(prev => new Set(prev).add(modelId));
  };

  const handleEditModel = (modelId: string) => {
    if (editingModel === modelId) {
      setEditingModel(null);
      return;
    }
    const existing = provider?.models?.[modelId];
    setEditingModel(modelId);
    setModelEdits(prev => ({
      ...prev,
      [modelId]: {
        ...prev[modelId],
        limit: {
          context: prev[modelId]?.limit?.context ?? existing?.limit?.context ?? 128000,
          output: prev[modelId]?.limit?.output ?? existing?.limit?.output ?? 4096,
        },
        modalities: {
          input: prev[modelId]?.modalities?.input ?? existing?.modalities?.input ?? ['text'],
          output: prev[modelId]?.modalities?.output ?? existing?.modalities?.output ?? ['text'],
        },
        reasoning: prev[modelId]?.reasoning ?? existing?.reasoning ?? false,
        tool_call: prev[modelId]?.tool_call ?? existing?.tool_call ?? false,
        attachment: prev[modelId]?.attachment ?? existing?.attachment ?? false,
      },
    }));
  };

  const updateModelEdit = (modelId: string, patch: Partial<ModelConfig>) => {
    setModelEdits(prev => ({
      ...prev,
      [modelId]: { ...prev[modelId], ...patch },
    }));
  };

  const updateModelLimit = (modelId: string, field: 'context' | 'output', value: number) => {
    setModelEdits(prev => ({
      ...prev,
      [modelId]: {
        ...prev[modelId],
        limit: { ...prev[modelId]?.limit, [field]: value },
      },
    }));
  };

  const updateModelModalities = (modelId: string, ioField: 'input' | 'output', value: string) => {
    const arr = value.split(',').map(s => s.trim()).filter(Boolean);
    setModelEdits(prev => ({
      ...prev,
      [modelId]: {
        ...prev[modelId],
        modalities: { ...prev[modelId]?.modalities, [ioField]: arr.length > 0 ? arr : undefined },
      },
    }));
  };

  const handleTest = async () => {
    if (!baseURL || !apiKey) {
      toast.error('Base URL and API Key required for testing');
      return;
    }
    setTest({ status: 'testing' });
    try {
      const result = await testOpenCodeApi(baseURL, apiKey);
      if (result.success && result.models) {
        setTest({ status: 'success', models: result.models });
      } else {
        setTest({ status: 'error', message: result.error || 'Connection failed' });
      }
    } catch (error) {
      setTest({
        status: 'error',
        message: error instanceof Error ? error.message : 'Connection failed',
      });
    }
  };

  const handleSave = () => {
    if (!name || !baseURL) {
      toast.error('Name and Base URL required');
      return;
    }
    const id = providerId || name.toLowerCase().replace(/\s+/g, '-');

    // Apply model removals, then seed discovered models if empty
    let models = Object.fromEntries(
      Object.entries(provider?.models || {}).filter(([id]) => !removedModels.has(id))
    );
    if (test.status === 'success' && Object.keys(models).length === 0) {
      models = Object.fromEntries(test.models.map(m => [m.id, {
        name: m.id,
        limit: m.limit || { context: 128000, output: 4096 },
        modalities: m.modalities || { input: m.vision ? ['text', 'image'] : ['text'], output: ['text'] },
        reasoning: m.reasoning ?? false,
        tool_call: m.tool_call ?? true,
        attachment: m.vision ?? false,
      }]));
    }

    // Merge model edits
    for (const [modelId, edits] of Object.entries(modelEdits)) {
      if (models[modelId]) {
        models[modelId] = { ...models[modelId], ...edits };
      }
    }

    onSave(id, {
      npm: provider?.npm || '@ai-sdk/openai-compatible',
      name,
      options: {
        ...provider?.options,
        baseURL,
        apiKey,
        timeout: timeout ? parseInt(timeout) : undefined,
      },
      models,
    });
    onClose();
    toast.success('Provider saved');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={providerId ? `Edit: ${provider?.name || providerId}` : 'Add Provider'}
      icon={<Server className="w-5 h-5" />}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-vsc-text-muted">
            {providerId ? `ID: ${providerId}` : 'New provider will get ID from name'}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="ghost"
              onClick={handleTest}
              disabled={test.status === 'testing' || !baseURL || !apiKey}
            >
              {test.status === 'testing' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <TestTube className="w-4 h-4" />
              )}
              Test
            </Button>
            <Button onClick={handleSave} disabled={!name || !baseURL}>
              Save Provider
            </Button>
          </div>
        </div>
      }
      stickyFooter
    >
      <div className="space-y-6">
        {/* Connection section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Link2 className="w-4 h-4 text-vsc-text-muted" />
            <h4 className="text-sm font-semibold">Connection</h4>
          </div>
          <div className="space-y-3">
            <Input
              label="Provider Name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Comet API, Firepass"
              required
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label="Base URL"
                value={baseURL}
                onChange={e => { setBaseURL(e.target.value); setTest({ status: 'idle' }); }}
                placeholder="https://api.example.com/v1"
                required
              />
              <Input
                label="Timeout (ms)"
                type="number"
                value={timeout}
                onChange={e => setTimeout_(e.target.value)}
                placeholder="120000 (optional)"
              />
            </div>
          </div>
        </div>

        {/* Credentials section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Key className="w-4 h-4 text-vsc-text-muted" />
            <h4 className="text-sm font-semibold">Credentials</h4>
          </div>
          <Input
            label="API Key"
            type="password"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setTest({ status: 'idle' }); }}
            placeholder="sk-..."
          />
        </div>

        {/* Test result */}
        {test.status === 'success' && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium mb-2">
              <CheckCircle2 className="w-4 h-4" />
              Connection OK — {test.models.length} models available
            </div>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {test.models.slice(0, 20).map(m => (
                <Badge key={m.id} size="sm" variant="success">{m.id}</Badge>
              ))}
              {test.models.length > 20 && (
                <Badge size="sm" variant="outline">+{test.models.length - 20} more</Badge>
              )}
            </div>
            {Object.keys(provider?.models || {}).length === 0 && (
              <div className="text-xs text-emerald-200/70 mt-2">
                These models will be added when you save.
              </div>
            )}
          </div>
        )}

        {test.status === 'error' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <div className="flex items-center gap-2 text-red-300 text-sm font-medium">
              <XCircle className="w-4 h-4" />
              {test.message}
            </div>
          </div>
        )}

        {/* Existing models — collapsed by default, expandable with removal */}
        {existingModels.length > 0 && (
          <div className="rounded-lg border border-vsc-border">
            <button
              type="button"
              onClick={() => setModelsExpanded(prev => !prev)}
              className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-vsc-text-muted" />
                <span className="font-semibold">Configured Models</span>
                <Badge size="sm">{existingModels.length}</Badge>
              </div>
              <span className="text-xs text-vsc-text-muted">
                {modelsExpanded ? 'Collapse' : 'Show & manage'}
              </span>
            </button>

            {!modelsExpanded && (
              <div className="px-3 pb-2 text-xs text-vsc-text-muted truncate">
                {existingModels.slice(0, 5).join(', ')}
                {existingModels.length > 5 && `, +${existingModels.length - 5} more`}
              </div>
            )}

            {modelsExpanded && (
              <div className="px-3 pb-3">
                <Input
                  value={modelFilter}
                  onChange={e => setModelFilter(e.target.value)}
                  placeholder="Filter models..."
                  className="mb-2"
                />
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  {filteredModels.map(m => {
                    const isEditing = editingModel === m;
                    const edit = modelEdits[m] || {};
                    const modelConfig = provider?.models?.[m];
                    const merged = { ...modelConfig, ...edit };
                    return (
                      <div key={m}>
                        <button
                          type="button"
                          onClick={() => handleEditModel(m)}
                          className="flex items-center justify-between w-full gap-2 px-2 py-1 rounded text-xs hover:bg-white/5 group"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {isEditing ? (
                              <ChevronDown className="w-3 h-3 shrink-0 text-vsc-text-muted" />
                            ) : (
                              <ChevronRight className="w-3 h-3 shrink-0 text-vsc-text-muted" />
                            )}
                            <span className="truncate">{m}</span>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleRemoveModel(m); }}
                            className="opacity-0 group-hover:opacity-100 text-vsc-text-muted hover:text-red-400 transition-opacity shrink-0"
                            title="Remove model"
                          >
                            ×
                          </button>
                        </button>

                        {isEditing && (
                          <div className="ml-5 mt-1 mb-2 p-3 rounded-lg border border-vsc-border bg-white/[0.02] space-y-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Input
                                label="Context Limit"
                                type="number"
                                value={String(merged.limit?.context ?? '')}
                                onChange={e => updateModelLimit(m, 'context', parseInt(e.target.value) || 0)}
                                placeholder="128000"
                                hint="Max context window size"
                              />
                              <Input
                                label="Output Limit"
                                type="number"
                                value={String(merged.limit?.output ?? '')}
                                onChange={e => updateModelLimit(m, 'output', parseInt(e.target.value) || 0)}
                                placeholder="4096"
                                hint="Max output tokens"
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Input
                                label="Input Modalities"
                                value={(merged.modalities?.input || []).join(', ')}
                                onChange={e => updateModelModalities(m, 'input', e.target.value)}
                                placeholder="text, image"
                                hint="Comma-separated"
                              />
                              <Input
                                label="Output Modalities"
                                value={(merged.modalities?.output || []).join(', ')}
                                onChange={e => updateModelModalities(m, 'output', e.target.value)}
                                placeholder="text"
                                hint="Comma-separated"
                              />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <Toggle
                                label="Reasoning"
                                checked={merged.reasoning ?? false}
                                onChange={(v) => updateModelEdit(m, { reasoning: v })}
                                tooltip="Model supports reasoning/thinking"
                              />
                              <Toggle
                                label="Tool Call"
                                checked={merged.tool_call ?? false}
                                onChange={(v) => updateModelEdit(m, { tool_call: v })}
                                tooltip="Model supports tool calling"
                              />
                              <Toggle
                                label="Attachment"
                                checked={merged.attachment ?? false}
                                onChange={(v) => updateModelEdit(m, { attachment: v })}
                                tooltip="Model supports file attachments"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {filteredModels.length === 0 && (
                    <div className="text-xs text-vsc-text-muted py-2">
                      No models match "{modelFilter}"
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
