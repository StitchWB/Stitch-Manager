import { useMemo, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { ReplayRunPreset } from '@/lib/scenarioRecorder/replayPresets';

type ReplayPresetsPanelProps = {
  presets: ReplayRunPreset[];
  canSavePreset: boolean;
  onSavePreset: (name: string) => void;
  onApplyPreset: (preset: ReplayRunPreset) => void;
  onApplyAndRunPreset: (preset: ReplayRunPreset) => void;
  onRenamePreset: (presetId: string, name: string) => void;
  onRequestDeletePreset: (preset: ReplayRunPreset) => void;
};

function formatPresetTime(ts: number): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ReplayPresetsPanel({
  presets,
  canSavePreset,
  onSavePreset,
  onApplyPreset,
  onApplyAndRunPreset,
  onRenamePreset,
  onRequestDeletePreset,
}: ReplayPresetsPanelProps) {
  const [presetName, setPresetName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const defaultName = useMemo(() => {
    const now = new Date();
    return `${t('recorder.replay.presetDefaultName')} ${now.toLocaleDateString()} ${now.toLocaleTimeString(
      [],
      {
        hour: '2-digit',
        minute: '2-digit',
      }
    )}`;
  }, []);

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="text-xs text-slate-400">{t('recorder.replay.presetsTitle')}</div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
        <Input
          value={presetName}
          onChange={e => setPresetName(e.target.value)}
          placeholder={t('recorder.replay.presetNamePlaceholder')}
          className="h-9"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!canSavePreset}
          onClick={() => {
            onSavePreset((presetName || defaultName).trim());
            setPresetName('');
          }}
        >
          {t('recorder.replay.presetSaveAction')}
        </Button>
      </div>

      {presets.length === 0 ? (
        <div className="text-xs text-slate-500">{t('recorder.replay.presetsEmpty')}</div>
      ) : (
        <div className="space-y-2 max-h-56 overflow-auto pr-1">
          {presets.map(preset => (
            <div
              key={preset.id}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                {editingPresetId === preset.id ? (
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Input
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      className="h-8"
                    />
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        onRenamePreset(preset.id, editingName);
                        setEditingPresetId(null);
                        setEditingName('');
                      }}
                    >
                      {t('common.save')}
                    </Button>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        setEditingPresetId(null);
                        setEditingName('');
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                ) : (
                  <div className="text-sm text-slate-200 truncate" title={preset.name}>
                    {preset.name}
                  </div>
                )}
                <div className="text-[11px] text-slate-500">
                  {formatPresetTime(preset.updatedAt)}
                </div>
              </div>
              {preset.lastUsedAt ? (
                <div className="mt-1 text-[11px] text-indigo-300">
                  {t('recorder.replay.presetLastUsed')}: {formatPresetTime(preset.lastUsedAt)}
                </div>
              ) : null}
              <div className="mt-1 text-[11px] text-slate-500 truncate" title={preset.scenarioPath}>
                {preset.scenarioPath}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="xs" variant="secondary" onClick={() => onApplyPreset(preset)}>
                  {t('recorder.replay.presetApplyAction')}
                </Button>
                <Button size="xs" onClick={() => onApplyAndRunPreset(preset)}>
                  {t('recorder.replay.presetApplyRunAction')}
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    setEditingPresetId(preset.id);
                    setEditingName(preset.name);
                  }}
                >
                  {t('recorder.replay.presetRenameAction')}
                </Button>
                <Button size="xs" variant="danger" onClick={() => onRequestDeletePreset(preset)}>
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
