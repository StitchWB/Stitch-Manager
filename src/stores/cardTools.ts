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
  addCards: (cards: Partial<PersistedCard>[]) => void;
  setCardChecking: (id: string, checking: boolean) => void;
  setCardResult: (id: string, result: PersistedCard['checkResult']) => void;
  setCardError: (id: string, error: string) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  deleteCard: (id: string) => void;
  deleteSelected: () => void;
  deleteCardsById: (ids: string[]) => void;
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
      addCards: (newCards: Partial<PersistedCard>[]) => set(state => ({
        cards: [...newCards.map((c: Partial<PersistedCard>) => ({
          id: c.id || `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          number: c.number || '',
          month: c.month || '',
          year: c.year || '',
          cvv: c.cvv || '',
          checkResult: null,
          checkError: null,
          checking: false,
          selected: false,
        })), ...state.cards],
      })),
      setCardChecking: (id: string, checking: boolean) => set(state => ({
        cards: state.cards.map(c => c.id === id ? { ...c, checking } : c),
      })),
      setCardResult: (id: string, result: PersistedCard['checkResult']) => set(state => ({
        cards: state.cards.map(c => c.id === id ? { ...c, checkResult: result, checkError: null } : c),
      })),
      setCardError: (id: string, error: string) => set(state => ({
        cards: state.cards.map(c => c.id === id ? { ...c, checkError: error } : c),
      })),
      toggleSelect: (id: string) => set(state => ({
        cards: state.cards.map(c => c.id === id ? { ...c, selected: !c.selected } : c),
      })),
      selectAll: () => set(state => ({
        cards: state.cards.map(c => ({ ...c, selected: true })),
      })),
      deselectAll: () => set(state => ({
        cards: state.cards.map(c => ({ ...c, selected: false })),
      })),
      deleteCard: (id: string) => set(state => ({
        cards: state.cards.filter(c => c.id !== id),
      })),
      deleteSelected: () => set(state => ({
        cards: state.cards.filter(c => !c.selected),
      })),
      deleteCardsById: (ids: string[]) => set(state => ({
        cards: state.cards.filter(c => !ids.includes(c.id)),
      })),
      setStatusFilter: v => set({ statusFilter: v }),
      setSearchQuery: v => set({ searchQuery: v }),
      clearCards: () => set({ cards: [] }),
    }),
    {
      name: 'stitch-card-tools',
    }
  )
);
