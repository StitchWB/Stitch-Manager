import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface BinPreset {
  id: string;
  name: string;
  bin: string;
  month: string;
  year: string;
  cvv: string;
  quantity: string;
  createdAt: number;
}

interface BinPresetsState {
  presets: BinPreset[];
  addPreset: (preset: Omit<BinPreset, 'id' | 'createdAt'>) => void;
  removePreset: (id: string) => void;
  updatePreset: (id: string, updates: Partial<Omit<BinPreset, 'id' | 'createdAt'>>) => void;
  getPreset: (id: string) => BinPreset | undefined;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useBinPresetsStore = create<BinPresetsState>()(
  persist(
    (set, get) => ({
      presets: [],

      addPreset: preset =>
        set(state => ({
          presets: [
            ...state.presets,
            {
              ...preset,
              id: generateId(),
              createdAt: Date.now(),
            },
          ],
        })),

      removePreset: id =>
        set(state => ({
          presets: state.presets.filter(p => p.id !== id),
        })),

      updatePreset: (id, updates) =>
        set(state => ({
          presets: state.presets.map(p =>
            p.id === id ? { ...p, ...updates } : p
          ),
        })),

      getPreset: id => get().presets.find(p => p.id === id),
    }),
    {
      name: 'stitch-bin-presets',
    }
  )
);
