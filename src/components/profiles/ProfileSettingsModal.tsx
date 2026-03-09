import { useEffect, useMemo, useState } from 'react';
import {
  X,
  Globe,
  MapPin,
  Cookie,
  Link2,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderOpen,
  Upload,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, Input, Select, Textarea, Toggle, TabButton } from '../ui';
import { t } from '../../lib/i18n';
import {
  getProfileSettings,
  type ProfileSettingsProxy,
  saveProfileSettings,
  type ProfileSettingsV1,
} from '@/lib/tauri/modules/profiles';
import { copyToClipboard, openInFileManager } from '@/lib/tauri/modules/utils';
import {
  listProxyLibrary,
  migrateManualProxyToLibrary,
  type ProxyLibraryEntry,
} from '@/lib/tauri/modules/proxyLibrary';
import { toast } from 'sonner';
import { formatProfileAlias } from '@/lib/profiles/displayName';

interface ProfileSettingsModalProps {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

type SettingsTab = 'main' | 'proxy' | 'geo' | 'data';

const defaultSettings: ProfileSettingsV1 = {
  version: 1,
  network: {
    proxy: {
      enabled: false,
      proxyLibraryId: null,
      url: null,
      username: null,
      password: null,
    },
  },
  geo: {
    timezone: null,
    locale: null,
    latitude: null,
    longitude: null,
  },
  hardware: {
    userAgent: null,
    platform: null,
    hardwareConcurrency: null,
    deviceMemory: null,
    screenWidth: null,
    screenHeight: null,
  },
  storage: {
    cookies: null,
    notes: null,
    lastUrl: null,
    lastScenarioPath: null,
  },
};

function mergeSettings(record: ProfileSettingsV1): ProfileSettingsV1 {
  const proxy = {
    enabled: Boolean(record.network?.proxy?.enabled),
    proxyLibraryId: record.network?.proxy?.proxyLibraryId ?? null,
    url: record.network?.proxy?.url ?? null,
    username: record.network?.proxy?.username ?? null,
    password: record.network?.proxy?.password ?? null,
  };

  return {
    ...defaultSettings,
    ...record,
    network: {
      ...defaultSettings.network,
      ...(record.network ?? {}),
      proxy,
    },
    geo: {
      ...defaultSettings.geo,
      ...(record.geo ?? {}),
    },
    hardware: {
      ...defaultSettings.hardware,
      ...(record.hardware ?? {}),
    },
    storage: {
      ...defaultSettings.storage,
      ...(record.storage ?? {}),
    },
  };
}

export function ProfileSettingsModal({
  alias,
  isOpen,
  onClose,
  onSaved,
}: ProfileSettingsModalProps) {
  const displayAlias = formatProfileAlias(alias);
  const [draft, setDraft] = useState<ProfileSettingsV1>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('main');
  const [showCookieEditor, setShowCookieEditor] = useState(false);
  const [proxyLibrary, setProxyLibrary] = useState<ProxyLibraryEntry[]>([]);
  const [proxyLibraryLoading, setProxyLibraryLoading] = useState(false);

  const proxyEnabled = Boolean(draft.network.proxy?.enabled);
  const proxyLibraryId = draft.network.proxy?.proxyLibraryId?.trim() || '';
  const proxyMode: 'none' | 'library' | 'manual' = !proxyEnabled
    ? 'none'
    : proxyLibraryId
      ? 'library'
      : 'manual';
  const selectedLibraryProxy = proxyLibrary.find(item => item.id === proxyLibraryId) ?? null;
  const hasManualGeo =
    typeof draft.geo.latitude === 'number' && typeof draft.geo.longitude === 'number';

  const summary = useMemo(() => {
    const proxyState = proxyEnabled ? 'Enabled' : 'Disabled';
    const cookiesRaw = draft.storage.cookies?.trim() ?? '';
    const cookiesHint = cookiesRaw
      ? cookiesRaw.startsWith('[') || cookiesRaw.startsWith('{')
        ? 'JSON configured'
        : 'File path configured'
      : 'Not configured';

    return {
      proxyState,
      locale: draft.geo.locale?.trim() || 'Auto',
      timezone: draft.geo.timezone?.trim() || 'Auto',
      cookiesHint,
    };
  }, [draft.geo.locale, draft.geo.timezone, draft.storage.cookies, proxyEnabled]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadProxyLibrary = async () => {
      setProxyLibraryLoading(true);
      try {
        const items = await listProxyLibrary();
        if (!cancelled) {
          setProxyLibrary(items.filter(item => item.enabled));
        }
      } catch {
        if (!cancelled) {
          setProxyLibrary([]);
        }
      } finally {
        if (!cancelled) setProxyLibraryLoading(false);
      }
    };

    void loadProxyLibrary();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        onClose();
      }
    };

    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen, onClose, saving]);

  useEffect(() => {
    if (!isOpen || !alias) return;

    setLoading(true);
    setError(null);
    setDirty(false);
    setActiveTab('main');
    setShowAdvanced(false);
    setShowCookieEditor(false);

    const load = async () => {
      try {
        const existing = await getProfileSettings({ alias });
        if (existing?.settings) {
          setDraft(mergeSettings(existing.settings));
        } else {
          setDraft(defaultSettings);
        }
      } catch (e) {
        console.error('[ProfileSettingsModal] Failed to load settings:', e);
        setError(t('common.error') || 'Failed to load profile settings');
        setDraft(defaultSettings);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [alias, isOpen]);

  const update = (next: ProfileSettingsV1) => {
    setDraft(next);
    setDirty(true);
  };

  const patchProxy = (patch: Partial<ProfileSettingsProxy>) => {
    const currentProxy = {
      enabled: Boolean(draft.network.proxy?.enabled),
      proxyLibraryId: draft.network.proxy?.proxyLibraryId ?? null,
      url: draft.network.proxy?.url ?? null,
      username: draft.network.proxy?.username ?? null,
      password: draft.network.proxy?.password ?? null,
    };

    update({
      ...draft,
      network: {
        ...draft.network,
        proxy: {
          ...currentProxy,
          ...patch,
        },
      },
    });
  };

  const handleMigrateManualProxyToLibrary = async () => {
    const manualUrl = draft.network.proxy?.url?.trim();
    if (!manualUrl) {
      toast.error('Manual proxy URL is empty');
      return;
    }

    try {
      const result = await migrateManualProxyToLibrary({
        proxyUrl: manualUrl,
        username: draft.network.proxy?.username ?? null,
        password: draft.network.proxy?.password ?? null,
        label: `${alias ?? 'profile'} proxy`,
      });

      if (!result.proxyLibraryId) {
        toast.error('Failed to migrate manual proxy');
        return;
      }

      const items = await listProxyLibrary();
      setProxyLibrary(items.filter(item => item.enabled));

      patchProxy({
        enabled: true,
        proxyLibraryId: result.proxyLibraryId,
        url: null,
        username: null,
        password: null,
      });

      toast.success(
        result.imported ? 'Proxy imported to library' : 'Linked existing library proxy'
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to migrate manual proxy');
    }
  };

  const handleSave = async () => {
    if (!alias || saving) return;
    setSaving(true);
    setError(null);

    try {
      const normalized = mergeSettings({
        ...draft,
        version: 1,
      });
      await saveProfileSettings({ alias, settings: normalized });
      setDirty(false);
      onSaved?.();
      onClose();
    } catch (e) {
      console.error('[ProfileSettingsModal] Failed to save settings:', e);
      setError(t('common.error') || 'Failed to save profile settings');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyPath = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label} is empty`);
      return;
    }

    try {
      await copyToClipboard({ text });
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  const handleOpenPath = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label} is empty`);
      return;
    }

    try {
      await openInFileManager({ path: text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to open ${label.toLowerCase()}`);
    }
  };

  const handlePickCookieFile = async () => {
    try {
      const selection = await open({
        multiple: false,
        filters: [{ name: 'Cookie files', extensions: ['json', 'txt'] }],
      });

      if (!selection) return;
      const selected = Array.isArray(selection) ? selection[0] : selection;
      if (!selected) return;

      const path = typeof selected === 'string' ? selected : selected.name;
      if (!path) return;

      update({
        ...draft,
        storage: {
          ...draft.storage,
          cookies: path,
        },
      });
    } catch {
      toast.error('Failed to pick cookie file');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close profile settings backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={() => !saving && onClose()}
      />

      <aside className="absolute right-0 top-0 h-full w-full max-w-[560px] border-l border-white/10 bg-[#0f1115] shadow-2xl flex flex-col">
        <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-400">{t('accounts.profileAlias') || 'Profile'}</div>
            <div className="text-base font-semibold text-slate-100 truncate">{displayAlias}</div>
            {alias && displayAlias !== alias ? (
              <div className="mt-0.5 text-[11px] text-slate-500 truncate font-mono">{alias}</div>
            ) : null}
            <div className="mt-1 text-xs text-slate-500">
              Proxy: {summary.proxyState} • Locale: {summary.locale} • Timezone: {summary.timezone}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 disabled:opacity-50"
            aria-label="Close profile settings"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-3 border-b border-white/10 flex flex-wrap gap-2">
          <TabButton
            active={activeTab === 'main'}
            onClick={() => setActiveTab('main')}
            label="Main"
            className="h-9 px-5"
          />
          <TabButton
            active={activeTab === 'proxy'}
            onClick={() => setActiveTab('proxy')}
            label="Proxy"
            className="h-9 px-5"
          />
          <TabButton
            active={activeTab === 'geo'}
            onClick={() => setActiveTab('geo')}
            label="Geo"
            className="h-9 px-5"
          />
          <TabButton
            active={activeTab === 'data'}
            onClick={() => setActiveTab('data')}
            label="Data"
            className="h-9 px-5"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading ? (
            <div className="text-sm text-slate-400">{t('common.loading') || 'Loading...'}</div>
          ) : null}
          {error ? (
            <div className="text-xs text-red-300 border border-red-500/20 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </div>
          ) : null}

          {!loading && activeTab === 'main' && (
            <section className="space-y-4">
              <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                <Link2 size={14} /> Defaults
              </div>

              <Input
                label="Last URL"
                value={draft.storage.lastUrl ?? ''}
                onChange={e =>
                  update({
                    ...draft,
                    storage: { ...draft.storage, lastUrl: e.target.value || null },
                  })
                }
                placeholder="https://google.com"
              />

              <Input
                label="Last scenario path"
                value={draft.storage.lastScenarioPath ?? ''}
                onChange={e =>
                  update({
                    ...draft,
                    storage: { ...draft.storage, lastScenarioPath: e.target.value || null },
                  })
                }
                placeholder="C:\\...\\scenario.json"
                rightElement={
                  <div className="flex items-center gap-2 pr-1 pl-2 border-l border-white/10">
                    <button
                      type="button"
                      className="p-2 rounded bg-white/[0.04] hover:bg-white/10 text-slate-300"
                      onClick={() =>
                        void handleCopyPath(draft.storage.lastScenarioPath, 'Scenario path')
                      }
                      title="Copy path"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      className="p-2 rounded bg-white/[0.04] hover:bg-white/10 text-slate-300"
                      onClick={() =>
                        void handleOpenPath(draft.storage.lastScenarioPath, 'Scenario path')
                      }
                      title="Open folder"
                    >
                      <FolderOpen size={14} />
                    </button>
                  </div>
                }
              />

              <Textarea
                label={t('accounts.notes') || 'Notes'}
                value={draft.storage.notes ?? ''}
                onChange={e =>
                  update({
                    ...draft,
                    storage: { ...draft.storage, notes: e.target.value || null },
                  })
                }
                className="h-24 min-h-[96px]"
              />
            </section>
          )}

          {!loading && activeTab === 'proxy' && (
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                  <Globe size={14} /> {t('autoReg.proxy') || 'Proxy'}
                </div>
                <Toggle
                  label={t('profileProxy.enabledToggle')}
                  checked={proxyEnabled}
                  onChange={checked => {
                    if (checked) {
                      patchProxy({ enabled: true });
                    } else {
                      patchProxy({
                        enabled: false,
                        proxyLibraryId: null,
                        url: null,
                        username: null,
                        password: null,
                      });
                    }
                  }}
                />
              </div>

              {proxyEnabled ? (
                <div className="space-y-3">
                  <Select
                    label={t('profileProxy.source')}
                    value={proxyMode}
                    onValueChange={value => {
                      if (value === 'none') {
                        patchProxy({
                          enabled: false,
                          proxyLibraryId: null,
                          url: null,
                          username: null,
                          password: null,
                        });
                        return;
                      }

                      if (value === 'library') {
                        const first = proxyLibrary[0];
                        patchProxy({
                          enabled: true,
                          proxyLibraryId: first?.id ?? null,
                          url: null,
                          username: null,
                          password: null,
                        });
                        return;
                      }

                      patchProxy({
                        enabled: true,
                        proxyLibraryId: null,
                      });
                    }}
                  >
                    <option value="none">{t('profileProxy.sourceDisabled')}</option>
                    <option value="library">{t('profileProxy.sourceLibrary')}</option>
                    <option value="manual">{t('profileProxy.sourceManual')}</option>
                  </Select>

                  {proxyMode === 'library' ? (
                    <>
                      <Select
                        label={t('profileProxy.libraryProxy')}
                        value={proxyLibraryId}
                        onValueChange={value => patchProxy({ proxyLibraryId: value || null })}
                        disabled={proxyLibraryLoading || proxyLibrary.length === 0}
                      >
                        <option value="">
                          {proxyLibraryLoading
                            ? t('profileProxy.loading')
                            : proxyLibrary.length
                              ? t('profileProxy.selectProxy')
                              : t('profileProxy.noEnabledProxies')}
                        </option>
                        {proxyLibrary.map(item => (
                          <option key={item.id} value={item.id}>
                            {item.label} ({item.proxyType}://{item.host}:{item.port})
                          </option>
                        ))}
                      </Select>

                      {selectedLibraryProxy ? (
                        <div className="text-xs text-slate-400 rounded border border-white/10 bg-white/[0.02] p-2">
                          {t('profileProxy.using')}: {selectedLibraryProxy.proxyType}://
                          {selectedLibraryProxy.host}:{selectedLibraryProxy.port}
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {proxyMode === 'manual' ? (
                    <>
                      <Input
                        label={t('autoReg.proxyUrl') || 'Proxy address'}
                        value={draft.network.proxy?.url ?? ''}
                        onChange={e => patchProxy({ url: e.target.value || null })}
                        placeholder="http://host:port"
                      />

                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          label={t('autoReg.username') || 'Username'}
                          value={draft.network.proxy?.username ?? ''}
                          onChange={e => patchProxy({ username: e.target.value || null })}
                        />
                        <Input
                          label={t('accounts.password') || 'Password'}
                          type="password"
                          value={draft.network.proxy?.password ?? ''}
                          onChange={e => patchProxy({ password: e.target.value || null })}
                        />
                      </div>

                      <div className="flex justify-end">
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => void handleMigrateManualProxyToLibrary()}
                        >
                          Move manual proxy to library
                        </Button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="text-xs text-slate-500">{t('profileProxy.disabledHint')}</div>
              )}
            </section>
          )}

          {!loading && activeTab === 'geo' && (
            <section className="space-y-4">
              <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                <MapPin size={14} /> {t('accounts.profileGeoTab') || 'Geo'}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Select
                  label={t('accounts.profileSettingsLocaleLabel') || 'Locale'}
                  value={draft.geo.locale ?? ''}
                  onValueChange={value =>
                    update({ ...draft, geo: { ...draft.geo, locale: value || null } })
                  }
                >
                  <option value="">Auto</option>
                  <option value="en-US">en-US</option>
                  <option value="en-GB">en-GB</option>
                  <option value="ru-RU">ru-RU</option>
                  <option value="de-DE">de-DE</option>
                </Select>

                <Input
                  label={t('accounts.profileSettingsTimezoneLabel') || 'Timezone'}
                  value={draft.geo.timezone ?? ''}
                  onChange={e =>
                    update({ ...draft, geo: { ...draft.geo, timezone: e.target.value || null } })
                  }
                  placeholder="Auto"
                />
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-slate-200 text-sm font-semibold hover:bg-white/[0.03] transition-colors"
                >
                  <span>Manual coordinates</span>
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showAdvanced && (
                  <div className="px-3 pb-3 grid grid-cols-2 gap-3 pt-2">
                    <Input
                      label={t('accounts.profileSettingsLatitudeLabel') || 'Latitude'}
                      type="number"
                      value={draft.geo.latitude ?? ''}
                      onChange={e => {
                        const next = e.target.value ? Number(e.target.value) : null;
                        update({
                          ...draft,
                          geo: {
                            ...draft.geo,
                            latitude: Number.isFinite(next as number) ? next : null,
                          },
                        });
                      }}
                      placeholder="Auto"
                    />
                    <Input
                      label={t('accounts.profileSettingsLongitudeLabel') || 'Longitude'}
                      type="number"
                      value={draft.geo.longitude ?? ''}
                      onChange={e => {
                        const next = e.target.value ? Number(e.target.value) : null;
                        update({
                          ...draft,
                          geo: {
                            ...draft.geo,
                            longitude: Number.isFinite(next as number) ? next : null,
                          },
                        });
                      }}
                      placeholder="Auto"
                    />
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-500">
                Current mode: {hasManualGeo ? 'Manual coordinates' : 'Auto geolocation'}
              </div>
            </section>
          )}

          {!loading && activeTab === 'data' && (
            <section className="space-y-4">
              <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                <Cookie size={14} /> Cookies & storage
              </div>

              <div className="rounded-lg bg-white/[0.02] px-3 py-2">
                <div className="text-xs text-slate-400">Cookies</div>
                <div className="text-sm text-slate-200 mt-1">{summary.cookiesHint}</div>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowCookieEditor(v => !v)}
                  >
                    {showCookieEditor ? 'Hide editor' : 'Edit cookies'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void handlePickCookieFile()}>
                    <Upload size={14} className="mr-1" /> Import file
                  </Button>
                </div>
              </div>

              {showCookieEditor && (
                <Textarea
                  label={t('accounts.profileSettingsCookiesLabel') || 'Cookies (JSON or file path)'}
                  value={draft.storage.cookies ?? ''}
                  onChange={e =>
                    update({
                      ...draft,
                      storage: { ...draft.storage, cookies: e.target.value || null },
                    })
                  }
                  hint="Paste JSON array/object or absolute path to cookies file"
                  placeholder='[{"name":"sid","value":"..."}] or C:\\cookies.json'
                  className="h-44 min-h-[176px] font-mono text-xs"
                />
              )}
            </section>
          )}
        </div>

        <footer className="sticky bottom-0 border-t border-white/10 px-5 py-4 flex items-center justify-between gap-3 bg-[#0f1115]">
          <div className="text-xs text-slate-400">{dirty ? 'Unsaved changes' : 'No changes'}</div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              {t('common.close') || 'Close'}
            </Button>
            <Button variant="primary" onClick={() => void handleSave()} disabled={!dirty || saving}>
              {saving ? t('common.loading') || 'Saving...' : t('common.save') || 'Save'}
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
