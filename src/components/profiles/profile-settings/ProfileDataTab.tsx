import { Cookie, Upload } from 'lucide-react';
import { Button, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import { type ProfileSettingsV1 } from '@/lib/backend/modules/profiles';

interface ProfileDataTabProps {
  draft: ProfileSettingsV1;
  showCookieEditor: boolean;
  cookiesHint: string;
  onUpdate: (next: ProfileSettingsV1) => void;
  onToggleCookieEditor: () => void;
  onPickCookieFile: () => Promise<void>;
  onClearData: () => void;
}

export function ProfileDataTab({
  draft,
  showCookieEditor,
  cookiesHint,
  onUpdate,
  onToggleCookieEditor,
  onPickCookieFile,
  onClearData
}: ProfileDataTabProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
        <Cookie size={14} />{t("settings.profile_data_tab.cookies_storage")}
      </div>

      <div className="rounded-lg bg-white/[0.02] px-3 py-2">
        <div className="text-xs text-slate-400">{t("settings.profile_data_tab.cookies")}</div>
        <div className="text-sm text-slate-200 mt-1">{cookiesHint}</div>
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={onToggleCookieEditor}>
            {showCookieEditor ? 'Hide editor' : 'Edit cookies'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void onPickCookieFile()}>
            <Upload size={14} className="mr-1" />{t("settings.profile_data_tab.import_file")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClearData}>{t("settings.profile_data_tab.clear_data")}

          </Button>
        </div>
      </div>

      {showCookieEditor &&
      <Textarea
        label={t('accounts.profileSettingsCookiesLabel') || 'Cookies (JSON or file path)'}
        value={draft.storage.cookies ?? ''}
        onChange={(e) =>
        onUpdate({
          ...draft,
          storage: { ...draft.storage, cookies: e.target.value || null }
        })
        }
        hint="Paste JSON array/object or absolute path to cookies file"
        placeholder='[{"name":"sid","value":"..."}] or C:\\cookies.json'
        className="h-44 min-h-[176px] font-mono text-xs" />

      }
    </section>);

}