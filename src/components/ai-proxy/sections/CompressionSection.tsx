import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import { Button, GlassCard, Toggle, SegmentedControl, Input } from '@/components/ui';
import { Terminal, MessageSquare } from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

type CavemanLevel = 'lite' | 'full' | 'ultra';

interface CompressionStatus {
  compression_enabled: boolean;
  rtk_enabled: boolean;
  caveman_enabled: boolean;
  caveman_level: CavemanLevel;
  input_compression_enabled: boolean;
  output_compression_enabled: boolean;
  preserve_system_prompt: boolean;
  auto_trigger_threshold: number;
}

interface CompressionStats {
  tokens_saved: number;
  avg_savings_pct: number;
}

// ── Component ───────────────────────────────────────────────────────────────

export function CompressionSection() {
  const [status, setStatus] = useState<CompressionStatus | null>(null);
  const [stats, setStats] = useState<CompressionStats | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [compressionEnabled, setCompressionEnabled] = useState(false);
  const [rtkEnabled, setRtkEnabled] = useState(false);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState<CavemanLevel>('full');
  const [inputCompressionEnabled, setInputCompressionEnabled] = useState(true);
  const [outputCompressionEnabled, setOutputCompressionEnabled] = useState(true);
  const [preserveSystemPrompt, setPreserveSystemPrompt] = useState(true);
  const [autoTriggerThreshold, setAutoTriggerThreshold] = useState(500);

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, statsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/compression/status`),
        fetch(`${API_BASE_URL}/api/compression/stats`),
      ]);

      if (statusRes.ok) {
        const data: CompressionStatus = await statusRes.json();
        setStatus(data);
        if (!isLoaded) {
          setCompressionEnabled(data.compression_enabled ?? false);
          setRtkEnabled(data.rtk_enabled ?? false);
          setCavemanEnabled(data.caveman_enabled ?? false);
          setCavemanLevel(data.caveman_level ?? 'full');
          setInputCompressionEnabled(data.input_compression_enabled ?? true);
          setOutputCompressionEnabled(data.output_compression_enabled ?? true);
          setPreserveSystemPrompt(data.preserve_system_prompt ?? true);
          setAutoTriggerThreshold(data.auto_trigger_threshold ?? 500);
          setIsLoaded(true);
        }
      }

      if (statsRes.ok) {
        const data: CompressionStats = await statsRes.json();
        setStats(data);
      }
    } catch {
      // ponytail: backend may not have compression yet; silently ignore
    }
  }, [isLoaded]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const hasUnsavedChanges =
    isLoaded &&
    status !== null &&
    (compressionEnabled !== status.compression_enabled ||
      rtkEnabled !== status.rtk_enabled ||
      cavemanEnabled !== status.caveman_enabled ||
      cavemanLevel !== status.caveman_level ||
      inputCompressionEnabled !== status.input_compression_enabled ||
      outputCompressionEnabled !== status.output_compression_enabled ||
      preserveSystemPrompt !== status.preserve_system_prompt ||
      autoTriggerThreshold !== status.auto_trigger_threshold);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/compression/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compression_enabled: compressionEnabled,
          rtk_enabled: rtkEnabled,
          caveman_enabled: cavemanEnabled,
          caveman_level: cavemanLevel,
          input_compression_enabled: inputCompressionEnabled,
          output_compression_enabled: outputCompressionEnabled,
          preserve_system_prompt: preserveSystemPrompt,
          auto_trigger_threshold: autoTriggerThreshold,
        }),
      });
      if (!res.ok) throw new Error('config save failed');
      await fetchAll();
    } catch {
      // ponytail: silently fail
    } finally {
      setIsSaving(false);
    }
  }, [compressionEnabled, rtkEnabled, cavemanEnabled, cavemanLevel, inputCompressionEnabled, outputCompressionEnabled, preserveSystemPrompt, autoTriggerThreshold, fetchAll]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto p-3 md:p-4">
      <div className="mx-auto w-full max-w-4xl space-y-3">

        {/* ── Header + Stats (inline) ────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">
              {t('aiHub.compression.title')}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('aiHub.compression.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <div className="text-lg font-bold text-indigo-400">
                {stats?.tokens_saved?.toLocaleString() ?? 0}
              </div>
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">
                {t('aiHub.compression.tokensSaved')}
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold text-emerald-400">
                {stats?.avg_savings_pct != null ? `${stats.avg_savings_pct.toFixed(1)}%` : '0%'}
              </div>
              <div className="text-[9px] text-slate-500 uppercase tracking-wide">
                {t('aiHub.compression.avgSavings')}
              </div>
            </div>
            <Toggle
              checked={compressionEnabled}
              onChange={setCompressionEnabled}
              label={t('aiHub.compression.enabled')}
            />
          </div>
        </div>

        {/* ── Filters (compact, always visible) ──────────────────────────── */}
        <GlassCard className={`p-3 space-y-3 ${!compressionEnabled ? 'opacity-50' : ''}`}>
          {/* RTK Filters */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Terminal size={14} className="text-blue-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">
                    {t('aiHub.compression.rtkFilters')}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 uppercase tracking-wide">
                    {t('aiHub.compression.badgeStdout')}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {['pytest', 'vitest', 'jest', 'eslint', 'mypy', 'ruff', 'cargo test', 'npm test'].map(cmd => (
                    <span
                      key={cmd}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono"
                    >
                      {cmd}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Toggle
              checked={rtkEnabled}
              onChange={setRtkEnabled}
              disabled={!compressionEnabled}
              label={t('aiHub.compression.rtkEnabled')}
            />
          </div>

          {/* Divider */}
          <div className="border-t border-white/5" />

          {/* Caveman */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <MessageSquare size={14} className="text-purple-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">
                    {t('aiHub.compression.caveman')}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 uppercase tracking-wide">
                    {t('aiHub.compression.badgeTokens')}
                  </span>
                </div>
                {cavemanEnabled && compressionEnabled && (
                  <div className="mt-1">
                    <SegmentedControl
                      options={[
                        { value: 'lite', label: t('aiHub.compression.levelLite') },
                        { value: 'full', label: t('aiHub.compression.levelFull') },
                        { value: 'ultra', label: t('aiHub.compression.levelUltra') },
                      ]}
                      value={cavemanLevel}
                      onChange={(val) => setCavemanLevel(val as CavemanLevel)}
                      size="sm"
                    />
                  </div>
                )}
              </div>
            </div>
            <Toggle
              checked={cavemanEnabled}
              onChange={setCavemanEnabled}
              disabled={!compressionEnabled}
              label={t('aiHub.compression.cavemanEnabled')}
            />
          </div>
        </GlassCard>

        {/* ── Advanced Settings ──────────────────────────────────────────── */}
        {compressionEnabled && cavemanEnabled && (
          <GlassCard className="p-3 space-y-3">
            <h3 className="text-xs font-medium text-white">
              {t('aiHub.compression.advancedSettings')}
            </h3>

            {/* Input/Output toggles */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">
                  {t('aiHub.compression.inputCompression')}
                </span>
                <Toggle
                  checked={inputCompressionEnabled}
                  onChange={setInputCompressionEnabled}
                  label={t('aiHub.compression.inputCompressionEnabled')}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">
                  {t('aiHub.compression.outputCompression')}
                </span>
                <Toggle
                  checked={outputCompressionEnabled}
                  onChange={setOutputCompressionEnabled}
                  label={t('aiHub.compression.outputCompressionEnabled')}
                />
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/5" />

            {/* Preserve system prompt */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-xs text-slate-300">
                  {t('aiHub.compression.preserveSystemPrompt')}
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {t('aiHub.compression.preserveSystemPromptDescription')}
                </p>
              </div>
              <Toggle
                checked={preserveSystemPrompt}
                onChange={setPreserveSystemPrompt}
                label={t('aiHub.compression.preserveSystemPromptEnabled')}
              />
            </div>

            {/* Auto trigger threshold */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-xs text-slate-300">
                  {t('aiHub.compression.autoTriggerThreshold')}
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {t('aiHub.compression.autoTriggerThresholdDescription')}
                </p>
              </div>
              <Input
                type="number"
                min="0"
                max="10000"
                step="100"
                value={autoTriggerThreshold}
                onChange={(e) => setAutoTriggerThreshold(parseInt(e.target.value, 10) || 0)}
                className="w-24 px-2 py-1 text-xs text-right"
              />
            </div>
          </GlassCard>
        )}

        {/* ── Not Configured State ─────────────────────────────────────── */}
        {isLoaded && !status && (
          <GlassCard className="p-3">
            <p className="text-xs text-slate-400 text-center">
              {t('aiHub.compression.notConfigured')}
            </p>
          </GlassCard>
        )}

        {/* ── Save Bar ─────────────────────────────────────────────────── */}
        {hasUnsavedChanges && (
          <div className="sticky bottom-3">
            <GlassCard className="p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300">
                  {t('aiHub.holone.unsavedChanges')}
                </span>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? t('aiHub.actions.saving') : t('aiHub.holone.saveChanges')}
                </Button>
              </div>
            </GlassCard>
          </div>
        )}

      </div>
    </div>
  );
}