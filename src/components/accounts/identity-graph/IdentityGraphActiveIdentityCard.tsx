import { t } from "@/lib/i18n";import { Link2, PenSquare, Plus } from 'lucide-react';

import { Badge, Button, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { GoogleSheetsIdentityNode, GoogleSheetsServiceAccount } from '@/types/googleSheets';
import type { UnifiedGraphEdge } from '@/lib/graph/unifiedGraph';
import { getStatusBadgeVariant } from './badgeStyles';

export interface ActiveIdentityLink {
  linkId: string;
  linkIdValue?: string;
  toServiceSheet: string;
  toServiceAccountId: string;
  isPrimary: boolean;
  linkType: string;
}

interface IdentityGraphActiveIdentityCardProps<TLink extends ActiveIdentityLink> {
  activeIdentity: GoogleSheetsIdentityNode | null;
  activeIdentityLinks: TLink[];
  activeIdentityUnifiedEdges: UnifiedGraphEdge[];
  services: GoogleSheetsServiceAccount[];
  connectionReady: boolean;
  onAddLink: (identityId: string) => void;
  onEditLink: (link: TLink) => void;
  resolveIdentityName: (node: GoogleSheetsIdentityNode) => string;
  normalizeSheetName: (value: string) => string;
  getLinkTypeBadgeClass: (linkType?: string) => string;
}

export function IdentityGraphActiveIdentityCard<TLink extends ActiveIdentityLink>({
  activeIdentity,
  activeIdentityLinks,
  activeIdentityUnifiedEdges,
  services,
  connectionReady,
  onAddLink,
  onEditLink,
  resolveIdentityName,
  normalizeSheetName,
  getLinkTypeBadgeClass
}: IdentityGraphActiveIdentityCardProps<TLink>) {
  if (!activeIdentity) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-ds-surface-overlay/80 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">
            {resolveIdentityName(activeIdentity)}
          </div>
          <div className="text-[11px] text-slate-500">{activeIdentity.id}</div>
        </div>
        <Button
          size="xs"
          variant="secondary"
          leftIcon={<Plus size={12} />}
          onClick={() => onAddLink(activeIdentity.id)}
          disabled={!connectionReady}>{t("accounts.identity_graph_active_identity_card.add_link")}


        </Button>
      </div>

      {activeIdentityLinks.length ?
      <div className="space-y-2">
          {activeIdentityLinks.map((link) => {
          const serviceName = normalizeSheetName(link.toServiceSheet || 'service');
          const targetService = services.find((s) => s.id === link.toServiceAccountId);
          return (
            <div
              key={link.linkId}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {targetService?.login || link.toServiceAccountId || 'Unknown service account'}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {serviceName} • {link.linkIdValue || link.linkId}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {link.isPrimary ?
                  <StatusBadge
                    variant={getStatusBadgeVariant('expired')}
                    size="sm"
                    className="text-[10px] px-2 py-0.5 tracking-widest font-semibold">{t("accounts.identity_graph_active_identity_card.primary")}


                  </StatusBadge> :
                  null}
                    {link.linkType ?
                  <Badge
                    size="sm"
                    variant="outline"
                    className={cn(
                      'text-[10px] px-2 py-0.5 tracking-widest font-semibold',
                      getLinkTypeBadgeClass(link.linkType)
                    )}>
                    
                        {link.linkType}
                      </Badge> :
                  null}
                    <Button
                    size="xs"
                    variant="ghost"
                    leftIcon={<PenSquare size={12} />}
                    onClick={() => onEditLink(link)}
                    disabled={!connectionReady}>{t("accounts.identity_graph_active_identity_card.edit")}


                  </Button>
                  </div>
                </div>
              </div>);

        })}
        </div> :

      <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-slate-500 flex items-center gap-2">
          <Link2 className="w-3.5 h-3.5" />{t("accounts.identity_graph_active_identity_card.no_links_for_this_identity_yet")}

      </div>
      }

      {activeIdentityUnifiedEdges.length ?
      <div className="pt-3 mt-3 border-t border-white/10">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{t("accounts.identity_graph_active_identity_card.unified_edges")}

        </div>
          <div className="mt-2 space-y-1">
            {activeIdentityUnifiedEdges.slice(0, 8).map((edge) =>
          <div
            key={edge.id}
            className="text-[11px] text-slate-400 flex items-center justify-between gap-2">
            
                <span className="truncate">
                  {edge.kind} → {edge.toId}
                </span>
                {edge.label ?
            <Badge
              size="sm"
              variant="outline"
              className="text-[10px] px-2 py-0.5 text-slate-300">
              
                    {edge.label}
                  </Badge> :
            null}
              </div>
          )}
          </div>
        </div> :
      null}
    </div>);

}