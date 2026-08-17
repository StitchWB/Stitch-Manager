import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Copy, KeyRound } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { t } from '@/lib/i18n';
import {
  getFoundKeys,
  getFoundKeySecret,
  type FoundKey,
} from '@/lib/backend/modules/foundKeys';
import { useAppStore } from '../../stores/app';

/**
 * Collapsible "found keys" panel on the Radar page: masked keys discovered
 * by AiApiRadar's git_leaks collector. The full key is fetched on demand and
 * copied straight to the clipboard — never rendered or stored client-side.
 */
export function FoundKeysSection() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FoundKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getFoundKeys({ limit: 50 });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && items.length === 0 && !loading) void load();
  }, [open, items.length, loading, load]);

  const handleCopy = async (k: FoundKey) => {
    setBusyId(k.id);
    setError(null);
    try {
      const { key } = await getFoundKeySecret(k.id);
      await navigator.clipboard.writeText(key);
      setCopiedId(k.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="px-4 pt-3">
      <GlassCard className="p-3">
        <button
          type="button"
          className="w-full flex items-center gap-2"
          onClick={() => setOpen(o => !o)}
        >
          <KeyRound size={15} className="text-amber-400/80 shrink-0" />
          <span className="text-xs font-medium text-slate-200">
            {t('foundKeys.title')}
          </span>
          <span className="text-2xs text-slate-500 truncate">
            {t('foundKeys.subtitle')}
          </span>
          <span className="ml-auto text-slate-400">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>

        {open && (
          loading ? (
            <div className="flex justify-center py-4">
              <LoadingSpinner size="sm" />
            </div>
          ) : error ? (
            <p className="text-2xs text-amber-400/80 pt-2">
              {error.includes('not configured')
                ? t('foundKeys.notConfigured')
                : `${t('foundKeys.error')}: ${error}`}
            </p>
          ) : items.length === 0 ? (
            <p className="text-2xs text-slate-500 pt-2">{t('foundKeys.empty')}</p>
          ) : (
            <table className="w-full pt-2">
              <thead>
                <tr className="text-left text-2xs text-slate-500">
                  <th className="pb-1 pr-2 font-normal">{t('foundKeys.provider')}</th>
                  <th className="pb-1 pr-2 font-normal">key</th>
                  <th className="pb-1 pr-2 font-normal">{t('foundKeys.status')}</th>
                  <th className="pb-1 pr-2 font-normal">{t('foundKeys.source')}</th>
                  <th className="pb-1 pr-2 font-normal">{t('foundKeys.firstSeen')}</th>
                  <th className="pb-1" />
                </tr>
              </thead>
              <tbody>
                {items.map(k => (
                  <tr key={k.id} className="border-t border-white/[0.04]">
                    <td className="py-1.5 pr-2 text-2xs text-slate-300">{k.provider}</td>
                    <td className="py-1.5 pr-2 font-mono text-2xs text-slate-400">
                      {k.key_masked}
                    </td>
                    <td className="py-1.5 pr-2 text-2xs text-slate-500">{k.status}</td>
                    <td className="py-1.5 pr-2 text-2xs text-slate-500">
                      {k.source_platform ?? '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-2xs text-slate-500">
                      {(k.first_seen_at || '').slice(0, 10)}
                    </td>
                    <td className="py-1.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === k.id}
                        onClick={() => void handleCopy(k)}
                      >
                        {copiedId === k.id ? <Check size={12} /> : <Copy size={12} />}
                        <span className="ml-1">
                          {copiedId === k.id ? t('foundKeys.copied') : t('foundKeys.copy')}
                        </span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </GlassCard>
    </div>
  );
}
