import { t } from "@/lib/i18n";import { Link2, Copy, FolderOpen } from 'lucide-react';
import { Button, IconButton, Input, Select, Textarea, Toggle } from '@/components/ui';
import { type ProfileSettingsV1, type ProfileSettingsBrowserWindowMode } from '@/lib/tauri/modules/profiles';
import {
  parsePositiveIntOrNull,
  windowModeOptions,
  windowPresetOptions } from
'@/hooks/useProfileSettingsModal';

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

      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Window mode"
          value={browserWindowMode}
          onValueChange={(value) =>
          onPatchBrowserWindow({
            mode: value as ProfileSettingsBrowserWindowMode || 'fit-screen'
          })
          }>

          {windowModeOptions.map((option) =>
          <option key={option.value} value={option.value}>
              {option.label}
            </option>
          )}
        </Select>

        <div className="flex items-end pb-1">
          <Toggle
            label="Maximize on start"
            checked={browserWindowMaximize}
            onChange={(checked) => onPatchBrowserWindow({ maximizeOnStart: checked })} />

        </div>

        {browserWindowMode === 'fixed' ?
        <>
            <Select
            label="Window preset"
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
            label="Window width"
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
            label="Window height"
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
        label="Last URL"
        value={draft.storage.lastUrl ?? ''}
        onChange={(e) =>
        onUpdate({
          ...draft,
          storage: { ...draft.storage, lastUrl: e.target.value || null }
        })
        }
        placeholder="https://google.com" />


      <Input
        label="Last scenario path"
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
            onClick={() => void onCopyPath(draft.storage.lastScenarioPath, 'Scenario path')}
            title="Copy path">

              <Copy size={14} />
            </IconButton>
            <IconButton
            size="sm"
            variant="ghost"
            className="p-2 rounded bg-white/[0.04] hover:bg-white/10 text-slate-300"
            onClick={() => void onOpenPath(draft.storage.lastScenarioPath, 'Scenario path')}
            title="Open folder">

              <FolderOpen size={14} />
            </IconButton>
          </div>
        } />


      <Textarea
        label="Notes"
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
        {' • '}{t("settings.profile_main_tab.maximize")}{summaryMaximizeOnStart ? 'On' : 'Off'}
      </div>
    </section>);

}