import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, Upload, Save, AlertCircle, CheckCircle2, Globe, Eye, EyeOff } from 'lucide-react';

import { SectionHeader, Button, Input, Select, Textarea, Toggle } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  createOrGetProxyLibraryEntry,
  deleteProxyLibraryEntry,
  getProxyLibraryUsage,
  importProxyLibraryBulk,
  listProxyLibrary,
  parseProxyLibraryInput,
  previewProxyLibraryBulk,
  ProxyLibraryError,
  testProxyLibraryDraft,
  updateProxyLibraryEntry,
  type ProxyLibraryDraft,
  type ProxyLibraryEntry,
  type ProxyLibraryImportResult,
  type ProxyLibraryType,
} from '@/lib/tauri/modules/proxyLibrary';

const defaultDraft: ProxyLibraryDraft = {
  label: '',
  host: '',
  port: 8080,
  username: '',
  password: '',
  proxyType: 'http',
  enabled: true,
  notes: '',
};

function toDraft(entry: ProxyLibraryEntry): ProxyLibraryDraft {
  return {
    label: entry.label,
    host: entry.host,
    port: entry.port,
    username: entry.username ?? '',
    password: entry.password ?? '',
    proxyType: entry.proxyType,
    enabled: entry.enabled,
    notes: entry.notes ?? '',
  };
}

function normalizeDraft(draft: ProxyLibraryDraft): ProxyLibraryDraft {
  return {
    ...draft,
    label: draft.label?.trim() || null,
    host: draft.host.trim(),
    username: draft.username?.trim() || null,
    password: draft.password?.trim() || null,
    notes: draft.notes?.trim() || null,
    port: Number(draft.port),
  };
}

export function ProxyLibrarySection() {
  const [items, setItems] = useState<ProxyLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createDraft, setCreateDraft] = useState<ProxyLibraryDraft>(defaultDraft);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProxyLibraryDraft>(defaultDraft);
  const [savingEdit, setSavingEdit] = useState(false);

  const [bulkText, setBulkText] = useState('');
  const [bulkType, setBulkType] = useState<ProxyLibraryType>('http');
  const [bulkEnabled, setBulkEnabled] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<ProxyLibraryImportResult | null>(null);

  const [showSecrets, setShowSecrets] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [quickInput, setQuickInput] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testingEntryId, setTestingEntryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listProxyLibrary();
      setItems(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('proxyLibrary.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const startEdit = (entry: ProxyLibraryEntry) => {
    setEditingId(entry.id);
    setEditDraft(toDraft(entry));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(defaultDraft);
  };

  const handleQuickParse = async () => {
    const raw = quickInput.trim();
    if (!raw) return;
    setQuickBusy(true);
    setError(null);
    try {
      const parsed = await parseProxyLibraryInput({ raw, defaultType: createDraft.proxyType });
      setCreateDraft(prev => ({
        ...prev,
        host: parsed.host || prev.host,
        port: parsed.port || prev.port,
        proxyType: parsed.proxyType || prev.proxyType,
        username: parsed.username ?? null,
        password: parsed.password ?? null,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('proxyLibrary.parseError'));
    } finally {
      setQuickBusy(false);
    }
  };

  const handleCreateOrGet = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await createOrGetProxyLibraryEntry(normalizeDraft(createDraft));
      setItems(prev => {
        if (prev.some(it => it.id === created.id)) return prev;
        return [...prev, created];
      });
      setCreateDraft(defaultDraft);
      setQuickInput('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('proxyLibrary.createError'));
    } finally {
      setCreating(false);
    }
  };

  const handleTestCreateDraft = async () => {
    setTestBusy(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await testProxyLibraryDraft(normalizeDraft(createDraft));
      if (result.entry) {
        setItems(prev => prev.map(it => (it.id === result.entry?.id ? result.entry : it)));
      }
      if (result.success) {
        setTestResult(
          `OK${result.responseTimeMs != null ? ` • ${result.responseTimeMs}ms` : ''}${
            result.ip ? ` • ${result.ip}` : ''
          }${result.location ? ` • ${result.location}` : ''}`
        );
      } else {
        setTestResult(`FAIL${result.error ? ` • ${result.error}` : ''}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('proxyLibrary.testError'));
    } finally {
      setTestBusy(false);
    }
  };

  const handleTestEntry = async (entry: ProxyLibraryEntry) => {
    setTestingEntryId(entry.id);
    setError(null);
    try {
      const result = await testProxyLibraryDraft(normalizeDraft(toDraft(entry)), {
        proxyLibraryId: entry.id,
        persistResult: true,
      });
      if (result.entry) {
        setItems(prev => prev.map(it => (it.id === result.entry?.id ? result.entry : it)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('proxyLibrary.testError'));
    } finally {
      setTestingEntryId(null);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    setSavingEdit(true);
    setError(null);
    try {
      const updated = await updateProxyLibraryEntry({
        id: editingId,
        draft: normalizeDraft(editDraft),
      });
      setItems(prev => prev.map(it => (it.id === updated.id ? updated : it)));
      cancelEdit();
    } catch (e) {
      if (e instanceof ProxyLibraryError && e.code === 'proxy_in_use' && editingId) {
        const usage = await getProxyLibraryUsage(editingId).catch(() => null);
        if (usage) {
          const forceDisable = window.confirm(
            `${e.message}\n\n${t('proxyLibrary.referencesProfiles')}:\n${usage.profileAliases.join('\n') || '-'}\n\n${t('proxyLibrary.referencesScenarios')}:\n${usage.scenarioPaths.join('\n') || '-'}\n\n${t('proxyLibrary.forceDeleteConfirm')}`
          );
          if (forceDisable) {
            try {
              const updated = await updateProxyLibraryEntry({
                id: editingId,
                draft: normalizeDraft(editDraft),
                options: { force: true },
              });
              setItems(prev => prev.map(it => (it.id === updated.id ? updated : it)));
              cancelEdit();
              return;
            } catch (forceErr) {
              setError(
                forceErr instanceof Error ? forceErr.message : t('proxyLibrary.updateError')
              );
              return;
            }
          }
          setError(
            `${e.message}\n${t('proxyLibrary.referencesProfiles')}: ${usage.profileAliases.join(', ') || '-'}\n${t('proxyLibrary.referencesScenarios')}: ${usage.scenarioPaths.length}`
          );
          return;
        }
      }
      setError(e instanceof Error ? e.message : t('proxyLibrary.updateError'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: string, force = false) => {
    setError(null);
    try {
      const res = await deleteProxyLibraryEntry({ id, options: { force } });
      if (res.changed) {
        setItems(prev => prev.filter(it => it.id !== id));
      }
    } catch (e) {
      if (e instanceof ProxyLibraryError && e.code === 'proxy_in_use') {
        const usage = await getProxyLibraryUsage(id).catch(() => null);
        if (usage) {
          const forceDelete = window.confirm(
            `${e.message}\n\n${t('proxyLibrary.referencesProfiles')}:\n${usage.profileAliases.join('\n') || '-'}\n\n${t('proxyLibrary.referencesScenarios')}:\n${
              usage.scenarioPaths.join('\n') || '-'
            }\n\n${t('proxyLibrary.forceDeleteConfirm')}`
          );
          if (forceDelete) {
            await handleDelete(id, true);
          }
          return;
        }
      }
      setError(e instanceof Error ? e.message : t('proxyLibrary.deleteError'));
    }
  };

  const handleBatchToggle = async (enabled: boolean) => {
    if (selectedIds.length === 0) return;
    setError(null);
    for (const id of selectedIds) {
      const item = items.find(it => it.id === id);
      if (!item) continue;
      try {
        await updateProxyLibraryEntry({
          id,
          draft: normalizeDraft({
            label: item.label,
            host: item.host,
            port: item.port,
            username: item.username ?? null,
            password: item.password ?? null,
            proxyType: item.proxyType,
            enabled,
            notes: item.notes ?? null,
          }),
          options: { force: true },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : t('proxyLibrary.updateError'));
      }
    }
    await load();
    setSelectedIds([]);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    const confirmDelete = window.confirm(
      t('proxyLibrary.forceDeletePrompt', { count: selectedIds.length })
    );
    if (!confirmDelete) return;

    for (const id of selectedIds) {
      await handleDelete(id, true);
    }
    await load();
    setSelectedIds([]);
  };

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return;
    setBulkLoading(true);
    setError(null);
    setBulkResult(null);
    try {
      const result = await importProxyLibraryBulk({
        text: bulkText,
        defaultType: bulkType,
        defaultEnabled: bulkEnabled,
      });
      setBulkResult(result);
      setItems(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('proxyLibrary.importError'));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkPreview = async () => {
    if (!bulkText.trim()) return;
    setBulkLoading(true);
    setError(null);
    setBulkResult(null);
    try {
      const result = await previewProxyLibraryBulk({
        text: bulkText,
        defaultType: bulkType,
        defaultEnabled: bulkEnabled,
      });
      setBulkResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('proxyLibrary.importError'));
    } finally {
      setBulkLoading(false);
    }
  };

  const renderDraftForm = (
    draft: ProxyLibraryDraft,
    setDraft: (value: ProxyLibraryDraft) => void,
    submitLabel: string,
    onSubmit: () => void,
    submitBusy: boolean,
    onCancel?: () => void
  ) => {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('proxyLibrary.label')}
            value={draft.label ?? ''}
            onChange={e => setDraft({ ...draft, label: e.target.value })}
            placeholder="US-East #1"
          />
          <Select
            label={t('proxyLibrary.type')}
            value={draft.proxyType}
            onValueChange={value => setDraft({ ...draft, proxyType: value as ProxyLibraryType })}
          >
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </Select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('proxyLibrary.host')}
            value={draft.host}
            onChange={e => setDraft({ ...draft, host: e.target.value })}
            placeholder="138.249.63.52"
          />
          <Input
            label={t('proxyLibrary.port')}
            type="number"
            value={String(draft.port)}
            onChange={e =>
              setDraft({
                ...draft,
                port: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0,
              })
            }
            placeholder="63942"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('proxyLibrary.username')}
            value={draft.username ?? ''}
            onChange={e => setDraft({ ...draft, username: e.target.value })}
            placeholder="NcyVVTzb"
          />
          <Input
            label={t('proxyLibrary.password')}
            type={showSecrets ? 'text' : 'password'}
            value={draft.password ?? ''}
            onChange={e => setDraft({ ...draft, password: e.target.value })}
            placeholder="fqQDvDLA"
          />
        </div>

        <Textarea
          label={t('proxyLibrary.notes')}
          value={draft.notes ?? ''}
          onChange={e => setDraft({ ...draft, notes: e.target.value })}
          className="min-h-[70px]"
        />

        <div className="flex items-center justify-between gap-3">
          <Toggle
            label={t('proxyLibrary.enabled')}
            checked={Boolean(draft.enabled)}
            onChange={checked => setDraft({ ...draft, enabled: checked })}
          />

          <div className="flex gap-2">
            {onCancel ? (
              <Button variant="secondary" onClick={onCancel}>
                {t('proxyLibrary.cancel')}
              </Button>
            ) : null}
            <Button onClick={onSubmit} disabled={submitBusy}>
              {submitBusy ? t('proxyLibrary.saving') : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <SectionHeader
      title={t('proxyLibrary.title')}
      description={t('proxyLibrary.description')}
      icon={<Globe className="w-4 h-4 text-primary" />}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <div className="text-sm font-medium text-slate-200 mb-3">
            {t('proxyLibrary.quickAddTitle')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 mb-3">
            <Input
              label={t('proxyLibrary.quickInputLabel')}
              value={quickInput}
              onChange={e => setQuickInput(e.target.value)}
              placeholder={t('proxyLibrary.quickInputPlaceholder')}
            />
            <div className="flex items-end">
              <Button
                onClick={() => void handleQuickParse()}
                disabled={quickBusy || !quickInput.trim()}
              >
                {t('proxyLibrary.quickParse')}
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-sm font-medium text-slate-200">{t('proxyLibrary.importBulk')}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowSecrets(v => !v)}
                className="h-8 px-2"
                title={
                  showSecrets ? t('proxyLibrary.hidePasswords') : t('proxyLibrary.showPasswords')
                }
              >
                {showSecrets ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
          </div>

          <Textarea
            label={t('proxyLibrary.pasteProxies')}
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
            placeholder={'138.249.63.52:63942:NcyVVTzb:fqQDvDLA\n1.2.3.4:8080'}
            className="min-h-[100px]"
          />

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Select
              label={t('proxyLibrary.defaultType')}
              value={bulkType}
              onValueChange={value => setBulkType(value as ProxyLibraryType)}
            >
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </Select>

            <div className="flex items-end">
              <Toggle
                label={t('proxyLibrary.importedEnabled')}
                checked={bulkEnabled}
                onChange={setBulkEnabled}
              />
            </div>

            <div className="flex items-end justify-end">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void handleBulkPreview()}
                  disabled={bulkLoading || !bulkText.trim()}
                >
                  {t('proxyLibrary.bulkPreview')}
                </Button>
                <Button
                  onClick={() => void handleBulkImport()}
                  disabled={bulkLoading || !bulkText.trim()}
                >
                  <Upload className="w-4 h-4 mr-1" />
                  {bulkLoading ? t('proxyLibrary.importing') : t('proxyLibrary.import')}
                </Button>
              </div>
            </div>
          </div>

          {bulkResult ? (
            <div className="mt-3 text-xs text-slate-300">
              {t('proxyLibrary.importedStat')}: {bulkResult.imported} •{' '}
              {t('proxyLibrary.skippedStat')}: {bulkResult.skipped} •{' '}
              {t('proxyLibrary.totalLinesStat')}:{bulkResult.totalLines}
              {bulkResult.issues.length > 0 ? (
                <div className="mt-2 space-y-1 text-amber-200">
                  {bulkResult.issues.slice(0, 5).map(issue => (
                    <div key={`${issue.lineNo}-${issue.reason}`}>
                      line {issue.lineNo}: {issue.reason} ({issue.linePreview})
                    </div>
                  ))}
                  {bulkResult.issues.length > 5 ? (
                    <div>
                      {t('proxyLibrary.andMore')}: {bulkResult.issues.length - 5}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {renderDraftForm(
          createDraft,
          setCreateDraft,
          t('proxyLibrary.addOrLinkProxy'),
          () => void handleCreateOrGet(),
          creating
        )}
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => void handleTestCreateDraft()}
            disabled={testBusy}
          >
            {testBusy ? t('proxyLibrary.testingDraft') : t('proxyLibrary.testDraft')}
          </Button>
          {testResult ? <div className="text-xs text-slate-300">{testResult}</div> : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
          <div className="text-sm font-medium text-slate-200 mb-3">{t('proxyLibrary.entries')}</div>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="secondary"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchToggle(true)}
            >
              {t('proxyLibrary.batchEnable')}
            </Button>
            <Button
              size="xs"
              variant="secondary"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchToggle(false)}
            >
              {t('proxyLibrary.batchDisable')}
            </Button>
            <Button
              size="xs"
              variant="danger"
              disabled={selectedIds.length === 0}
              onClick={() => void handleBatchDelete()}
            >
              {t('proxyLibrary.batchDelete')}
            </Button>
          </div>
          {loading ? (
            <div className="text-sm text-slate-400">{t('proxyLibrary.loading')}</div>
          ) : null}
          {!loading && sortedItems.length === 0 ? (
            <div className="text-sm text-slate-500">{t('proxyLibrary.noEntries')}</div>
          ) : null}

          <div className="space-y-3">
            {sortedItems.map(entry => {
              const isEditing = editingId === entry.id;
              return (
                <div key={entry.id} className="rounded-lg border border-white/10 p-3">
                  {!isEditing ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="mb-1">
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(entry.id)}
                              onChange={e => {
                                setSelectedIds(prev =>
                                  e.target.checked
                                    ? [...prev, entry.id]
                                    : prev.filter(id => id !== entry.id)
                                );
                              }}
                            />
                          </div>
                          <div className="text-sm text-slate-100 font-medium">{entry.label}</div>
                          <div className="text-xs text-slate-400 mt-1">
                            {entry.proxyType}://{entry.host}:{entry.port}
                            {entry.username ? `:${showSecrets ? entry.username : '***'}` : ''}
                            {entry.password ? `:${showSecrets ? entry.password : '***'}` : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-1">
                            {entry.lastTestOk === true
                              ? `${t('proxyLibrary.testStatusOk')}${entry.lastTestLatencyMs != null ? ` • ${entry.lastTestLatencyMs}ms` : ''}${
                                  entry.lastTestAt ? ` • ${entry.lastTestAt}` : ''
                                }`
                              : entry.lastTestOk === false
                                ? `${t('proxyLibrary.testStatusFail')}${entry.lastTestError ? ` • ${entry.lastTestError}` : ''}${
                                    entry.lastTestAt ? ` • ${entry.lastTestAt}` : ''
                                  }`
                                : t('proxyLibrary.testStatusNone')}
                          </div>
                          {entry.notes ? (
                            <div className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">
                              {entry.notes}
                            </div>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                          <div
                            className={`text-[11px] px-2 py-1 rounded border ${
                              entry.enabled
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                                : 'border-slate-500/20 bg-slate-500/10 text-slate-300'
                            }`}
                          >
                            {entry.enabled
                              ? t('proxyLibrary.statusEnabled')
                              : t('proxyLibrary.statusDisabled')}
                          </div>
                          <Button
                            variant="secondary"
                            className="h-8 px-2"
                            onClick={() => void handleTestEntry(entry)}
                            disabled={testingEntryId === entry.id}
                          >
                            {testingEntryId === entry.id
                              ? t('proxyLibrary.testingEntry')
                              : t('proxyLibrary.testEntry')}
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-8 px-2"
                            onClick={() => startEdit(entry)}
                          >
                            <Save className="w-4 h-4" />
                            {t('proxyLibrary.edit')}
                          </Button>
                          <Button
                            variant="danger"
                            className="h-8 px-2"
                            onClick={() => void handleDelete(entry.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    renderDraftForm(
                      editDraft,
                      setEditDraft,
                      t('proxyLibrary.save'),
                      () => void handleUpdate(),
                      savingEdit,
                      cancelEdit
                    )
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        ) : items.length > 0 ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {t('proxyLibrary.ready')}
          </div>
        ) : null}
      </div>
    </SectionHeader>
  );
}
