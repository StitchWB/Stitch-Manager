import { t } from "@/lib/i18n";
import { Volume2, Play, AlertCircle } from 'lucide-react';
import { GlassCard, DropdownMenu, Toggle, Button } from '@/components/ui';
import { NumberInput } from '@/components/ui/NumberInput';
import { Tooltip } from '../Tooltip';

export interface SoundsTabProps {
  captchaSoundEnabled: boolean;
  onCaptchaSoundEnabledChange: (enabled: boolean) => void;
  captchaSoundFile: string;
  onCaptchaSoundFileChange: (file: string) => void;
  captchaTimeout: number;
  onCaptchaTimeoutChange: (timeout: number) => void;
  disabled?: boolean;
}

const SOUND_OPTIONS = [
  { value: 'taksi.mp3', label: 'Такси' },
  { value: 'pkh.mp3', label: 'Пх' },
  { value: 'zvuk-fotoapparata.mp3', label: 'Фотоаппарат' },
  { value: 'skype-error-sound-error.mp3', label: 'Skype Error' },
  { value: 'oshibka-otkaz1.mp3', label: 'Отказ 1' },
  { value: 'oshibka-otpravki--grustnyiy-bip.mp3', label: 'Грустный бип' },
  { value: 'oshibka--rezkiy-bip.mp3', label: 'Резкий бип' },
  { value: 'geympley--oshibochnoe-deystvie.mp3', label: 'Ошибочное действие' },
];

function InlineToggle({
  label,
  tooltip,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  tooltip?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const content = (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400">{label}</span>
      <Toggle
        label=""
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        tooltip={tooltip}
      />
    </div>
  );
  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}

export function SoundsTab({
  captchaSoundEnabled,
  onCaptchaSoundEnabledChange,
  captchaSoundFile,
  onCaptchaSoundFileChange,
  captchaTimeout,
  onCaptchaTimeoutChange,
  disabled,
}: SoundsTabProps) {
  const handleTestSound = () => {
    if (!captchaSoundEnabled) return;
    const audio = new Audio(`/sounds/${captchaSoundFile}`);
    audio.volume = 0.8;
    audio.play().catch(() => {
      // Autoplay policy may block; ignore silently
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Main sound toggle */}
      <GlassCard className="p-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-300">{t("autoReg.soundsTab.title")}</span>
          </div>

          <InlineToggle
            label={t("autoReg.soundsTab.enableCaptchaSound")}
            tooltip={t("autoReg.soundsTab.captchaSoundTooltip")}
            checked={captchaSoundEnabled}
            onChange={onCaptchaSoundEnabledChange}
            disabled={disabled}
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-400">{t("autoReg.soundsTab.alertSoundLabel")}</span>
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <DropdownMenu
                value={captchaSoundFile}
                onValueChange={onCaptchaSoundFileChange}
                options={SOUND_OPTIONS}
                placeholder={t("autoReg.soundsTab.selectSoundPlaceholder")}
                disabled={disabled || !captchaSoundEnabled}
                className="w-full relative z-20"
                buttonClassName="w-full justify-between rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
                menuClassName="w-full min-w-0"
              />
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Play className="w-3 h-3" />}
                onClick={handleTestSound}
                disabled={disabled || !captchaSoundEnabled}
              >
                {t("autoReg.soundsTab.testButton")}
              </Button>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Timeout */}
      <GlassCard className="p-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 pb-1 border-b border-white/[0.06]">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-slate-300">{t("autoReg.soundsTab.timeoutTitle")}</span>
          </div>

          <Tooltip content={t("autoReg.soundsTab.timeoutTooltip")}>
            <NumberInput
              label={t("autoReg.soundsTab.timeoutLabel")}
              value={captchaTimeout}
              onChange={onCaptchaTimeoutChange}
              min={1}
              max={30}
              step={1}
              unit={t("autoReg.soundsTab.minUnit")}
              className="w-full"
            />
          </Tooltip>
        </div>
      </GlassCard>
    </div>
  );
}
