import { Database, Copy } from 'lucide-react';import { ButtonBase } from '../ui';

import { SectionHeader } from '../ui/SectionHeader';
import { Tooltip } from '../Tooltip';
import { t } from '../../lib/i18n';

interface DatabaseSectionProps {
  dbPath: string;
  onCopy: (text: string) => void;
}

export function DatabaseSection({ dbPath, onCopy }: DatabaseSectionProps) {
  return (
    <SectionHeader
      title={t('settings.database.title')}
      icon={<Database className="w-4 h-4 text-slate-500" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="glass-card rounded-lg p-3 bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <span className="text-slate-400 text-xs">{t('settings.database.location')}</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-300 font-mono text-xs break-all max-w-[400px] text-right">
              {dbPath || './stitch.db'}
            </span>
            <Tooltip content={t('common.copy')}>
              <ButtonBase
                onClick={() => onCopy(dbPath || './stitch.db')}
                className="p-1 hover:bg-white/10 rounded transition-colors text-slate-400 hover:text-white"
              >
                <Copy className="w-3.5 h-3.5" />
              </ButtonBase>
            </Tooltip>
          </div>
        </div>
      </div>
    </SectionHeader>
  );
}
