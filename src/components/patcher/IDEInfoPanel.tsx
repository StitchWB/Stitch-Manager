import { Info, Globe } from 'lucide-react';
import { t } from '@/lib/i18n';
import { truncateMiddle } from '../../lib/patcher';
import type { DetectedIDE } from '../../types/ui';
import PatchStatusBadge from './PatchStatusBadge';

interface IDEInfoPanelProps {
  ide: DetectedIDE;
  isOperating: boolean;
  operation: 'patching' | 'unpatching' | 'restoring' | null;
}

export default function IDEInfoPanel({ ide, isOperating, operation }: IDEInfoPanelProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2 px-1">
        <Info size={14} className="text-primary" />
        {t('patcher.information')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 rounded-xl p-4 shadow-sm group hover:border-white/10 transition-colors">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5 group-hover:text-slate-400 transition-colors">{t("patcher.i_d_e_info_panel.status")}

          </p>
          <PatchStatusBadge
            isPatched={ide.isPatched}
            isOperating={isOperating}
            operation={operation} />
          
        </div>

        <div className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 rounded-xl p-4 shadow-sm group hover:border-white/10 transition-colors">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5 group-hover:text-slate-400 transition-colors flex items-center gap-1">
            <Globe size={10} />
            {t("patcher.i_d_e_info_panel.proxy")}
          </p>
          <p className="text-sm font-medium text-white">
            {ide.proxyInjected ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                {t("patcher.proxyActive")}
              </span>
            ) : (
              <span className="text-slate-500">{t("patcher.proxyInactive")}</span>
            )}
          </p>
        </div>

        <div className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 rounded-xl p-4 shadow-sm group hover:border-white/10 transition-colors">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5 group-hover:text-slate-400 transition-colors">{t("patcher.i_d_e_info_panel.version")}

          </p>
          <p className="text-sm font-medium text-white font-mono">
            {ide.patchVersion || ide.version || 'N/A'}
          </p>
        </div>

        <div className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 rounded-xl p-4 shadow-sm group hover:border-white/10 transition-colors">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5 group-hover:text-slate-400 transition-colors">{t("patcher.i_d_e_info_panel.path")}

          </p>
          <p className="text-sm font-medium text-white font-mono truncate" title={ide.path}>
            {ide.path ? truncateMiddle(ide.path) : 'Not found'}
          </p>
        </div>
      </div>
    </div>);

}