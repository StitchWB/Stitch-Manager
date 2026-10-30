import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, Copy, Download, KeyRound, Play, Plug, RefreshCw, Search, Shield, Square } from 'lucide-react';
import { Button, ButtonBase, Input } from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { useChatStore } from '@/stores/chat';

interface Model {
  id: string; name: string; context: number; status: string; historicallyVerified: boolean; error?: string;
}
interface Snapshot { running: boolean; rows: Model[]; baseURL?: string; catalogError?: string; refreshedAt?: string }
interface Connection {
  profile: string; node: string; port: number; opencodePath: string; exportsDirectory: string;
  accessTokenPresent: boolean; deviceKeyPresent: boolean;
}
type Tab = 'models' | 'connection' | 'tokens';
const invoke = <T,>(command: string, params: Record<string, unknown> = {}) => safeInvoke<T>(`plugin.stitch-velly.${command}`, params);

export default function VellyPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('models');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [connection, setConnection] = useState<Connection>();
  const [query, setQuery] = useState('');
  const [allModels, setAllModels] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [exportPath, setExportPath] = useState('');
  const [form, setForm] = useState({ profile: '', node: '', path: '' });
  const initialized = useRef(false);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [state, config] = await Promise.all([invoke<Snapshot>('get_status'), invoke<Connection>('get_connection')]);
      if (!mounted.current) return;
      setSnapshot(state); setConnection(config);
      setLoadError('');
      if (!initialized.current) {
        initialized.current = true;
        setForm({ profile: config.profile, node: config.node, path: config.opencodePath });
      }
    } catch (e) {
      if (mounted.current) setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить Velly');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refresh]);

  const run = async (command: string, params: Record<string, unknown> = {}) => {
    setBusy(command); setError(''); setNotice(''); setExportPath('');
    try {
      const result = await invoke<{ path?: string; accepted?: boolean }>(command, params);
      if (result.path) setExportPath(result.path);
      else setNotice(result.accepted ? 'Задача запущена' : 'Готово');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие'); }
    finally { setBusy(''); }
  };

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice('Скопировано'); }
    catch { setError('Не удалось скопировать'); }
  };
  const probe = async (model: Model) => {
    if (!await askConfirm({ title: 'Проверить модель', message: `${model.name}: один запрос к модели потратит квоту.`, confirmText: 'Проверить', cancelText: 'Отмена' })) return;
    await run('probe_model', { model: model.id });
  };
  const models = (snapshot?.rows || []).filter(model => (allModels || model.historicallyVerified)
    && `${model.name} ${model.id}`.toLowerCase().includes(query.toLowerCase()));
  const tabs: [Tab, string][] = [['models', 'Модели'], ['connection', 'Подключение'], ['tokens', 'Токены']];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-void-base">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300"><Plug size={18} /></span>
          <div><h1 className="text-base font-semibold text-white">Velly</h1><span className="flex items-center gap-1.5 text-xs text-slate-400"><span className={`h-1.5 w-1.5 rounded-full ${snapshot?.running ? 'bg-emerald-400' : 'bg-slate-500'}`} />{snapshot ? snapshot.running ? 'Подключено' : 'Мост остановлен' : 'Подключение…'}</span></div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!!busy} leftIcon={<RefreshCw size={14} />} onClick={() => { void run('refresh_catalog'); }}>Обновить</Button>
          <Button variant={snapshot?.running ? 'secondary' : 'primary'} size="sm" disabled={!!busy || !snapshot} leftIcon={snapshot?.running ? <Square size={12} /> : <Play size={13} />} onClick={() => { void run(snapshot?.running ? 'stop_bridge' : 'start_bridge', { profile: form.profile, node: form.node }); }}>{snapshot?.running ? 'Остановить' : 'Подключить'}</Button>
        </div>
      </header>
      <nav aria-label="Разделы Velly" className="flex shrink-0 gap-5 border-b border-white/[0.06] px-4">
        {tabs.map(([id, label]) => <ButtonBase key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setNotice(''); setExportPath(''); }} className={`border-b-2 py-3 text-xs font-medium transition-colors ${tab === id ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-slate-400 hover:text-white'}`}>{label}</ButtonBase>)}
      </nav>
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4">
          {(error || loadError || snapshot?.catalogError) && <div role="alert" className="break-words rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-300">{error || loadError || snapshot?.catalogError}</div>}
          {notice && <div role="status" className="text-xs text-emerald-300">{notice}</div>}
          {exportPath && <div role="status" className="space-y-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 p-3"><p className="text-xs text-emerald-300">Файл сохранён</p><code className="block break-all text-xs text-slate-300">{exportPath}</code><Button size="xs" variant="ghost" onClick={() => { void copy(exportPath); }}>Копировать путь</Button></div>}
          {tab === 'models' && <>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="Поиск моделей" placeholder="Найти модель" value={query} onChange={e => setQuery(e.target.value)} leftIcon={<Search size={14} />} containerClassName="min-w-0 flex-1" />
              <Button variant={allModels ? 'secondary' : 'primary'} size="sm" onClick={() => setAllModels(false)}>Проверенные</Button>
              <Button variant={allModels ? 'primary' : 'secondary'} size="sm" onClick={() => setAllModels(true)}>Все {snapshot?.rows?.length || ''}</Button>
            </div>
            <div className="overflow-hidden rounded-xl border border-white/[0.07]">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-white/[0.06] bg-white/[0.025] px-3 py-2 text-[10px] text-slate-500"><span>Модель</span><span className="w-24 text-right">Контекст</span><span className="w-28 text-right">Действия</span></div>
              {models.map(model => <div key={model.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-b border-white/[0.04] px-3 py-2.5 last:border-0 hover:bg-white/[0.025]">
                <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-xs font-medium text-slate-200" title={model.id}>{model.name}</span>{model.historicallyVerified && <Check size={12} className="shrink-0 text-emerald-400" aria-label="Инструменты проверены ранее" />}</div>{model.error && <p className="mt-1 truncate text-[11px] text-red-300" title={model.error}>{model.error}</p>}</div>
                <span className="w-24 text-right text-[11px] tabular-nums text-slate-400">{model.context?.toLocaleString('ru-RU') || '—'}</span>
                <div className="flex w-28 justify-end gap-1">
                  <Button variant="ghost" size="icon" title="Копировать ID" aria-label={`Копировать ID ${model.name}`} onClick={() => { void copy(model.id); }}><Copy size={13} /></Button>
                  <Button variant="ghost" size="icon" title="Открыть в чате" aria-label={`В чат: ${model.name}`} onClick={() => { useChatStore.getState().setSessionModel(`velly/${model.id}`); navigate('/ai/chat'); }}><ArrowUpRight size={15} /></Button>
                  {!model.historicallyVerified && <Button variant="ghost" size="icon" disabled={!!busy} title="Проверить (расходует квоту)" aria-label={`Проверить ${model.name}`} onClick={() => { void probe(model); }}><Play size={12} /></Button>}
                </div>
              </div>)}
              {!models.length && <p className="p-6 text-center text-xs text-slate-500">{snapshot ? query ? 'Модели не найдены' : 'Каталог пока пуст' : 'Загрузка моделей…'}</p>}
            </div>
          </>}
          {tab === 'connection' && <div className="space-y-5">
            <section className="space-y-3 rounded-xl border border-white/[0.07] p-4"><h2 className="text-sm font-medium text-white">Подключить OpenCode</h2><Input label="Конфигурация" value={form.path} onChange={e => setForm({ ...form, path: e.target.value })} /><div className="flex flex-wrap gap-2"><Button size="sm" disabled={!!busy || !snapshot?.running} onClick={() => { void run('export_opencode', { path: form.path }); }}>Применить настройки</Button><Button size="sm" variant="secondary" disabled={!!busy || !snapshot?.running} onClick={() => { void run('export_gateway_config'); }}>Экспорт Gateway</Button></div></section>
            <section className="space-y-3 rounded-xl border border-white/[0.07] p-4"><h2 className="text-sm font-medium text-white">Параметры моста</h2><Input label="Профиль Velly" value={form.profile} onChange={e => setForm({ ...form, profile: e.target.value })} /><Input label="Node.js" value={form.node} onChange={e => setForm({ ...form, node: e.target.value })} /><p className="text-[11px] text-slate-500">Изменения применяются при следующем подключении моста.</p></section>
          </div>}
          {tab === 'tokens' && <div className="space-y-3">
            <section className="rounded-xl border border-white/[0.07] p-4"><div className="flex items-start gap-3"><KeyRound size={19} className="mt-0.5 shrink-0 text-indigo-300" /><div className="min-w-0 flex-1"><h2 className="text-sm font-medium text-white">Токен API</h2><p className="mt-1 text-xs text-slate-400">Для запросов к моделям. Читается из auth.bin.</p><p className="mt-2 text-[11px] text-slate-500">{connection?.accessTokenPresent ? 'Найден в профиле Velly' : 'Не найден в профиле Velly'}</p><Button className="mt-3" size="sm" disabled={!!busy || !connection?.accessTokenPresent} leftIcon={<Download size={13} />} onClick={() => { void run('export_secrets', { includeDeviceKey: false }); }}>Сохранить токен в файл</Button></div></div></section>
            <section className="rounded-xl border border-white/[0.07] p-4"><div className="flex items-start gap-3"><Shield size={19} className="mt-0.5 shrink-0 text-slate-400" /><div><h2 className="text-sm font-medium text-white">Ключ устройства</h2><p className="mt-1 text-xs text-slate-400">Привязка компьютера. Для запросов моделей не нужен.</p><p className="mt-2 text-[11px] text-slate-500">{connection?.deviceKeyPresent ? 'Найден в secret-device-key.bin' : 'Не найден в профиле Velly'}</p></div></div></section>
          </div>}
        </div>
      </main>
    </div>
  );
}
