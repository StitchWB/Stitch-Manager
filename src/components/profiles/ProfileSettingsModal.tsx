import { useEffect, useMemo, useState } from 'react';
import { Globe, Monitor, MapPin, Shield, Cpu, Fingerprint, BookText } from 'lucide-react';
import { Button, Input, Modal, Select, TabButton, Toggle } from '../ui';
import { t } from '../../lib/i18n';
import {
  generateFingerprintProfile,
  getProfileSettings,
  saveProfileSettings,
  type ProfileSettingsV1,
} from '@/lib/tauri/modules/profiles';
import { parseProxyString } from '../../lib/proxyUtils';

type ProfileSettingsTab = 'network' | 'hardware' | 'geo' | 'storage';

const defaultSettings: ProfileSettingsV1 = {
  version: 1,
  network: {
    proxy: {
      enabled: false,
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
  },
};

interface ProfileSettingsModalProps {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const localeOptions = [
  { value: '', label: t('common.select') },
  { value: 'ru-RU', label: 'ru-RU' },
  { value: 'en-US', label: 'en-US' },
  { value: 'en-GB', label: 'en-GB' },
];

const timezoneOptions = [
  { value: '', label: t('common.select') },
  { value: 'Europe/Moscow', label: 'Europe/Moscow' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
];

const platformOptions = [
  { value: '', label: t('common.select') },
  { value: 'Win32', label: 'Windows (Win32)' },
  { value: 'MacIntel', label: 'macOS (MacIntel)' },
  { value: 'Linux x86_64', label: 'Linux x86_64' },
];

export function ProfileSettingsModal({
  alias,
  isOpen,
  onClose,
  onSaved,
}: ProfileSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<ProfileSettingsTab>('network');
  const [draft, setDraft] = useState<ProfileSettingsV1>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const profileAlias = alias ?? '';

  const proxyEnabled = Boolean(draft.network.proxy?.enabled);

  const summary = useMemo(() => {
    const proxy = draft.network.proxy;
    const proxyLabel = proxy?.enabled
      ? proxy?.url || `${proxy?.username ? 'auth' : 'no-auth'} proxy`
      : t('common.none');
    const hw = draft.hardware;
    const geo = draft.geo;

    return {
      proxy: proxyLabel,
      userAgent: hw.userAgent || t('common.none'),
      screen:
        hw.screenWidth && hw.screenHeight
          ? `${hw.screenWidth}×${hw.screenHeight}`
          : t('common.none'),
      locale: geo.locale || t('common.none'),
      timezone: geo.timezone || t('common.none'),
    };
  }, [draft]);

  useEffect(() => {
    if (!isOpen || !alias) return;

    setActiveTab('network');
    setDirty(false);
    setError(null);
    setLoading(true);

    const load = async () => {
      try {
        const existing = await getProfileSettings({ alias });
        if (existing?.settings) {
          setDraft({
            ...defaultSettings,
            ...existing.settings,
            network: {
              ...defaultSettings.network,
              ...existing.settings.network,
            },
            geo: { ...defaultSettings.geo, ...existing.settings.geo },
            hardware: { ...defaultSettings.hardware, ...existing.settings.hardware },
            storage: { ...defaultSettings.storage, ...existing.settings.storage },
          });
        } else {
          setDraft(defaultSettings);
        }
      } catch (err) {
        console.error('[ProfileSettingsModal] Failed to load settings:', err);
        setError(t('common.error'));
        setDraft(defaultSettings);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [alias, isOpen]);

  const setProxyField = (updates: Partial<ProfileSettingsV1['network']['proxy']>) => {
    setDraft(prev => ({
      ...prev,
      network: {
        ...prev.network,
        proxy: {
          ...(prev.network.proxy ?? {
            enabled: false,
            url: null,
            username: null,
            password: null,
          }),
          ...updates,
        },
      },
    }));
    setDirty(true);
  };

  const handleProxyHostPaste = (value: string) => {
    const parsed = parseProxyString(value, 'http');
    if (!parsed) {
      setProxyField({ url: value });
      return;
    }

    const isLegacy = value.trim().startsWith('http') || value.trim().startsWith('socks5');
    const url = isLegacy ? value.trim() : `${parsed.host}:${parsed.port}`;
    const nextUrl = parsed.type ? `${parsed.type}://${url.replace(/^\w+:\/\//, '')}` : url;

    setProxyField({
      url: nextUrl,
      username: parsed.username ?? null,
      password: parsed.password ?? null,
    });
  };

  const handleProxyHostChange = (value: string) => {
    setProxyField({ url: value });
  };

  const handleSave = async () => {
    if (!alias || saving) return;
    setSaving(true);
    setError(null);

    try {
      const normalized: ProfileSettingsV1 = {
        ...draft,
        version: 1,
        network: {
          ...draft.network,
          proxy: draft.network.proxy
            ? {
                enabled: Boolean(draft.network.proxy.enabled),
                url: draft.network.proxy.url || null,
                username: draft.network.proxy.username || null,
                password: draft.network.proxy.password || null,
              }
            : { enabled: false, url: null, username: null, password: null },
        },
      };

      await saveProfileSettings({ alias, settings: normalized });
      setDirty(false);
      onSaved?.();
    } catch (err) {
      console.error('[ProfileSettingsModal] Failed to save settings:', err);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateFingerprint = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const profile = await generateFingerprintProfile();
      setDraft(prev => ({
        ...prev,
        hardware: {
          ...prev.hardware,
          userAgent: profile.userAgent || prev.hardware.userAgent,
          platform: profile.platform || prev.hardware.platform,
          hardwareConcurrency:
            profile.hardwareConcurrency || prev.hardware.hardwareConcurrency || null,
          deviceMemory: profile.deviceMemory || prev.hardware.deviceMemory || null,
          screenWidth: profile.screenWidth || prev.hardware.screenWidth || null,
          screenHeight: profile.screenHeight || prev.hardware.screenHeight || null,
        },
        geo: {
          ...prev.geo,
          timezone: profile.timezone || prev.geo.timezone,
          locale: profile.locale || prev.geo.locale,
        },
      }));
      setDirty(true);
    } catch (err) {
      console.error('[ProfileSettingsModal] Failed to generate fingerprint:', err);
      setError(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-slate-500">{dirty ? '● TODO: изменено' : t('common.saved')}</div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="md" onClick={onClose} disabled={saving}>
          {t('common.close')}
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={!dirty || saving}
          isLoading={saving}
        >
          {t('common.save')}
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('accounts.profileSettingsTitle') || 'Настройки профиля'}
      icon={<Fingerprint size={18} className="text-indigo-400" />}
      size="xl"
      isLoading={loading}
      loadingMessage={t('common.loading')}
      closeOnBackdrop={!saving}
      closeOnEscape={!saving}
      showCloseButton={!saving}
      footer={footer}
      className="max-h-[90vh]"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-widest text-slate-500">
              {t('accounts.profileAlias')}
            </div>
            <div className="text-sm font-semibold text-slate-100 truncate">{profileAlias}</div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Cpu size={14} />}
            onClick={handleGenerateFingerprint}
            disabled={saving}
          >
            {'Сгенерировать новый отпечаток'}
          </Button>
        </div>

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-6">
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-2">
              <TabButton
                active={activeTab === 'network'}
                onClick={() => setActiveTab('network')}
                icon={<Globe size={14} />}
                label={t('autoReg.proxy')}
              />
              <TabButton
                active={activeTab === 'hardware'}
                onClick={() => setActiveTab('hardware')}
                icon={<Monitor size={14} />}
                label={t('accounts.profileHardwareTab') || 'Железо'}
              />
              <TabButton
                active={activeTab === 'geo'}
                onClick={() => setActiveTab('geo')}
                icon={<MapPin size={14} />}
                label={t('accounts.profileGeoTab') || 'Гео'}
              />
              <TabButton
                active={activeTab === 'storage'}
                onClick={() => setActiveTab('storage')}
                icon={<BookText size={14} />}
                label={t('accounts.notes')}
              />
            </div>

            {activeTab === 'network' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Toggle
                    label={t('autoReg.proxyEnabled')}
                    checked={proxyEnabled}
                    onChange={checked => {
                      setProxyField({ enabled: checked });
                      if (!checked) {
                        setProxyField({ url: null, username: null, password: null });
                      }
                    }}
                  />
                  <Shield
                    size={16}
                    className={proxyEnabled ? 'text-emerald-400' : 'text-slate-500'}
                  />
                </div>

                <Input
                  label={t('autoReg.proxyUrl')}
                  value={draft.network.proxy?.url ?? ''}
                  onChange={e => handleProxyHostChange(e.target.value)}
                  onPaste={e => {
                    const text = e.clipboardData.getData('text');
                    if (!text) return;
                    e.preventDefault();
                    handleProxyHostPaste(text.trim());
                  }}
                  placeholder="host:port или http://user:pass@host:port"
                  disabled={!proxyEnabled}
                />

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={t('autoReg.username')}
                    value={draft.network.proxy?.username ?? ''}
                    onChange={e => setProxyField({ username: e.target.value || null })}
                    disabled={!proxyEnabled}
                  />
                  <Input
                    label={t('accounts.password')}
                    type="password"
                    value={draft.network.proxy?.password ?? ''}
                    onChange={e => setProxyField({ password: e.target.value || null })}
                    disabled={!proxyEnabled}
                  />
                </div>
              </div>
            )}

            {activeTab === 'hardware' && (
              <div className="space-y-4">
                <Input
                  label="User-Agent"
                  value={draft.hardware.userAgent ?? ''}
                  onChange={e => {
                    setDraft(prev => ({
                      ...prev,
                      hardware: { ...prev.hardware, userAgent: e.target.value || null },
                    }));
                    setDirty(true);
                  }}
                  placeholder="Mozilla/5.0 ..."
                />
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    label={t('accounts.profilePlatformLabel') || 'Платформа'}
                    value={draft.hardware.platform ?? ''}
                    onChange={e => {
                      setDraft(prev => ({
                        ...prev,
                        hardware: { ...prev.hardware, platform: e.target.value || null },
                      }));
                      setDirty(true);
                    }}
                  >
                    {platformOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label={t('accounts.profileHardwareConcurrency') || 'CPU ядра'}
                    type="number"
                    value={draft.hardware.hardwareConcurrency ?? ''}
                    onChange={e => {
                      const next = e.target.value ? Number(e.target.value) : null;
                      setDraft(prev => ({
                        ...prev,
                        hardware: { ...prev.hardware, hardwareConcurrency: next },
                      }));
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={t('accounts.profileHardwareMemory') || 'RAM (GB)'}
                    type="number"
                    value={draft.hardware.deviceMemory ?? ''}
                    onChange={e => {
                      const next = e.target.value ? Number(e.target.value) : null;
                      setDraft(prev => ({
                        ...prev,
                        hardware: { ...prev.hardware, deviceMemory: next },
                      }));
                      setDirty(true);
                    }}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label={t('accounts.profileScreenWidth') || 'Ширина'}
                      type="number"
                      value={draft.hardware.screenWidth ?? ''}
                      onChange={e => {
                        const next = e.target.value ? Number(e.target.value) : null;
                        setDraft(prev => ({
                          ...prev,
                          hardware: { ...prev.hardware, screenWidth: next },
                        }));
                        setDirty(true);
                      }}
                    />
                    <Input
                      label={t('accounts.profileScreenHeight') || 'Высота'}
                      type="number"
                      value={draft.hardware.screenHeight ?? ''}
                      onChange={e => {
                        const next = e.target.value ? Number(e.target.value) : null;
                        setDraft(prev => ({
                          ...prev,
                          hardware: { ...prev.hardware, screenHeight: next },
                        }));
                        setDirty(true);
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'geo' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    label={t('accounts.profileLocaleLabel') || 'Locale'}
                    value={draft.geo.locale ?? ''}
                    onChange={e => {
                      setDraft(prev => ({
                        ...prev,
                        geo: { ...prev.geo, locale: e.target.value || null },
                      }));
                      setDirty(true);
                    }}
                  >
                    {localeOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label={t('accounts.profileTimezoneLabel') || 'Timezone'}
                    value={draft.geo.timezone ?? ''}
                    onChange={e => {
                      setDraft(prev => ({
                        ...prev,
                        geo: { ...prev.geo, timezone: e.target.value || null },
                      }));
                      setDirty(true);
                    }}
                  >
                    {timezoneOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={t('accounts.profileLatitudeLabel') || 'Широта'}
                    type="number"
                    value={draft.geo.latitude ?? ''}
                    onChange={e => {
                      const next = e.target.value ? Number(e.target.value) : null;
                      setDraft(prev => ({
                        ...prev,
                        geo: { ...prev.geo, latitude: next },
                      }));
                      setDirty(true);
                    }}
                  />
                  <Input
                    label={t('accounts.profileLongitudeLabel') || 'Долгота'}
                    type="number"
                    value={draft.geo.longitude ?? ''}
                    onChange={e => {
                      const next = e.target.value ? Number(e.target.value) : null;
                      setDraft(prev => ({
                        ...prev,
                        geo: { ...prev.geo, longitude: next },
                      }));
                      setDirty(true);
                    }}
                  />
                </div>
              </div>
            )}

            {activeTab === 'storage' && (
              <div className="space-y-4">
                <Input
                  label={t('accounts.profileNotesLabel') || 'Заметки'}
                  value={draft.storage.notes ?? ''}
                  onChange={e => {
                    setDraft(prev => ({
                      ...prev,
                      storage: { ...prev.storage, notes: e.target.value || null },
                    }));
                    setDirty(true);
                  }}
                  placeholder="TODO: заметки"
                />
                <Input
                  label={t('accounts.profileCookiesLabel') || 'Cookies'}
                  value={draft.storage.cookies ?? ''}
                  onChange={e => {
                    setDraft(prev => ({
                      ...prev,
                      storage: { ...prev.storage, cookies: e.target.value || null },
                    }));
                    setDirty(true);
                  }}
                  placeholder="TODO: cookies"
                />
              </div>
            )}
          </div>

          <aside className="shrink-0 rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-500">
              <Fingerprint size={14} className="text-indigo-400" />
              {t('accounts.profileSummaryTitle') || 'Сводка'}
            </div>
            <div className="space-y-3 text-xs text-slate-300">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Proxy</div>
                <div className="truncate">{summary.proxy}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">UA</div>
                <div className="truncate">{summary.userAgent}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Screen</div>
                <div className="truncate">{summary.screen}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Locale</div>
                <div className="truncate">{summary.locale}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">Timezone</div>
                <div className="truncate">{summary.timezone}</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </Modal>
  );
}
