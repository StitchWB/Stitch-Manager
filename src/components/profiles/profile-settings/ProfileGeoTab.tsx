import { MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { t } from '@/lib/i18n';
import { type ProfileSettingsV1 } from '@/lib/tauri/modules/profiles';

interface ProfileGeoTabProps {
  draft: ProfileSettingsV1;
  showAdvanced: boolean;
  hasManualGeo: boolean;
  localeManual: boolean;
  timezoneManual: boolean;
  onUpdate: (next: ProfileSettingsV1) => void;
  onClearGeo: () => void;
  onToggleAdvanced: () => void;
}

export function ProfileGeoTab({
  draft,
  showAdvanced,
  hasManualGeo,
  localeManual,
  timezoneManual,
  onUpdate,
  onClearGeo,
  onToggleAdvanced,
}: ProfileGeoTabProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
        <MapPin size={14} /> {t('accounts.profileGeoTab') || 'Geo'}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select
          label={t('accounts.profileSettingsLocaleLabel') || 'Locale'}
          value={draft.geo.locale ?? ''}
          onValueChange={value =>
            onUpdate({ ...draft, geo: { ...draft.geo, locale: value || null } })
          }
        >
          <option value="">Auto</option>
          <option value="en-US">en-US</option>
          <option value="en-GB">en-GB</option>
          <option value="ru-RU">ru-RU</option>
          <option value="de-DE">de-DE</option>
        </Select>

        <div className="flex items-end">
          <Button size="xs" variant="secondary" onClick={onClearGeo}>
            Clear geo
          </Button>
        </div>

        <Input
          label={t('accounts.profileSettingsTimezoneLabel') || 'Timezone'}
          value={draft.geo.timezone ?? ''}
          onChange={e =>
            onUpdate({ ...draft, geo: { ...draft.geo, timezone: e.target.value || null } })
          }
          placeholder="Auto"
        />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02]">
        <button
          type="button"
          onClick={onToggleAdvanced}
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
                onUpdate({
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
                onUpdate({
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
        {' • '}Locale: {localeManual ? 'Manual' : 'Auto'}
        {' • '}Timezone: {timezoneManual ? 'Manual' : 'Auto'}
      </div>
    </section>
  );
}
