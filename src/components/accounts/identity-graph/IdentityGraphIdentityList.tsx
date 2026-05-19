import { t } from '@/lib/i18n';
import { ButtonBase } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { GoogleSheetsIdentityNode } from '@/types/googleSheets';

interface IdentityGraphIdentityListProps {
  identities: GoogleSheetsIdentityNode[];
  activeIdentityId: string | null;
  parsedLinks: Array<{ fromIdentityId: string; status: string }>;
  onSelectIdentity: (id: string) => void;
  resolveIdentityName: (node: GoogleSheetsIdentityNode) => string;
}

export function IdentityGraphIdentityList({
  identities,
  activeIdentityId,
  parsedLinks,
  onSelectIdentity,
  resolveIdentityName,
}: IdentityGraphIdentityListProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-vsc-sidebar/80 p-3 space-y-2 max-h-[680px] overflow-auto">
      {identities.map(node => {
        const selected = activeIdentityId === node.id;
        const linksCount = parsedLinks.filter(
          link => link.fromIdentityId === node.id && link.status !== 'deleted'
        ).length;

        return (
          <ButtonBase
            key={node.id}
            type="button"
            onClick={() => onSelectIdentity(node.id)}
            className={cn(
              'w-full text-left rounded-lg border px-3 py-2 transition-colors',
              selected
                ? 'border-indigo-500/40 bg-indigo-500/10'
                : 'border-white/5 bg-black/20 hover:border-white/15 hover:bg-white/5'
            )}
          >
            <div className="text-xs font-semibold text-white truncate">
              {resolveIdentityName(node)}
            </div>
            <div className="text-[10px] text-slate-500 truncate mt-0.5">{node.id}</div>
            <div className="mt-1 text-[10px] text-slate-400">{linksCount} {t('accounts.identityGraph.links')}</div>
          </ButtonBase>
        );
      })}
    </div>
  );
}
