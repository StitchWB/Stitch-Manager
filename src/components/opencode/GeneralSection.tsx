import { useMemo, useState } from 'react';
import { t } from '@/lib/i18n';
import { Plus, X } from 'lucide-react';
import { GlassCard, Input, Toggle, ModelPicker, Button } from '@/components/ui';
import type { ModelOption } from '@/components/ui';
import type { OpenCodeConfig, OhMyOpenAgentConfig, CompactionConfig } from '@/lib/backend/modules/opencodeConfig';
import { ButtonBase } from '@/components/ui/ButtonBase';

interface GeneralSectionProps {
  config: OpenCodeConfig;
  ohMyConfig: OhMyOpenAgentConfig;
  onChange: (updater: (config: OpenCodeConfig) => OpenCodeConfig) => void;
  onOhMyChange: (updater: (config: OhMyOpenAgentConfig) => OhMyOpenAgentConfig) => void;
}

export function GeneralSection({ config, ohMyConfig, onChange, onOhMyChange }: GeneralSectionProps) {
  const compaction = config.compaction || {};
  const [newPlugin, setNewPlugin] = useState('');

  const mcpServers = config.mcp || {};
  const plugins = config.plugin || [];

  const modelOptions = useMemo<ModelOption[]>(() => {
    const options: ModelOption[] = [];
    Object.entries(config.provider || {}).forEach(([pid, provider]) => {
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
  }, [config.provider]);

  const updateCompaction = (patch: Partial<CompactionConfig>) => {
    onChange(prev => ({
      ...prev,
      compaction: { ...prev.compaction, ...patch },
    }));
  };

  return (
    <div className="space-y-6">
      <GlassCard className="p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">{t('opencode.ui.defaultModels')}</h3>
          <p className="text-sm text-vsc-text-muted">
            {t('opencode.ui.defaultModelsDesc')}
          </p>
        </div>

        <ModelPicker
          label={t('opencode.ui.defaultModel')}
          value={config.model || ''}
          options={modelOptions}
          onChange={(v) => onChange(prev => ({ ...prev, model: v }))}
          placeholder={t('opencode.ui.selectDefaultModel')}
        />

        <ModelPicker
          label={t('opencode.ui.smallModel')}
          value={config.small_model || ''}
          options={modelOptions}
          onChange={(v) => onChange(prev => ({ ...prev, small_model: v }))}
          placeholder={t('opencode.ui.selectSmallModel')}
        />
      </GlassCard>

      <GlassCard className="p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">{t('opencode.ui.compaction')}</h3>
          <p className="text-sm text-vsc-text-muted">
            {t('opencode.ui.compactionDesc')}
          </p>
        </div>

        <Toggle
          label="Auto-compaction"
          checked={compaction.auto ?? true}
          onChange={(v) => updateCompaction({ auto: v })}
          tooltip="Automatically compact old conversation turns"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            label="Tail Turns"
            type="number"
            value={String(compaction.tail_turns ?? 8)}
            onChange={e => updateCompaction({ tail_turns: parseInt(e.target.value) || 8 })}
            hint="Recent turns to keep uncompacted"
          />
          <Input
            label="Preserve Recent Tokens"
            type="number"
            value={String(compaction.preserve_recent_tokens ?? 32768)}
            onChange={e => updateCompaction({ preserve_recent_tokens: parseInt(e.target.value) || 32768 })}
            hint="Tokens preserved from compaction"
          />
          <Input
            label="Reserved Tokens"
            type="number"
            value={String(compaction.reserved ?? 8192)}
            onChange={e => updateCompaction({ reserved: parseInt(e.target.value) || 8192 })}
            hint="Tokens reserved for response"
          />
        </div>
      </GlassCard>

      {/* oh-my-openagent system settings — only shown when plugin is active */}
      {plugins.includes('oh-my-openagent') ? (
        <GlassCard className="p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold mb-1">{t('opencode.ui.oma')}</h3>
            <p className="text-sm text-vsc-text-muted">
              {t('opencode.ui.omaDesc')}
            </p>
          </div>

          <ModelPicker
            label={t('opencode.ui.defaultModel')}
            value={ohMyConfig.default_model || ''}
            options={modelOptions}
            onChange={(v) => onOhMyChange(prev => ({ ...prev, default_model: v }))}
            placeholder={t('opencode.ui.selectDefaultModel')}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Toggle
              label={t('opencode.ui.googleAuth')}
              checked={ohMyConfig.google_auth ?? false}
              onChange={(v) => onOhMyChange(prev => ({ ...prev, google_auth: v }))}
              tooltip={t('opencode.ui.googleAuthTip')}
            />
            <Toggle
              label={t('opencode.ui.autoMultimodal')}
              checked={(ohMyConfig.hooks?.auto_multimodal_routing as boolean) ?? true}
              onChange={(v) => onOhMyChange(prev => ({
                ...prev,
                hooks: { ...prev.hooks, auto_multimodal_routing: v },
              }))}
              tooltip={t('opencode.ui.autoMultimodalTip')}
            />
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="p-6">
          <div>
            <h3 className="text-lg font-semibold mb-1">{t('opencode.ui.oma')}</h3>
            <p className="text-sm text-vsc-text-muted">
              {t('opencode.ui.omaDisabled')}
            </p>
          </div>
        </GlassCard>
      )}

      {/* MCP Servers */}
      <GlassCard className="p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">{t('opencode.ui.mcpServers')}</h3>
          <p className="text-sm text-vsc-text-muted">
            {t('opencode.ui.mcpDesc')}
          </p>
        </div>

        {Object.keys(mcpServers).length === 0 ? (
          <div className="text-sm text-vsc-text-muted">{t('opencode.ui.noMcp')}</div>
        ) : (
          <div className="space-y-2">
            {Object.entries(mcpServers).map(([name, server]) => {
              const srv = server as { enabled?: boolean; type?: string; command?: string[] };
              return (
                <div key={name} className="flex items-center justify-between gap-3 rounded-lg border border-vsc-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-vsc-text-muted truncate">
                      {srv.type}{srv.command ? ` · ${srv.command.join(' ')}` : ''}
                    </div>
                  </div>
                  <Toggle
                    label=""
                    size="sm"
                    checked={srv.enabled ?? false}
                    onChange={(v) => onChange(prev => {
                      const mcp = { ...(prev.mcp || {}) };
                      mcp[name] = { ...mcp[name], enabled: v };
                      return { ...prev, mcp };
                    })}
                  />
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Plugins */}
      <GlassCard className="p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-1">{t('opencode.ui.plugins')}</h3>
          <p className="text-sm text-vsc-text-muted">
            {t('opencode.ui.pluginsDesc')}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {plugins.map(p => (
            <span
              key={p}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-md bg-white/5 border border-white/10 text-xs"
            >
              {p}
              <ButtonBase
                type="button"
                onClick={() => onChange(prev => ({
                  ...prev,
                  plugin: (prev.plugin || []).filter(x => x !== p),
                }))}
                className="text-slate-500 hover:text-red-400 transition-colors"
                title="Remove plugin"
              >
                <X size={12} />
              </ButtonBase>
            </span>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={newPlugin}
              onChange={e => setNewPlugin(e.target.value)}
              placeholder="plugin-name or @org/plugin"
              onKeyDown={e => {
                if (e.key === 'Enter' && newPlugin.trim()) {
                  onChange(prev => ({
                    ...prev,
                    plugin: [...(prev.plugin || []), newPlugin.trim()],
                  }));
                  setNewPlugin('');
                }
              }}
            />
          </div>
          <Button
            onClick={() => {
              if (!newPlugin.trim()) return;
              onChange(prev => ({
                ...prev,
                plugin: [...(prev.plugin || []), newPlugin.trim()],
              }));
              setNewPlugin('');
            }}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}