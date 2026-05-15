import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PersistedCard {
  id: string;
  number: string;
  month: string;
  year: string;
  cvv: string;
  checkResult: {
    success: boolean;
    status: string;
    message: string;
    bank: string;
    cardType: string;
    category: string;
    brand: string;
    countryName: string;
    countryCode: string;
    countryEmoji: string;
    error?: string;
  } | null;
  checkError: string | null;
  checking: boolean;
  selected: boolean;
}

interface CardToolsState {
  // Form fields
  bin: string;
  month: string;
  year: string;
  cvv: string;
  quantity: string;
  manualInput: string;

  // Results
  cards: PersistedCard[];

  // Filters
  statusFilter: 'all' | 'live' | 'die' | 'unknown' | 'unchecked';
  searchQuery: string;

  // Actions
  setBin: (v: string) => void;
  setMonth: (v: string) => void;
  setYear: (v: string) => void;
  setCvv: (v: string) => void;
  setQuantity: (v: string) => void;
  setManualInput: (v: string) => void;
  setCards: (cards: PersistedCard[] | ((prev: PersistedCard[]) => PersistedCard[])) => void;
  setStatusFilter: (v: CardToolsState['statusFilter']) => void;
  setSearchQuery: (v: string) => void;
  clearCards: () => void;
}

export const useCardToolsStore = create<CardToolsState>()(
  persist(
    set => ({
      bin: '',
      month: '',
      year: '',
      cvv: '',
      quantity: '10',
      manualInput: '',
      cards: [],
      statusFilter: 'all',
      searchQuery: '',

      setBin: v => set({ bin: v }),
      setMonth: v => set({ month: v }),
      setYear: v => set({ year: v }),
      setCvv: v => set({ cvv: v }),
      setQuantity: v => set({ quantity: v }),
      setManualInput: v => set({ manualInput: v }),
      setCards: cards => {
        set(state => ({
          cards: typeof cards === 'function' ? cards(state.cards) : cards,
        }));
      },
      setStatusFilter: v => set({ statusFilter: v }),
      setSearchQuery: v => set({ searchQuery: v }),
      clearCards: () => set({ cards: [] }),
    }),
    {
      name: 'stitch-card-tools',
    }
  )
);
