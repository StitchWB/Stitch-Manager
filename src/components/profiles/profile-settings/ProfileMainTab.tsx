import { t } from "@/lib/i18n";import { Link2, Copy, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton, Input, Select, Textarea, Toggle } from '@/components/ui';
import { type ProfileSettingsV1, type ProfileSettingsBrowserWindowMode } from '@/lib/backend/modules/profiles';
import {
  parsePositiveIntOrNull,
  windowModeOptions,
  windowPresetOptions } from
'@/hooks/useProfileSettingsModal';
import { EngineToggle } from '@/components/profiles/EngineToggle';
import { normalizeBrowserEngine, type BrowserEngineId } from '@/lib/browser/engines';
import { safeInvoke } from '@/lib/backend/core';

interface ProfileMainTabProps {
  draft: ProfileSettingsV1;
  browserWindowMode: ProfileSettingsBrowserWindowMode;
  browserWindowWidth: number | null;
  browserWindowHeight: number | null;
  browserWindowMaximize: boolean;
  summaryWindowSizeHint: string;
  summaryMaximizeOnStart: boolean;
  onPatchBrowserWindow: (patch: {
    mode?: ProfileSettingsBrowserWindowMode;
    width?: number | null;
    height?: number | null;
    maximizeOnStart?: boolean;
  }) => void;
  onUpdate: (next: ProfileSettingsV1) => void;
  onClearMain: () => void;
  onResetMainToDefaults: () => void;
  onCopyPath: (value: string | null | undefined, label: string) => Promise<void>;
  onOpenPath: (value: string | null | undefined, label: string) => Promise<void>;
}

export function ProfileMainTab({
  draft,
  browserWindowMode,
  browserWindowWidth,
  browserWindowHeight,
  browserWindowMaximize,
  summaryWindowSizeHint,
  summaryMaximizeOnStart,
  onPatchBrowserWindow,
  onUpdate,
  onClearMain,
  onResetMainToDefaults,
  onCopyPath,
  onOpenPath
}: ProfileMainTabProps) {
  const [shardAvailable, setShardAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await safeInvoke<{ engines: Array<{ id: string; available: boolean }> }>('get_browser_engines', {});
        if (cancelled) return;
        const shard = res?.engines?.find(e => e.id === 'shardbrowser');
        setShardAvailable(shard ? shard.available : false);
      } catch {
        if (!cancelled) setShardAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const currentEngine = normalizeBrowserEngine(draft.engine);

  const windowModeLabels: Record<string, string> = {
    'fit-screen': t("profiles.profile_settings_modal.window_mode_fit_screen") || 'Fit screen (recommended)',
    'fixed': t("profiles.profile_settings_modal.window_mode_fixed") || 'Fixed size',
    'auto': t("profiles.profile_settings_modal.window_mode_auto") || 'Auto fallback'
  };

  // Engine switching is a plain toggle: applies immediately, switches back
  // on the opposite click. No confirmation by design.
  const handleEngineToggle = (engine: BrowserEngineId) => {
    if (engine === currentEngine) return;
    onUpdate({ ...draft, engine });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
        <Link2 size={14} />{t("settings.profile_main_tab.defaults")}
      </div>

      <div className="flex items-center gap-2">
        <Button size="xs" variant="secondary" onClick={onClearMain}>{t("settings.profile_main_tab.clear_main")}

        </Button>
        <Button size="xs" variant="secondary" onClick={onResetMainToDefaults}>{t("settings.profile_main_tab.main_defaults")}

        </Button>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs text-slate-400">{t('accounts.profileEngineLabel')}</div>
        <EngineToggle
          value={currentEngine}
          onChange={(engine: BrowserEngineId) => void handleEngineToggle(engine)}
          shardAvailable={shardAvailable}
          size="md"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select
          label={t("settings.profile_main_tab.window_mode") || 'Window mode'}
          value={browserWindowMode}
          onValueChange={(value) =>
          onPatchBrowserWindow({
            mode: value as ProfileSettingsBrowserWindowMode || 'fit-screen'
          })
          }>

          {windowModeOptions.map((option) =>
          <option key={option.value} value={option.value}>
              {windowModeLabels[option.value] ?? option.label}
            </option>
          )}
        </Select>

        <div className="flex items-end pb-1">
          <Toggle
            label={t("settings.profile_main_tab.maximize_on_start") || 'Maximize on start'}
            checked={browserWindowMaximize}
            onChange={(checked) => onPatchBrowserWindow({ maximizeOnStart: checked })} />

        </div>

        {browserWindowMode === 'fixed' ?
        <>
            <Select
            label={t("settings.profile_main_tab.window_preset") || 'Window preset'}
            value=""
            onValueChange={(value) => {
              if (!value) return;
              const preset = windowPresetOptions.find((item) => item.value === value);
              if (!preset) return;
              onPatchBrowserWindow({
                mode: 'fixed',
                width: preset.width,
                height: preset.height
              });
            }}>

              <option value="">{t("settings.profile_main_tab.pick_preset")}</option>
              {windowPresetOptions.map((preset) =>
            <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
            )}
            </Select>

            <div className="text-[11px] text-slate-500 flex items-end pb-2">{t("settings.profile_main_tab.used_when_mode_is_fixed_size")}

          </div>

            <Input
            label={t("settings.profile_main_tab.window_width") || 'Window width'}
            type="number"
            min={640}
            max={8192}
            value={browserWindowWidth ?? ''}
            onChange={(e) =>
            onPatchBrowserWindow({
              mode: 'fixed',
              width: parsePositiveIntOrNull(e.target.value)
            })
            }
            placeholder="1920" />


            <Input
            label={t("settings.profile_main_tab.window_height") || 'Window height'}
            type="number"
            min={480}
            max={8192}
            value={browserWindowHeight ?? ''}
            onChange={(e) =>
            onPatchBrowserWindow({
              mode: 'fixed',
              height: parsePositiveIntOrNull(e.target.value)
            })
            }
            placeholder="1080" />

          </> :
        null}
      </div>

      <Input
        label={t("settings.profile_main_tab.last_url") || 'Last URL'}
        value={draft.storage.lastUrl ?? ''}
        onChange={(e) =>
        onUpdate({
          ...draft,
          storage: { ...draft.storage, lastUrl: e.target.value || null }
        })
        }
        placeholder="https://google.com" />


      <Input
        label={t("settings.profile_main_tab.last_scenario_path") || 'Last scenario path'}
        value={draft.storage.lastScenarioPath ?? ''}
        onChange={(e) =>
        onUpdate({
          ...draft,
          storage: { ...draft.storage, lastScenarioPath: e.target.value || null }
        })
        }
        placeholder="C:\\...\\scenario.json"
        rightElement={
        <div className="flex items-center gap-2 pr-1 pl-2 border-l border-white/10">
            <IconButton
            size="sm"
            variant="ghost"
            className="p-2 rounded bg-white/[0.04] hover:bg-white/10 text-slate-300"
            onClick={() => void onCopyPath(draft.storage.lastScenarioPath, t("settings.profile_main_tab.scenario_path") || 'Scenario path')}
            title={t("settings.profile_main_tab.copy_path") || 'Copy path'}>

              <Copy size={14} />
            </IconButton>
            <IconButton
            size="sm"
            variant="ghost"
            className="p-2 rounded bg-white/[0.04] hover:bg-white/10 text-slate-300"
            onClick={() => void onOpenPath(draft.storage.lastScenarioPath, t("settings.profile_main_tab.scenario_path") || 'Scenario path')}
            title={t("settings.profile_main_tab.open_folder") || 'Open folder'}>

              <FolderOpen size={14} />
            </IconButton>
          </div>
        } />


      <Textarea
        label={t("settings.profile_main_tab.notes") || 'Notes'}
        value={draft.storage.notes ?? ''}
        onChange={(e) =>
        onUpdate({
          ...draft,
          storage: { ...draft.storage, notes: e.target.value || null }
        })
        }
        className="h-24 min-h-[96px]" />


      <div className="text-xs text-slate-500">{t("settings.profile_main_tab.window")}
        {summaryWindowSizeHint}
        {' • '}{t("settings.profile_main_tab.maximize")}{summaryMaximizeOnStart ? (t("settings.profile_main_tab.on") || 'On') : (t("settings.profile_main_tab.off") || 'Off')}
      </div>

    </section>);

}