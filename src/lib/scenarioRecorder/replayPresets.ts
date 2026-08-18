import { useCallback, useEffect, useMemo, useState } from 'react';

export type ReplayRunPreset = {
  id: string;
  name: string;
  scenarioPath: string;
  startUrl: string;
  configJson: string;
  continueOnError: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number | null;
};

type ReplayPresetStore = {
  [profileAlias: string]: ReplayRunPreset[];
};

const REPLAY_PRESETS_KEY = 'scenarioReplay.runPresets.v1';

function safeAlias(alias: string | null): string {
  return alias?.trim() || '__global__';
}

function nowTs(): number {
  return Date.now();
}

function makePresetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `preset-${nowTs()}-${Math.random().toString(16).slice(2)}`;
}

function readStore(): ReplayPresetStore {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(REPLAY_PRESETS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReplayPresetStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(next: ReplayPresetStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REPLAY_PRESETS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/storage errors
  }
}

export type ReplayPresetDraft = {
  scenarioPath: string;
  startUrl: string;
  configJson: string;
  continueOnError: boolean;
};

type UseReplayPresetsParams = {
  alias: string | null;
};

export function useReplayPresets({ alias }: UseReplayPresetsParams) {
  const [store, setStore] = useState<ReplayPresetStore>(() => readStore());

  useEffect(() => {
    writeStore(store);
  }, [store]);

  const key = safeAlias(alias);
  const presets = useMemo(() => {
    return [...(store[key] ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [key, store]);

  const savePreset = useCallback(
    (name: string, draft: ReplayPresetDraft, existingId?: string) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('Preset name is required');
      }
      if (!draft.scenarioPath.trim()) {
        throw new Error('Scenario path is required for preset');
      }

      setStore(prev => {
        const current = prev[key] ?? [];
        const ts = nowTs();

        if (existingId) {
          const updated = current.map(preset =>
            preset.id === existingId
              ? {
                  ...preset,
                  name: trimmedName,
                  scenarioPath: draft.scenarioPath,
                  startUrl: draft.startUrl,
                  configJson: draft.configJson,
                  continueOnError: draft.continueOnError,
                  updatedAt: ts,
                }
              : preset
          );
          return { ...prev, [key]: updated };
        }

        const nextPreset: ReplayRunPreset = {
          id: makePresetId(),
          name: trimmedName,
          scenarioPath: draft.scenarioPath,
          startUrl: draft.startUrl,
          configJson: draft.configJson,
          continueOnError: draft.continueOnError,
          createdAt: ts,
          updatedAt: ts,
          lastUsedAt: null,
        };
        return { ...prev, [key]: [nextPreset, ...current] };
      });
    },
    [key]
  );

  const renamePreset = useCallback(
    (presetId: string, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed) {
        throw new Error('Preset name is required');
      }

      setStore(prev => {
        const current = prev[key] ?? [];
        const ts = nowTs();
        return {
          ...prev,
          [key]: current.map(preset =>
            preset.id === presetId
              ? {
                  ...preset,
                  name: trimmed,
                  updatedAt: ts,
                }
              : preset
          ),
        };
      });
    },
    [key]
  );

  const deletePreset = useCallback(
    (presetId: string) => {
      setStore(prev => {
        const current = prev[key] ?? [];
        return {
          ...prev,
          [key]: current.filter(preset => preset.id !== presetId),
        };
      });
    },
    [key]
  );

  const getPreset = useCallback(
    (presetId: string) => {
      return (store[key] ?? []).find(preset => preset.id === presetId) ?? null;
    },
    [key, store]
  );

  const markPresetUsed = useCallback(
    (presetId: string) => {
      setStore(prev => {
        const current = prev[key] ?? [];
        const ts = nowTs();
        return {
          ...prev,
          [key]: current.map(preset =>
            preset.id === presetId
              ? {
                  ...preset,
                  lastUsedAt: ts,
                  updatedAt: ts,
                }
              : preset
          ),
        };
      });
    },
    [key]
  );

  return {
    presets,
    savePreset,
    renamePreset,
    deletePreset,
    getPreset,
    markPresetUsed,
  };
}
