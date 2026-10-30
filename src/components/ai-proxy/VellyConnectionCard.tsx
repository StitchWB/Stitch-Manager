import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button, GlassCard, Input } from '@/components/ui';
import { API_BASE_URL } from '@/lib/backend/core/invoke';
import { isDesktopApp } from '@/lib/backend/core/url';
import { getAvailableModelsSafe, getLocalChatToken } from '@/lib/backend/modules/aiProxy';
import { useAppStore } from '@/stores/app';

export function VellyConnectionCard() {
  const isRu = useAppStore(state => state.language) === 'ru';
  const [count, setCount] = useState(0);
  const [copying, setCopying] = useState(false);
  const desktop = isDesktopApp();
  const baseUrl = new URL(`${API_BASE_URL}/v1`, window.location.origin).href;

  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const rows = await getAvailableModelsSafe();
        if (!disposed) setCount(rows.filter(row => row.provider === 'velly').length);
      } catch {
        if (!disposed) setCount(0);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [desktop]);

  const copy = async (key: boolean) => {
    setCopying(true);
    try {
      await navigator.clipboard.writeText(key ? await getLocalChatToken() : baseUrl);
      toast.success(isRu ? 'Скопировано' : 'Copied');
    } catch {
      toast.error(isRu ? 'Не удалось скопировать данные Gateway' : 'Could not copy Gateway connection');
    } finally {
      setCopying(false);
    }
  };

  if (!desktop || !count) return null;

  return (
    <GlassCard className="mx-auto w-full max-w-[1200px] space-y-3 p-4">
      <h2 className="text-sm font-semibold text-white">Velly → AI Gateway</h2>
      <p className="text-xs text-slate-400">
        {isRu
          ? `В каталоге ${count} моделей. Путь: клиент → Gateway → Velly. Используйте ID velly/…; поддерживаются Chat Completions, Messages и Responses. Мост Velly должен быть запущен.`
          : `${count} catalog models. Route: client → Gateway → Velly. Use velly/… model IDs; Chat Completions, Messages and Responses are supported. The Velly bridge must be running.`}
      </p>
      <Input label="Velly Gateway URL" value={baseUrl} readOnly className="font-mono text-xs" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={copying} onClick={() => { void copy(false); }}>
          {isRu ? 'Копировать URL Gateway' : 'Copy Gateway URL'}
        </Button>
        <Button size="sm" variant="secondary" disabled={copying} onClick={() => { void copy(true); }}>
          {isRu ? 'Копировать ключ Gateway' : 'Copy Gateway key'}
        </Button>
        <Link to="/ai/routing?tab=models" className="text-xs text-indigo-300">
          {isRu ? 'Модели и маршруты Velly' : 'Velly models and routes'}
        </Link>
      </div>
    </GlassCard>
  );
}
