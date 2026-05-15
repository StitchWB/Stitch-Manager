import { useState, useCallback, useMemo } from 'react';
import {
  CreditCard,
  AlertCircle,
  CheckCircle2,
  Building2,
  Copy,
  Sparkles,
  Loader2,
  Globe,
  Save,
  Trash2,
  Plus,
  X,
  Search,
  LayoutGrid,
  RotateCcw,
  Download,
} from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { cn } from '../lib/utils';
import { useBinPresetsStore, type BinPreset } from '../stores/binPresets';
import { useCardToolsStore, type PersistedCard } from '../stores/cardTools';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';

/* ═══════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════ */

interface CardCheckResult {
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
}

interface GeneratedCard extends PersistedCard {}

type StatusFilter = 'all' | 'live' | 'die' | 'unknown' | 'unchecked';

/* ═══════════════════════════════════════════════
   LUHN + GENERATOR HELPERS
   ═══════════════════════════════════════════════ */

function luhnChecksum(num: string): number {
  let sum = 0;
  let alternate = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num.substring(i, i + 1), 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10;
}

function luhnComplete(partial: string): string {
  const checksum = luhnChecksum(partial + '0');
  const checkDigit = checksum === 0 ? 0 : 10 - checksum;
  return partial + String(checkDigit);
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cardLengthByBin(bin: string): number {
  if (/^3[47]/.test(bin)) return 15;
  return 16;
}

function generateCardNumber(bin: string): string {
  const prefix = bin.replace(/x/gi, '');
  const totalDigits = cardLengthByBin(prefix);
  const missing = totalDigits - 1 - prefix.length;
  let middle = '';
  for (let i = 0; i < missing; i++) middle += String(rand(0, 9));
  return luhnComplete(prefix + middle);
}

function generateCvv(bin: string): string {
  const isAmex = /^3[47]/.test(bin);
  const length = isAmex ? 4 : 3;
  let cvv = '';
  for (let i = 0; i < length; i++) cvv += String(rand(0, 9));
  return cvv;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════ */

export default function Tools() {
  /* ── Generator form ── */
  const bin = useCardToolsStore(s => s.bin);
  const setBin = useCardToolsStore(s => s.setBin);
  const month = useCardToolsStore(s => s.month);
  const setMonth = useCardToolsStore(s => s.setMonth);
  const year = useCardToolsStore(s => s.year);
  const setYear = useCardToolsStore(s => s.setYear);
  const cvv = useCardToolsStore(s => s.cvv);
  const setCvv = useCardToolsStore(s => s.setCvv);
  const quantity = useCardToolsStore(s => s.quantity);
  const setQuantity = useCardToolsStore(s => s.setQuantity);
  const cards = useCardToolsStore(s => s.cards);
  const setCards = useCardToolsStore(s => s.setCards);
  const [generating, setGenerating] = useState(false);

  /* ── Bulk-check progress ── */
  const [checkingProgress, setCheckingProgress] = useState<{ current: number; total: number } | null>(null);


  /* ── Presets ── */
  const presets = useBinPresetsStore(s => s.presets);
  const addPreset = useBinPresetsStore(s => s.addPreset);
  const removePreset = useBinPresetsStore(s => s.removePreset);
  const [presetName, setPresetName] = useState('');
  const [showSavePreset, setShowSavePreset] = useState(false);

  /* ── Manual check ── */
  const manualInput = useCardToolsStore(s => s.manualInput);
  const setManualInput = useCardToolsStore(s => s.setManualInput);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<CardCheckResult | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<{time: string; msg: string}[]>([]);

  /* ── Filters ── */
  const statusFilter = useCardToolsStore(s => s.statusFilter);
  const setStatusFilter = useCardToolsStore(s => s.setStatusFilter);
  const searchQuery = useCardToolsStore(s => s.searchQuery);
  const setSearchQuery = useCardToolsStore(s => s.setSearchQuery);

  const currentYear = new Date().getFullYear();

  /* ── Derived: filtered cards ── */
  const filteredCards = useMemo(() => {
    let list = cards;
    if (statusFilter !== 'all') {
      list = list.filter(c => {
        if (statusFilter === 'unchecked') return !c.checkResult && !c.checkError;
        if (statusFilter === 'live') return c.checkResult?.status === 'Live';
        if (statusFilter === 'die') return c.checkResult?.status === 'Die';
        if (statusFilter === 'unknown') return c.checkResult?.status === 'Unknown';
        return true;
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        c =>
          c.number.toLowerCase().includes(q) ||
          c.checkResult?.bank.toLowerCase().includes(q) ||
          c.checkResult?.countryName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [cards, statusFilter, searchQuery]);

  /* ── Stats ── */
  const stats = useMemo(() => {
    const live = cards.filter(c => c.checkResult?.status === 'Live').length;
    const die = cards.filter(c => c.checkResult?.status === 'Die').length;
    const unknown = cards.filter(c => c.checkResult?.status === 'Unknown').length;
    const unchecked = cards.filter(c => !c.checkResult && !c.checkError).length;
    const checking = cards.filter(c => c.checking).length;
    return { live, die, unknown, unchecked, checking, total: cards.length };
  }, [cards]);

  /* ── Generate ── */
  const handleGenerate = useCallback(() => {
    const cleanBin = bin.trim().replace(/\s/g, '');
    if (!cleanBin || cleanBin.length < 6) {
      toast.error('BIN должен содержать минимум 6 цифр');
      return;
    }

    setGenerating(true);
    const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 1000);
    const generated: GeneratedCard[] = [];

    for (let i = 0; i < qty; i++) {
      const num = generateCardNumber(cleanBin);
      const m = month.trim() || String(rand(1, 12)).padStart(2, '0');
      const y = year.trim() || String(rand(currentYear, currentYear + 5));
      const c = cvv.trim() || generateCvv(cleanBin);
      generated.push({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        number: num,
        month: m,
        year: y,
        cvv: c,
        checkResult: null,
        checkError: null,
        checking: false,
        selected: false,
      });
    }

    setCards(generated);
    setGenerating(false);
    toast.success(`Сгенерировано ${qty} карт`);
  }, [bin, month, year, cvv, quantity, currentYear]);

  /* ── Check one card with retry ── */
  const checkCard = useCallback(async (cardId: string) => {
    let cardSnapshot: GeneratedCard | undefined;

    setCards(prev => {
      const card = prev.find(c => c.id === cardId);
      if (!card || card.checking) return prev;
      cardSnapshot = card;
      return prev.map(c => (c.id === cardId ? { ...c, checking: true, checkError: null } : c));
    });

    if (!cardSnapshot) return;

    const payload = `${cardSnapshot.number}|${cardSnapshot.month}|${cardSnapshot.year}|${cardSnapshot.cvv}`;

    const MAX_RETRIES = 3;
    let lastError = 'Error';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 800ms, 1600ms
        await sleep(800 * attempt);
        setCards(prev =>
          prev.map(c =>
            c.id === cardId ? { ...c, checkError: `Retry ${attempt + 1}/${MAX_RETRIES}…` } : c
          )
        );
      }

      try {
        addDebugLog(`→ check_card_rust: ${cardSnapshot.number.substring(0,6)}...`);
        const data = await invoke<CardCheckResult>('check_card_rust', { cardData: payload });
        addDebugLog(`← ${data.success ? data.status : 'ERROR'}: ${data.message}`);

        if (!data.success) {
          lastError = data.message;
          break; // do NOT retry on rate limit or API errors
        }

        setCards(prev =>
          prev.map(c => (c.id === cardId ? { ...c, checking: false, checkResult: data } : c))
        );
        return; // success
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Error';
        addDebugLog(`← EXCEPTION: ${lastError}`);
        // continue to next retry only on timeout; all other errors are final
        if (lastError.includes('Timeout')) {
          continue;
        }
        break; // non-timeout errors are not retryable
      }
    }

    // Error (rate limit or other non-retryable)
    setCards(prev =>
      prev.map(c =>
        c.id === cardId ? { ...c, checking: false, checkError: lastError } : c
      )
    );
  }, []);

  /* ── Check multiple with sliding window (max concurrent, refill immediately) ── */
  const MAX_CONCURRENT = 5;
  const WINDOW_RESET_MS = 10000; // 10s = rate limit window

  const checkMultiple = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;

    setCheckingProgress({ current: 0, total: ids.length });
    addDebugLog(`Starting sliding window: ${ids.length} cards, max concurrent: ${MAX_CONCURRENT}`);

    let completed = 0;
    let nextIndex = 0;
    const running = new Map<string, Promise<void>>();
    const startTimes = new Map<string, number>();

    const startNext = async () => {
      if (nextIndex >= ids.length) return;
      const id = ids[nextIndex++];
      startTimes.set(id, Date.now());
      
      const promise = checkCard(id).then(() => {
        completed++;
        setCheckingProgress({ current: completed, total: ids.length });
        running.delete(id);
        // Immediately start next if window allows
        if (running.size < MAX_CONCURRENT && nextIndex < ids.length) {
          startNext();
        }
      });
      
      running.set(id, promise);
    };

    // Start initial window
    const initialCount = Math.min(MAX_CONCURRENT, ids.length);
    addDebugLog(`Starting initial window: ${initialCount} cards`);
    for (let i = 0; i < initialCount; i++) {
      startNext();
    }

    // Wait for all to complete, refilling window as slots open
    while (running.size > 0 || nextIndex < ids.length) {
      if (running.size === 0 && nextIndex < ids.length) {
        // Window empty but more cards remain - rate limit hit, wait for window reset
        addDebugLog(`Window empty, waiting ${WINDOW_RESET_MS / 1000}s for rate limit reset...`);
        await sleep(WINDOW_RESET_MS);
        // Refill window
        const refillCount = Math.min(MAX_CONCURRENT, ids.length - nextIndex);
        addDebugLog(`Refilling window: ${refillCount} cards`);
        for (let i = 0; i < refillCount; i++) {
          startNext();
        }
      } else if (running.size > 0) {
        // Wait for any to complete
        await Promise.race(running.values());
      } else {
        break;
      }
    }

    setCheckingProgress(null);
    toast.success(`Проверено ${ids.length} карт`);
  }, [checkCard]);

  const checkAll = useCallback(() => {
    const ids = cards.filter(c => !c.checkResult && !c.checking && !c.checkError).map(c => c.id);
    if (ids.length === 0) {
      toast.info('Нет карт для проверки');
      return;
    }
    void checkMultiple(ids);
  }, [cards, checkMultiple]);

  const checkSelected = useCallback(() => {
    const ids = cards.filter(c => c.selected && !c.checkResult && !c.checking && !c.checkError).map(c => c.id);
    if (ids.length === 0) {
      toast.info('Нет выбранных карт для проверки');
      return;
    }
    void checkMultiple(ids);
  }, [cards, checkMultiple]);

  /* ── Selection ── */
  const toggleSelect = useCallback((cardId: string) => {
    setCards(prev => prev.map(c => (c.id === cardId ? { ...c, selected: !c.selected } : c)));
  }, []);

  const selectAllFiltered = useCallback(() => {
    const ids = new Set(filteredCards.map(c => c.id));
    setCards(prev => prev.map(c => (ids.has(c.id) ? { ...c, selected: true } : c)));
  }, [filteredCards]);

  const deselectAll = useCallback(() => {
    setCards(prev => prev.map(c => ({ ...c, selected: false })));
  }, []);

  /* ── Manual check with retry ── */
  const handleManualCheck = async () => {
    if (!manualInput.trim()) return;
    setManualLoading(true);
    setManualError(null);
    setManualResult(null);

    const MAX_RETRIES = 3;
    let lastError = 'Unknown error';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(1000 * attempt + 500);
      }

      try {
        const cardNum = manualInput.trim().split('|')[0];
        addDebugLog(`→ manual check: ${cardNum.substring(0,6)}...`);
        const data = await invoke<CardCheckResult>('check_card_rust', { cardData: manualInput.trim() });
        addDebugLog(`← ${data.success ? data.status : 'ERROR'}: ${data.message}`);

        if (!data.success) {
          lastError = data.message;
          break; // do NOT retry on rate limit or API errors
        }

        setManualResult(data);
        setManualLoading(false);
        toast.success(`Карта ${data.status}: ${data.message}`);
        return; // success
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Error';
        addDebugLog(`← EXCEPTION: ${lastError}`);
        if (lastError.includes('Timeout')) continue;
        break; // non-timeout errors are not retryable
      }
    }

    // Error (rate limit or other non-retryable)
    setManualError(lastError);
    setManualLoading(false);
    toast.error(lastError);
  };

  /* ── Presets ── */
  const applyPreset = useCallback((preset: BinPreset) => {
    setBin(preset.bin);
    setMonth(preset.month);
    setYear(preset.year);
    setCvv(preset.cvv);
    setQuantity(preset.quantity);
    toast.info(`Пресет «${preset.name}» загружен`);
  }, []);

  const handleSavePreset = () => {
    if (!bin.trim()) {
      toast.error('Введите BIN для сохранения');
      return;
    }
    const name = presetName.trim() || `BIN ${bin.replace(/x/gi, '').slice(0, 10)}`;
    addPreset({ name, bin, month, year, cvv, quantity });
    setPresetName('');
    setShowSavePreset(false);
    toast.success(`Пресет «${name}» сохранен`);
  };

  /* ── Copy / Export ── */
  const copyCard = async (card: GeneratedCard) => {
    const text = `${card.number}|${card.month}|${card.year}|${card.cvv}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Скопировано в буфер');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const copyAll = async () => {
    const text = cards.map(c => `${c.number}|${c.month}|${c.year}|${c.cvv}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Скопировано ${cards.length} строк`);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const copySelected = async () => {
    const selected = cards.filter(c => c.selected);
    const text = selected.map(c => `${c.number}|${c.month}|${c.year}|${c.cvv}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Скопировано ${selected.length} строк`);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const exportResults = () => {
    const lines = cards.map(c => {
      const status = c.checkResult?.status || c.checkError || 'unchecked';
      return `${c.number}|${c.month}|${c.year}|${c.cvv}|${status}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cards-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Результаты экспортированы');
  };

  /* ── Delete ── */
  const deleteCard = useCallback((cardId: string) => {
    setCards(prev => prev.filter(c => c.id !== cardId));
  }, []);

  const deleteSelected = useCallback(() => {
    const count = cards.filter(c => c.selected).length;
    setCards(prev => prev.filter(c => !c.selected));
    toast.success(`Удалено ${count} карт`);
  }, [cards]);

  /* ── UI helpers ── */
  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'Live': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'Die': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'Unknown': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  const getStatusBadge = (status: string | undefined) => {
    if (!status) return <span className="text-xs text-slate-600">—</span>;
    switch (status) {
      case 'Live': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Live</span>;
      case 'Die': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">Die</span>;
      case 'Unknown': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">Unknown</span>;
      default: return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-500/15 text-slate-400 border border-slate-500/20">?</span>;
    }
  };

  const formatApiError = (err: string): string => {
    if (err.includes('429') || err.includes('Rate limit')) {
      return 'Слишком много запросов. Подождите 10-20 секунд и попробуйте снова.';
    }
    if (err.includes('Timeout')) return 'API не ответил вовремя. Повторите попытку.';
    if (err.includes('fetch')) return 'Ошибка сети. Проверьте подключение.';
    return err;
  };

  const addDebugLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    console.log(`[CardCheck ${time}] ${msg}`);
    setDebugLogs(prev => {
      const next = [{ time, msg }, ...prev].slice(0, 20);
      return next;
    });
  };

  /* ── JSX ── */
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ═══════ HEADER ═══════ */}
      <div className="px-6 py-3 border-b border-white/5 bg-ds-surface-base/70 backdrop-blur-xl shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white tracking-tight">Card Tools</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">Генерация и проверка карт</p>
        </div>
        <div className="flex items-center gap-2">
          {stats.checking > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[11px] font-medium">
              <Loader2 size={12} className="animate-spin" />
              Checking {checkingProgress?.current ?? 0}/{checkingProgress?.total ?? stats.checking}
            </span>
          )}
          <StatBadge count={stats.live} label="Live" color="emerald" />
          <StatBadge count={stats.die} label="Die" color="red" />
          <StatBadge count={stats.unchecked} label="—" color="slate" />
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* ═══════ LEFT: MAIN CONTENT ═══════ */}
        <div className="flex-1 overflow-auto p-4 space-y-4 min-w-0">

          {/* ── Generator ── */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-indigo-400" />
                <h2 className="text-sm font-semibold text-white">Генератор</h2>
              </div>
              <div className="flex items-center gap-1.5">
                {showSavePreset ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={presetName}
                      onChange={e => setPresetName(e.target.value)}
                      placeholder="Название пресета"
                      className="h-7 text-xs w-40"
                      onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); }}
                    />
                    <Button size="xs" onClick={handleSavePreset} leftIcon={<Save size={12} />}>Save</Button>
                    <Button size="xs" variant="ghost" onClick={() => setShowSavePreset(false)} leftIcon={<X size={12} />}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowSavePreset(true)}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded-md hover:bg-indigo-500/10"
                  >
                    <Save size={12} />Сохранить
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="lg:col-span-2">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">BIN</label>
                <Input value={bin} onChange={e => setBin(e.target.value)} placeholder="515462002112xxxx" className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">MM</label>
                <Input value={month} onChange={e => setMonth(e.target.value)} placeholder="Random" className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">YY</label>
                <Input value={year} onChange={e => setYear(e.target.value)} placeholder="Random" className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">CVV</label>
                <Input value={cvv} onChange={e => setCvv(e.target.value)} placeholder="Random" className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">Qty</label>
                <Input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="10" type="number" min={1} max={1000} className="text-sm" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleGenerate} isLoading={generating} leftIcon={<Sparkles size={14} />}>Generate</Button>
              {cards.length > 0 && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => void copyAll()} leftIcon={<Copy size={14} />}>Copy All</Button>
                  <Button size="sm" variant="secondary" onClick={() => void checkAll()} leftIcon={<CreditCard size={14} />}>Check All</Button>
                  <Button size="sm" variant="secondary" onClick={exportResults} leftIcon={<Download size={14} />}>Export</Button>
                  <Button size="sm" variant="ghost" onClick={() => useCardToolsStore.getState().clearCards()} leftIcon={<Trash2 size={14} />}>Clear</Button>
                </>
              )}
            </div>
          </div>

          {/* ── Manual Check ── */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <RotateCcw size={16} className="text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">Ручная проверка</h2>
            </div>
            <div className="flex gap-2">
              <Input
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                placeholder="4242424242424242|12|2025|123"
                className="flex-1 text-sm"
                onKeyDown={e => { if (e.key === 'Enter') void handleManualCheck(); }}
              />
              <Button size="sm" onClick={() => void handleManualCheck()} isLoading={manualLoading} leftIcon={<CreditCard size={14} />}>Check</Button>
            </div>
            {manualError && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{formatApiError(manualError)}</span>
              </div>
            )}
            {manualResult && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className={cn('p-2.5 rounded-lg border flex items-center gap-2', getStatusColor(manualResult.status))}>
                  <CheckCircle2 size={14} className="shrink-0" />
                  <div><div className="text-xs font-semibold">{manualResult.status}</div><div className="text-[10px] opacity-80">{manualResult.message}</div></div>
                </div>
                <InfoBadge label="Bank" value={manualResult.bank} icon={<Building2 size={11} />} />
                <InfoBadge label="Type" value={`${manualResult.cardType} / ${manualResult.category}`} />
                <InfoBadge label="Country" value={`${manualResult.countryEmoji} ${manualResult.countryName}`} icon={<Globe size={11} />} />
              </div>
            )}
          </div>

          {/* ── Results Table ── */}
          {cards.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
              {/* Table Header / Toolbar */}
              <div className="px-4 py-2.5 border-b border-white/5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white flex items-center gap-2">
                  <LayoutGrid size={14} className="text-indigo-400" />
                  Результаты <span className="text-[11px] font-normal text-slate-500">({filteredCards.length}/{cards.length})</span>
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
                    <input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Поиск..."
                      className="pl-7 pr-2 py-1 h-7 bg-white/[0.03] border border-white/10 rounded-md text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 transition-colors w-32"
                    />
                  </div>
                  <div className="flex bg-white/[0.03] rounded-md border border-white/10 p-0.5">
                    {([
                      { key: 'all', label: 'Все' },
                      { key: 'live', label: 'Live' },
                      { key: 'die', label: 'Die' },
                      { key: 'unknown', label: '?' },
                      { key: 'unchecked', label: '—' },
                    ] as { key: StatusFilter; label: string }[]).map(f => (
                      <button
                        key={f.key}
                        onClick={() => setStatusFilter(f.key)}
                        className={cn(
                          'px-2 py-0.5 text-[10px] font-medium rounded-sm transition-colors',
                          statusFilter === f.key ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-300'
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bulk Actions */}
              {cards.some(c => c.selected) && (
                <div className="px-4 py-1.5 border-b border-white/5 bg-indigo-500/5 flex items-center gap-2 text-[11px]">
                  <span className="text-indigo-300 font-medium">{cards.filter(c => c.selected).length} selected</span>
                  <button onClick={selectAllFiltered} className="text-indigo-400 hover:text-indigo-300 transition-colors">Select filtered</button>
                  <button onClick={deselectAll} className="text-slate-500 hover:text-slate-300 transition-colors">Deselect</button>
                  <div className="flex-1" />
                  <Button size="xs" variant="secondary" onClick={() => void checkSelected()} leftIcon={<CreditCard size={11} />}>Check</Button>
                  <Button size="xs" variant="secondary" onClick={() => void copySelected()} leftIcon={<Copy size={11} />}>Copy</Button>
                  <Button size="xs" variant="danger" onClick={deleteSelected} leftIcon={<Trash2 size={11} />}>Delete</Button>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <th className="px-2 py-2 w-7">
                        <input
                          type="checkbox"
                          checked={filteredCards.length > 0 && filteredCards.every(c => c.selected)}
                          onChange={e => { if (e.target.checked) selectAllFiltered(); else deselectAll(); }}
                          className="rounded-sm border-white/20 bg-transparent accent-indigo-500 w-3.5 h-3.5"
                        />
                      </th>
                      <th className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Number</th>
                      <th className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider w-12">MM</th>
                      <th className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider w-12">YY</th>
                      <th className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider w-14">CVV</th>
                      <th className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">Details</th>
                      <th className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider text-right w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCards.map(card => (
                      <tr key={card.id} className={cn('border-b border-white/5 last:border-0 transition-colors', card.selected ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]')}>
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={card.selected}
                            onChange={() => toggleSelect(card.id)}
                            className="rounded-sm border-white/20 bg-transparent accent-indigo-500 w-3.5 h-3.5"
                          />
                        </td>
                        <td className="px-2 py-2 text-xs font-mono text-slate-200">{card.number}</td>
                        <td className="px-2 py-2 text-xs text-slate-400">{card.month}</td>
                        <td className="px-2 py-2 text-xs text-slate-400">{card.year}</td>
                        <td className="px-2 py-2 text-xs font-mono text-slate-400">{card.cvv}</td>
                        <td className="px-2 py-2">
                          {card.checking ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 size={11} className="animate-spin" />Checking…</span>
                          ) : card.checkError ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20" title={formatApiError(card.checkError)}><AlertCircle size={9} />Error</span>
                          ) : (
                            getStatusBadge(card.checkResult?.status)
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {card.checkResult ? (
                            <div className="flex flex-col gap-0 text-[10px] text-slate-400 leading-tight">
                               <span className="text-slate-300">{card.checkResult.bank}</span>
                              <span>{card.checkResult.cardType} · {card.checkResult.countryEmoji} {card.checkResult.countryName}</span>
                            </div>
                          ) : card.checkError ? (
                            <span className="text-[10px] text-red-400/80 truncate max-w-[120px] block" title={formatApiError(card.checkError)}>{formatApiError(card.checkError)}</span>
                          ) : (
                            <span className="text-[10px] text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <button onClick={() => void checkCard(card.id)} disabled={card.checking} className="w-6 h-6 rounded hover:bg-white/10 transition-colors flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-40" title="Check">
                              {card.checking ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                            </button>
                            <button onClick={() => void copyCard(card)} className="w-6 h-6 rounded hover:bg-white/10 transition-colors flex items-center justify-center text-slate-500 hover:text-white" title="Copy">
                              <Copy size={12} />
                            </button>
                            <button onClick={() => deleteCard(card.id)} className="w-6 h-6 rounded hover:bg-red-500/10 transition-colors flex items-center justify-center text-slate-500 hover:text-red-400" title="Delete">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredCards.length === 0 && cards.length > 0 && (
                <div className="p-6 text-center text-xs text-slate-500">Нет результатов по фильтру</div>
              )}
            </div>
          )}
        </div>

        {/* ═══════ RIGHT: PRESETS ═══════ */}
        <div className="w-56 shrink-0 border-l border-white/5 bg-white/[0.01] overflow-y-auto p-3 space-y-3 hidden lg:block">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Пресеты</h3>
            <span className="text-[10px] text-slate-600">{presets.length}</span>
          </div>

          {presets.length === 0 && (
            <div className="text-[11px] text-slate-600 text-center py-4 leading-relaxed">
              Нет сохраненных<br />пресетов
            </div>
          )}

          <div className="space-y-1.5">
            {presets.map(preset => (
              <div
                key={preset.id}
                className="group p-2.5 rounded-lg bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-all cursor-pointer"
                onClick={() => applyPreset(preset)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-white truncate pr-3">{preset.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); removePreset(preset.id); toast.info('Пресет удален'); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded hover:bg-red-500/10 flex items-center justify-center text-slate-600 hover:text-red-400"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div className="text-[10px] font-mono text-slate-500 truncate">{preset.bin}</div>
                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-600">
                  {preset.month && <span className="px-1 py-0.5 rounded bg-white/[0.03] text-slate-500">{preset.month}</span>}
                  {preset.year && <span className="px-1 py-0.5 rounded bg-white/[0.03] text-slate-500">{preset.year}</span>}
                  <span className="ml-auto text-slate-500">×{preset.quantity}</span>
                </div>
              </div>
            ))}
          </div>

          {bin && (
            <button
              onClick={() => setShowSavePreset(true)}
              className="w-full py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-slate-500 hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all flex items-center justify-center gap-1"
            >
              <Plus size={13} />Сохранить текущий
            </button>
          )}
        </div>
      </div>

      {/* Debug Log */}
      {debugLogs.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-white/5 bg-black/20">
          <div className="text-[10px] text-slate-500 mb-1 font-mono">Debug ({debugLogs.length}):</div>
          <div className="font-mono text-[10px] space-y-0.5 max-h-24 overflow-y-auto">
            {debugLogs.map((log, i) => (
              <div key={i} className="text-slate-400">
                <span className="text-slate-600">{log.time}</span> {log.msg}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   SUB-COMPONENTS
   ═══════════════════════════════════════════════ */

function InfoBadge({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="p-2.5 rounded-lg border border-white/10 bg-white/[0.02] space-y-0.5">
      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <div className="text-xs text-slate-200 font-medium flex items-center gap-1.5">
        {icon}
        <span className="truncate">{value}</span>
      </div>
    </div>
  );
}

function StatBadge({ count, label, color }: { count: number; label: string; color: 'emerald' | 'red' | 'amber' | 'slate' | 'indigo' }) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    slate: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  };
  return (
    <span className={cn('px-1.5 py-0.5 rounded border text-[10px] font-medium', colorMap[color])}>
      {count} {label}
    </span>
  );
}
