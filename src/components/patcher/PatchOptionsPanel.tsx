import { HelpCircle } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Tooltip } from '../Tooltip';

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
          <button
            onClick={() => onToggleAll(true)}
            className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            All
          </button>
          <button
            onClick={() => onToggleAll(false)}
            className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            None
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
        {options.map(option => (
          <label
            key={option.id}
            className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 cursor-pointer transition-all duration-200 group"
          >
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedOptions[option.id] ?? option.defaultEnabled}
                onChange={() => onToggleOption(option.id)}
                className="
                  appearance-none w-4 h-4 rounded border border-white/20 bg-white/5 
                  checked:bg-primary checked:border-primary checked:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')]
                  focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer shrink-0
                "
              />
              <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                {t(option.labelKey)}
              </span>
            </div>
            <Tooltip content={t(option.descKey)}>
              <HelpCircle
                size={14}
                className="text-slate-600 hover:text-slate-400 transition-colors"
              />
            </Tooltip>
          </label>
        ))}
      </div>
    </div>
  );
}
