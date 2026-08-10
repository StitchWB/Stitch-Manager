import { t } from "@/lib/i18n";import { Link2, Copy, FolderOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, ConfirmDialog, IconButton, Input, Select, Textarea, Toggle } from '@/components/ui';
import { type ProfileSettingsV1, type ProfileSettingsBrowserWindowMode, getProfileSettings } from '@/lib/backend/modules/profiles';
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
  alias?: string;
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
  alias,
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

  const [engineConfirm, setEngineConfirm] = useState<BrowserEngineId | null>(null);

  const handleEngineToggle = async (engine: BrowserEngineId) => {
    if (engine === currentEngine) return;
    // Fresh profiles (no prior usage) switch silently — same rule as the
    // profiles table. A profile has prior usage when it was launched
    // (storage.lastUrl set) or an engine was explicitly saved before and
    // differs from the target (browser state may exist for that engine).
    // Switching engine then changes the profile's browser identity.
    let hasPriorUsage = false;
    if (alias) {
      try {
        const record = await getProfileSettings({ alias });
        const lastUrl = record?.settings?.storage?.lastUrl?.trim();
        const explicitEngine = record?.settings?.engine ?? null;
        hasPriorUsage =
          Boolean(lastUrl) ||
          (explicitEngine !== null && normalizeBrowserEngine(explicitEngine) !== engine);
      } catch {
        // If settings can't be loaded, don't block the switch.
      }
    }
    if (hasPriorUsage) {
      setEngineConfirm(engine);
      return;
    }
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

      <ConfirmDialog
        isOpen={engineConfirm !== null}
        onClose={() => setEngineConfirm(null)}
        onConfirm={() => {
          if (engineConfirm !== null) {
            onUpdate({ ...draft, engine: engineConfirm });
          }
          setEngineConfirm(null);
        }}
        title={t('accounts.profileEngineConfirmTitle')}
        message={t('accounts.profileEngineConfirmMessage')}
        confirmText={t('accounts.profileEngineConfirmAction')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </section>);

}