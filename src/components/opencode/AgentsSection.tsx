import { useMemo, useState } from 'react';
import { Bot, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  GlassCard, Button, EmptyState, ModelPicker,
} from '@/components/ui';
import type { ModelOption } from '@/components/ui';
import type { OpenCodeConfig, OhMyOpenAgentConfig, AgentConfig } from '@/lib/tauri/modules/opencodeConfig';
import { AddAgentModal } from './AddAgentModal';

interface AgentsSectionProps {
  opencodeConfig: OpenCodeConfig;
  ohMyConfig: OhMyOpenAgentConfig;
  onOpencodeChange: (updater: (config: OpenCodeConfig) => OpenCodeConfig) => void;
  onOhMyChange: (updater: (config: OhMyOpenAgentConfig) => OhMyOpenAgentConfig) => void;
}

const VARIANTS = ['low', 'medium', 'high', 'xhigh'] as const;

export function AgentsSection({
  opencodeConfig,
  ohMyConfig,
  onOpencodeChange,
  onOhMyChange,
}: AgentsSectionProps) {
  const [pickerFor, setPickerFor] = useState<{ agentId: string; index: number } | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const modelOptions = useMemo<ModelOption[]>(() => {
    const options: ModelOption[] = [];
    Object.entries(opencodeConfig.provider || {}).forEach(([pid, provider]) => {
      Object.entries(provider.models || {}).forEach(([mid, model]) => {
        options.push({
          value: `${pid}/${mid}`,
          label: model.name || mid,
          provider: provider.name || pid,
          family: model.family,
          context: model.limit?.context,
          reasoning: model.reasoning,
          toolCall: model.tool_call,
        });
      });
    });
    return options;
  }, [opencodeConfig.provider]);

  const opencodeAgents = opencodeConfig.agent || {};
  const ohMyAgents = ohMyConfig.agents || {};
  const allIds = Array.from(new Set([...Object.keys(opencodeAgents), ...Object.keys(ohMyAgents)]));

  const updateAgent = (id: string, patch: Partial<AgentConfig>) => {
    onOpencodeChange(prev => ({
      ...prev,
      agent: { ...prev.agent, [id]: { ...prev.agent?.[id], ...patch } },
    }));
    onOhMyChange(prev => ({
      ...prev,
      agents: { ...prev.agents, [id]: { ...prev.agents?.[id], ...patch } },
    }));
  };

  const handleDelete = (id: string) => {
    if (!confirm(`Delete agent "${id}"?`)) return;
    onOpencodeChange(prev => {
      const next = { ...prev.agent };
      delete next[id];
      return { ...prev, agent: next };
    });
    onOhMyChange(prev => {
      const next = { ...prev.agents };
      delete next[id];
      return { ...prev, agents: next };
    });
  };

  const handleAdd = (id: string) => {
    updateAgent(id, { model: opencodeConfig.model || modelOptions[0]?.value || '' });
    toast.success(`Agent "${id}" added`);
  };

  if (allIds.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        title="No agents configured"
        description="Agents define which model handles each task type"
        action={<Button onClick={() => setIsAddModalOpen(true)}><Plus className="w-4 h-4 mr-2" /> Add Agent</Button>}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Agents</h3>
          <p className="text-sm text-vsc-text-muted">
            Which model each agent role uses ({allIds.length} agents)
          </p>
        </div>
        <Button onClick={() => setIsAddModalOpen(true)}><Plus className="w-4 h-4 mr-2" /> Add Agent</Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {allIds.map(id => {
          const oc = opencodeAgents[id];
          const om = ohMyAgents[id];
          const model = oc?.model || om?.model || '';
          const variant = String(oc?.variant || 'medium');
          const fallbacks = om?.fallback_models || [];

          return (
            <GlassCard key={id} className="p-4 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-sky-400" />
                  <span className="font-semibold">{id}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              {/* Primary model */}
              <ModelPicker
                label="Model"
                value={model}
                options={modelOptions}
                onChange={(v) => updateAgent(id, { model: v })}
                placeholder="Select model"
              />

              {/* Variant — segmented buttons */}
              <div>
                <span className="block text-sm font-medium text-slate-300 mb-1.5">
                  Reasoning effort
                </span>
                <div className="grid grid-cols-4 gap-1 rounded-lg bg-white/5 border border-white/10 p-1">
                  {VARIANTS.map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => updateAgent(id, {
                        variant: v,
                        options: { ...(oc?.options || {}), reasoning_effort: v, reasoningEffort: v },
                      })}
                      className={
                        variant === v
                          ? 'px-2 py-1 text-xs font-medium rounded-md bg-sky-500/20 text-sky-300 transition-colors'
                          : 'px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded-md transition-colors'
                      }
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fallbacks as chips */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-300">Fallback models</span>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => setPickerFor({ agentId: id, index: fallbacks.length })}
                  >
                    <Plus className="w-3 h-3 mr-1" /> Add
                  </Button>
                </div>
                {fallbacks.length === 0 ? (
                  <div className="text-xs text-vsc-text-muted">No fallbacks — agent fails if primary model is unavailable</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {fallbacks.map((fb, i) => {
                      const isValid = fb.model.includes('/');
                      const shortName = fb.model.split('/').pop() || fb.model;
                      const option = modelOptions.find(o => o.value === fb.model);
                      return (
                        <span
                          key={i}
                          title={fb.model}
                          className={
                            isValid
                              ? 'inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-white/5 border border-white/10 text-xs'
                              : 'inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-xs text-red-300'
                          }
                        >
                          {option && (
                            <span className="text-[10px] text-vsc-text-muted">{option.provider}/</span>
                          )}
                          <span className="truncate max-w-[160px]">{shortName}</span>
                          <button
                            type="button"
                            onClick={() => updateAgent(id, { fallback_models: fallbacks.filter((_, j) => j !== i) })}
                            className="text-slate-500 hover:text-red-400 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                {pickerFor?.agentId === id && (
                  <div className="mt-2">
                    <ModelPicker
                      value=""
                      options={modelOptions}
                      onChange={(v) => {
                        updateAgent(id, { fallback_models: [...fallbacks, { model: v }] });
                        setPickerFor(null);
                      }}
                      placeholder="Pick fallback model"
                    />
                    <Button variant="ghost" size="sm" className="mt-1" onClick={() => setPickerFor(null)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </GlassCard>
          );
        })}
      </div>

      <AddAgentModal
        isOpen={isAddModalOpen}
        existingIds={allIds}
        onAdd={handleAdd}
        onClose={() => setIsAddModalOpen(false)}
      />
    </div>
  );
}
