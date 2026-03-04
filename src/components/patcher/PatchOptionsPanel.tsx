import { HelpCircle } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Tooltip } from '../Tooltip';
import { Checkbox, ButtonBase } from '../ui';

interface PatchOption {
  id: string;
  labelKey: string;
  descKey: string;
  defaultEnabled: boolean;
}

interface PatchOptionsPanelProps {
  options: PatchOption[];
  selectedOptions: Record<string, boolean>;
  onToggleOption: (optionId: string) => void;
  onToggleAll: (enable: boolean) => void;
}

export default function PatchOptionsPanel({
  options,
  selectedOptions,
  onToggleOption,
  onToggleAll,
}: PatchOptionsPanelProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="pt-4 border-t border-white/5">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          {t('patcher.patchOptions')}
        </h4>
        <div className="flex gap-2">
          <ButtonBase
            type="button"
            onClick={() => onToggleAll(true)}
            className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            All
          </ButtonBase>
          <ButtonBase
            type="button"
            onClick={() => onToggleAll(false)}
            className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            None
          </ButtonBase>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {options.map(option => (
          <div
            key={option.id}
            className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-200 group"
          >
            <Checkbox
              checked={selectedOptions[option.id] ?? option.defaultEnabled}
              onChange={() => onToggleOption(option.id)}
              label={
                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                  {t(option.labelKey)}
                </span>
              }
              className="p-0 hover:bg-transparent"
            />
            <Tooltip content={t(option.descKey)}>
              <HelpCircle
                size={14}
                className="text-slate-600 hover:text-slate-400 transition-colors"
              />
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  );
}
