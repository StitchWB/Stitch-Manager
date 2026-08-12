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
import { Button, Checkbox, IconButton, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui';
import { cn } from '../lib/utils';
import { useBinPresetsStore, type BinPreset } from '../stores/binPresets';
import { useCardToolsStore, type PersistedCard } from '../stores/cardTools';
import { toast } from 'sonner';
import { safeInvoke } from '../lib/backend/core';
import { t } from '../lib/i18n';
import { createLogger } from '../lib/observability/logger';
const log = createLogger('CardCheck');

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

type GeneratedCard = PersistedCard;

type StatusFilter = 'all' | 'live' | 'die' | 'unknown' | 'unchecked';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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

  /* ── Generate via Rust ── */
  const handleGenerate = useCallback(async () => {
    const cleanBin = bin.trim().replace(/\s/g, '');
    if (!cleanBin || cleanBin.length < 6) {
      toast.error(t('tools.toastBinTooShort'));
      return;
    }

    setGenerating(true);
    const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 1000);
    
    try {
      const generated = await safeInvoke<GeneratedCard[]>('generate_cards', {
        req: {
          bin: cleanBin,
          quantity: qty,
          month: month.trim() || null,
          year: year.trim() || null,
        },
      });
      // Prepend new cards to existing list
      setCards(prev => [...generated.map(c => ({
        ...c,
        checkResult: null,
        checkError: null,
        checking: false,
        selected: false,
      })), ...prev]);
      toast.success(t('tools.toastChecked', { count: generated.length }));
    } catch (err) {
      toast.error(t('tools.errorGeneration', { msg: String(err) }));
    } finally {
      setGenerating(false);
    }
  }, [bin, month, year, quantity, setCards]);

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
        const data = await safeInvoke<CardCheckResult>('check_card_rust', { cardData: payload });
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
  }, [setCards]);

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
    toast.success(t('tools.toastChecked', { count: ids.length }));
  }, [checkCard]);

  const checkAll = useCallback(() => {
    const ids = cards.filter(c => !c.checking && !c.checkError).map(c => c.id);
    if (ids.length === 0) {
      toast.info(t('tools.toastNoCards'));
      return;
    }
    void checkMultiple(ids);
  }, [cards, checkMultiple]);

  const checkSelected = useCallback(() => {
    const ids = cards.filter(c => c.selected && !c.checking && !c.checkError).map(c => c.id);
    if (ids.length === 0) {
      toast.info(t('tools.toastNoSelectedCards'));
      return;
    }
    void checkMultiple(ids);
  }, [cards, checkMultiple]);

  /* ── Selection ── */
  const toggleSelect = useCallback((cardId: string) => {
    setCards(prev => prev.map(c => (c.id === cardId ? { ...c, selected: !c.selected } : c)));
  }, [setCards]);

  const selectAllFiltered = useCallback(() => {
    const ids = new Set(filteredCards.map(c => c.id));
    setCards(prev => prev.map(c => (ids.has(c.id) ? { ...c, selected: true } : c)));
  }, [filteredCards, setCards]);

  const deselectAll = useCallback(() => {
    setCards(prev => prev.map(c => ({ ...c, selected: false })));
  }, [setCards]);

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
        const data = await safeInvoke<CardCheckResult>('check_card_rust', { cardData: manualInput.trim() });
        addDebugLog(`← ${data.success ? data.status : 'ERROR'}: ${data.message}`);

        if (!data.success) {
          lastError = data.message;
          break; // do NOT retry on rate limit or API errors
        }

        setManualResult(data);
        setManualLoading(false);
        toast.success(t('tools.toastCardStatus', { status: data.status, message: data.message }));
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
    toast.info(t('tools.toastPresetLoaded', { name: preset.name }));
  }, [setBin, setCvv, setMonth, setQuantity, setYear]);

  const handleSavePreset = () => {
    if (!bin.trim()) {
      toast.error(t('tools.toastBinTooShort'));
      return;
    }
    const name = presetName.trim() || `BIN ${bin.replace(/x/gi, '').slice(0, 10)}`;
    addPreset({ name, bin, month, year, cvv, quantity });
    setPresetName('');
    setShowSavePreset(false);
    toast.success(t('tools.toastPresetSaved', { name }));
  };

  /* ── Copy / Export ── */
  const copyCard = async (card: GeneratedCard) => {
    const text = `${card.number}|${card.month}|${card.year}|${card.cvv}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('tools.toastCopied'));
    } catch {
      toast.error(t('tools.errorCopyFailed'));
    }
  };

  const copyAll = async () => {
    const text = cards.map(c => `${c.number}|${c.month}|${c.year}|${c.cvv}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('tools.toastChecked', { count: cards.length }));
    } catch {
      toast.error(t('tools.errorCopyFailed'));
    }
  };

  const copySelected = async () => {
    const selected = cards.filter(c => c.selected);
    const text = selected.map(c => `${c.number}|${c.month}|${c.year}|${c.cvv}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('tools.toastChecked', { count: selected.length }));
    } catch {
      toast.error(t('tools.errorCopyFailed'));
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
    toast.success(t('tools.toastExported'));
  };

  /* ── Delete ── */
  const deleteCard = useCallback((cardId: string) => {
    setCards(prev => prev.filter(c => c.id !== cardId));
  }, [setCards]);

  const deleteSelected = useCallback(() => {
    const count = cards.filter(c => c.selected).length;
    setCards(prev => prev.filter(c => !c.selected));
    toast.success(t('tools.toastDeleted', { count }));
  }, [cards, setCards]);

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
    if (!status) return <span className="text-xs text-slate-600">{t('tools.filterUnchecked')}</span>;
    switch (status) {
      case 'Live': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">{t('tools.statusLive')}</span>;
      case 'Die': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-500/15 text-red-400 border border-red-500/20">{t('tools.statusDie')}</span>;
      case 'Unknown': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">{t('tools.statusUnknown')}</span>;
      default: return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-500/15 text-slate-400 border border-slate-500/20">{t('tools.filterUnknown')}</span>;
    }
  };

  const formatApiError = (err: string): string => {
    if (err.includes('429') || err.includes('Rate limit')) {
      return t('tools.apiRateLimit');
    }
    if (err.includes('Timeout')) return t('tools.apiTimeout');
    if (err.includes('fetch')) return t('tools.apiNetworkError');
    return err;
  };

  const addDebugLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    log.debug(`[CardCheck ${time}] ${msg}`);
    setDebugLogs(prev => {
      const next = [{ time, msg }, ...prev].slice(0, 20);
      return next;
    });
  };

  /* ── JSX ── */
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ═══════ HEADER ═══════ */}
      <div className="px-6 py-3 border-b border-white/5 bg-vsc-bg/70 backdrop-blur-xl shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white tracking-tight">{t('tools.title')}</h1>
          <p className="text-[11px] text-slate-500 mt-0.5">{t('tools.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {stats.checking > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[11px] font-medium">
              <Loader2 size={12} className="animate-spin" />
              {t('tools.checkingProgress', { current: checkingProgress?.current ?? 0, total: checkingProgress?.total ?? stats.checking })}
            </span>
          )}
          <StatBadge count={stats.live} label={t('tools.filterLive')} color="emerald" />
          <StatBadge count={stats.die} label={t('tools.filterDie')} color="red" />
          <StatBadge count={stats.unchecked} label={t('tools.filterUnchecked')} color="slate" />
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
                <h2 className="text-sm font-semibold text-white">{t('tools.generatorTitle')}</h2>
              </div>
              <div className="flex items-center gap-1.5">
                {showSavePreset ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={presetName}
                      onChange={e => setPresetName(e.target.value)}
                      placeholder={t('tools.presetNamePlaceholder')}
                      className="h-7 text-xs w-40"
                      onKeyDown={e => { if (e.key === 'Enter') handleSavePreset(); }}
                    />
                    <Button size="xs" onClick={handleSavePreset} leftIcon={<Save size={12} />}>{t('common.save')}</Button>
                    <Button size="xs" variant="ghost" onClick={() => setShowSavePreset(false)} leftIcon={<X size={12} />}>{t('common.cancel')}</Button>
                  </div>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setShowSavePreset(true)}
                    className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors px-2 py-1 rounded-md hover:bg-indigo-500/10"
                    leftIcon={<Save size={12} />}
                  >
                    {t('common.save')}
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="lg:col-span-2">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">{t('tools.binLabel')}</label>
                <Input value={bin} onChange={e => setBin(e.target.value)} placeholder={t('tools.placeholderBin')} className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">{t('tools.mmLabel')}</label>
                <Input value={month} onChange={e => setMonth(e.target.value)} placeholder={t('tools.placeholderMonth')} className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">{t('tools.yyLabel')}</label>
                <Input value={year} onChange={e => setYear(e.target.value)} placeholder={t('tools.placeholderYear')} className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">{t('common.cvv')}</label>
                <Input value={cvv} onChange={e => setCvv(e.target.value)} placeholder={t('tools.placeholderCvv')} className="text-sm" />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1 block">{t('tools.quantityLabel')}</label>
                <Input value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="10" type="number" min={1} max={1000} className="text-sm" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleGenerate} isLoading={generating} leftIcon={<Sparkles size={14} />}>{t('tools.generate')}</Button>
              <Button size="sm" variant="secondary" onClick={() => void copyAll()} leftIcon={<Copy size={14} />}>{t('tools.copyAll')}</Button>
              <Button size="sm" variant="secondary" onClick={() => void checkAll()} leftIcon={<CreditCard size={14} />}>{t('tools.checkAll')}</Button>
              <Button size="sm" variant="secondary" onClick={exportResults} leftIcon={<Download size={14} />}>{t('common.export')}</Button>
              <Button size="sm" variant="ghost" onClick={() => useCardToolsStore.getState().clearCards()} leftIcon={<Trash2 size={14} />}>{t('common.clear')}</Button>
            </div>
          </div>

          {/* ── Manual Check ── */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center gap-2">
              <RotateCcw size={16} className="text-emerald-400" />
              <h2 className="text-sm font-semibold text-white">{t('tools.manualCheckTitle')}</h2>
            </div>
            <div className="flex gap-2">
              <Input
                value={manualInput}
                onChange={e => setManualInput(e.target.value)}
                placeholder={t('tools.placeholderManualCheck')}
                className="flex-1 text-sm"
                onKeyDown={e => { if (e.key === 'Enter') void handleManualCheck(); }}
              />
              <Button size="sm" onClick={() => void handleManualCheck()} isLoading={manualLoading} leftIcon={<CreditCard size={14} />}>{t('tools.check')}</Button>
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
                <InfoBadge label={t('tools.bankLabel')} value={manualResult.bank} icon={<Building2 size={11} />} />
                <InfoBadge label={t('tools.typeLabel')} value={`${manualResult.cardType} / ${manualResult.category}`} />
                <InfoBadge label={t('tools.countryLabel')} value={`${manualResult.countryEmoji} ${manualResult.countryName}`} icon={<Globe size={11} />} />
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
                  {t('tools.resultsTitle')} <span className="text-[11px] font-normal text-slate-500">({filteredCards.length}/{cards.length})</span>
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600" />
                    <Input
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder={t('tools.placeholderSearch')}
                      className="pl-7 pr-2 py-1 h-7 bg-white/[0.03] border border-white/10 rounded-md text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-indigo-500/50 transition-colors w-32"
                      shellClassName="h-7"
                    />
                  </div>
                  <div className="flex bg-white/[0.03] rounded-md border border-white/10 p-0.5">
                    {([
                      { key: 'all', label: t('tools.filterAll') },
                      { key: 'live', label: t('tools.filterLive') },
                      { key: 'die', label: t('tools.filterDie') },
                      { key: 'unknown', label: t('tools.filterUnknown') },
                      { key: 'unchecked', label: t('tools.filterUnchecked') },
                    ] as { key: StatusFilter; label: string }[]).map(f => (
                      <Button
                        key={f.key}
                        size="xs"
                        variant={statusFilter === f.key ? 'primary' : 'ghost'}
                        onClick={() => setStatusFilter(f.key)}
                        className={cn(
                          'px-2 py-0.5 text-[10px] font-medium rounded-sm transition-colors',
                          statusFilter === f.key ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-300'
                        )}
                      >
                        {f.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bulk Actions */}
              {cards.some(c => c.selected) && (
                <div className="px-4 py-1.5 border-b border-white/5 bg-indigo-500/5 flex items-center gap-2 text-[11px]">
                  <span className="text-indigo-300 font-medium">{t('tools.selectedCount', { count: cards.filter(c => c.selected).length })}</span>
                  <Button size="xs" variant="ghost" onClick={selectAllFiltered} className="text-indigo-400 hover:text-indigo-300 transition-colors">{t('tools.selectFiltered')}</Button>
                  <Button size="xs" variant="ghost" onClick={deselectAll} className="text-slate-500 hover:text-slate-300 transition-colors">{t('tools.deselect')}</Button>
                  <div className="flex-1" />
                  <Button size="xs" variant="secondary" onClick={() => void checkSelected()} leftIcon={<CreditCard size={11} />}>{t('tools.check')}</Button>
                  <Button size="xs" variant="secondary" onClick={() => void copySelected()} leftIcon={<Copy size={11} />}>{t('tools.copy')}</Button>
                  <Button size="xs" variant="danger" onClick={deleteSelected} leftIcon={<Trash2 size={11} />}>{t('common.delete')}</Button>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <Table className="w-full text-left">
                  <TableHeader>
                    <TableRow className="border-b border-white/5 bg-white/[0.02]">
                      <TableHead className="px-2 py-2 w-7">
                        <Checkbox
                          checked={filteredCards.length > 0 && filteredCards.every(c => c.selected)}
                          onChange={e => { if (e.target.checked) selectAllFiltered(); else deselectAll(); }}
                        />
                      </TableHead>
                      <TableHead className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{t('tools.tableNumber')}</TableHead>
                      <TableHead className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider w-12">{t('tools.mmLabel')}</TableHead>
                      <TableHead className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider w-12">{t('tools.yyLabel')}</TableHead>
                      <TableHead className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider w-14">{t('common.cvv')}</TableHead>
                      <TableHead className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{t('tools.tableStatus')}</TableHead>
                      <TableHead className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">{t('tools.tableDetails')}</TableHead>
                      <TableHead className="px-2 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider text-right w-20">{t('tools.tableActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCards.map(card => (
                      <TableRow key={card.id} className={cn('border-b border-white/5 last:border-0 transition-colors', card.selected ? 'bg-indigo-500/5' : 'hover:bg-white/[0.02]')}
                      >
                        <TableCell className="px-2 py-2">
                          <Checkbox
                            checked={card.selected}
                            onChange={() => toggleSelect(card.id)}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-2 text-xs font-mono text-slate-200">{card.number}</TableCell>
                        <TableCell className="px-2 py-2 text-xs text-slate-400">{card.month}</TableCell>
                        <TableCell className="px-2 py-2 text-xs text-slate-400">{card.year}</TableCell>
                        <TableCell className="px-2 py-2 text-xs font-mono text-slate-400">{card.cvv}</TableCell>
                        <TableCell className="px-2 py-2">
                          {card.checking ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Loader2 size={11} className="animate-spin" />{t('tools.checking')}</span>
                          ) : card.checkError ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20" title={formatApiError(card.checkError)}><AlertCircle size={9} />{t('tools.checkError')}</span>
                          ) : (
                            getStatusBadge(card.checkResult?.status)
                          )}
                        </TableCell>
                        <TableCell className="px-2 py-2">
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
                        </TableCell>
                        <TableCell className="px-2 py-2 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconButton size="sm" variant="ghost" onClick={() => void checkCard(card.id)} disabled={card.checking} className="w-6 h-6 rounded hover:bg-white/10 transition-colors flex items-center justify-center text-slate-500 hover:text-white disabled:opacity-40" title={t('tools.titleCheck')}>
                              {card.checking ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                            </IconButton>
                            <IconButton size="sm" variant="ghost" onClick={() => void copyCard(card)} className="w-6 h-6 rounded hover:bg-white/10 transition-colors flex items-center justify-center text-slate-500 hover:text-white" title={t('tools.titleCopy')}>
                              <Copy size={12} />
                            </IconButton>
                            <IconButton size="sm" variant="danger" onClick={() => deleteCard(card.id)} className="w-6 h-6 rounded hover:bg-red-500/10 transition-colors flex items-center justify-center text-slate-500 hover:text-red-400" title={t('tools.titleDelete')}>
                              <Trash2 size={12} />
                            </IconButton>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {filteredCards.length === 0 && cards.length > 0 && (
                <div className="p-6 text-center text-xs text-slate-500">{t('tools.noFilterResults')}</div>
              )}
            </div>
          )}
        </div>

        {/* ═══════ RIGHT: PRESETS ═══════ */}
        <div className="w-56 shrink-0 border-l border-white/5 bg-white/[0.01] overflow-y-auto p-3 space-y-3 hidden lg:block">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t('tools.presetsTitle')}</h3>
            <span className="text-[10px] text-slate-600">{presets.length}</span>
          </div>

          {presets.length === 0 && (
            <div className="text-[11px] text-slate-600 text-center py-4 leading-relaxed">
              {t('tools.noPresets')}
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
                  <IconButton
                    size="sm"
                    variant="danger"
                    onClick={e => { e.stopPropagation(); removePreset(preset.id); toast.info(t('tools.toastPresetDeleted')); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded hover:bg-red-500/10 flex items-center justify-center text-slate-600 hover:text-red-400"
                  >
                    <Trash2 size={11} />
                  </IconButton>
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
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setShowSavePreset(true)}
              className="w-full py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-slate-500 hover:text-indigo-400 hover:border-indigo-500/30 hover:bg-indigo-500/5 transition-all flex items-center justify-center gap-1"
            >
              <Plus size={13} />{t('tools.saveCurrentPreset')}
            </Button>
          )}
        </div>
      </div>

      {/* Debug Log */}
      {debugLogs.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-white/5 bg-black/20">
          <div className="text-[10px] text-slate-500 mb-1 font-mono">{t('tools.debugLabel', { count: debugLogs.length })}</div>
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