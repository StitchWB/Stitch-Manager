import { t } from '../lib/i18n';

export default function Tools() {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-6 py-3 border-b border-white/5 bg-vsc-bg/70 backdrop-blur-xl shrink-0">
        <h1 className="text-base font-bold text-white tracking-tight">{t('tools.title')}</h1>
        <p className="text-[11px] text-slate-500 mt-0.5">{t('tools.subtitle')}</p>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-1.5 p-6 text-center">
        <p className="text-sm font-medium text-slate-300">{t('tools.emptyTitle')}</p>
        <p className="text-xs text-slate-500">{t('tools.emptyDescription')}</p>
      </div>
    </div>
  );
}
