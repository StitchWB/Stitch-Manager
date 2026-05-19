import { t } from "@/lib/i18n";import { Link2, User } from 'lucide-react';

import { Badge, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type {
  GoogleSheetsDataset,
  GoogleSheetsIdentityNode,
  GoogleSheetsServiceAccount } from
'@/types/googleSheets';
import { getStatusBadgeVariant } from './badgeStyles';

interface IdentityGraphIdentityCardsListProps {
  identities: GoogleSheetsIdentityNode[];
  resolvedDataset: GoogleSheetsDataset;
  ensureServiceList: (
  node: GoogleSheetsIdentityNode,
  dataset: GoogleSheetsDataset)
  => GoogleSheetsServiceAccount[];
  resolveIdentityName: (node: GoogleSheetsIdentityNode) => string;
  getServiceBadgeClass: (service: string) => string;
}

export function IdentityGraphIdentityCardsList({
  identities,
  resolvedDataset,
  ensureServiceList,
  resolveIdentityName,
  getServiceBadgeClass
}: IdentityGraphIdentityCardsListProps) {
  return (
    <>
      {identities.map((node) => {
        const serviceList = ensureServiceList(node, resolvedDataset);
        return (
          <div
            key={node.id}
            className="rounded-xl border border-white/10 bg-vsc-sidebar/80 p-4 space-y-3">
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                  <User className="w-4 h-4 text-indigo-300" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-white truncate max-w-[240px]">
                    {resolveIdentityName(node)}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate max-w-[240px]">{node.id}</div>
                </div>
              </div>

              {node.status &&
              <StatusBadge
                variant={getStatusBadgeVariant(node.status)}
                size="sm"
                className="text-[10px] font-bold tracking-widest px-2 py-0.5">
                
                  {node.status}
                </StatusBadge>
              }

              {node.tags?.length ?
              <div className="flex flex-wrap items-center gap-1">
                  {node.tags.slice(0, 3).map((tag) =>
                <Badge
                  key={`${node.id}-${tag}`}
                  size="sm"
                  variant="default"
                  className="text-[10px] text-slate-400 px-2 py-0.5">
                  
                      {tag}
                    </Badge>
                )}
                </div> :
              null}
            </div>

            {serviceList.length ?
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                {serviceList.map((service) =>
              <div
                key={service.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/30 px-3 py-2">
                
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-white truncate">
                        {service.login || service.identityLabel || 'Unknown login'}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">{service.service}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge
                    size="sm"
                    variant="outline"
                    className={cn(
                      'text-[10px] font-bold tracking-widest px-2 py-0.5',
                      getServiceBadgeClass(service.service)
                    )}>
                    
                        {service.service}
                      </Badge>
                      {service.status &&
                  <StatusBadge
                    variant={getStatusBadgeVariant(service.status)}
                    size="sm"
                    className="text-[10px] font-bold tracking-widest px-2 py-0.5">
                    
                          {service.status}
                        </StatusBadge>
                  }
                    </div>
                  </div>
              )}
              </div> :

            <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-slate-500 flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5" />{t("accounts.identity_graph_identity_cards_list.no_linked_service_accounts_yet")}

            </div>
            }

            {node.linkedIdentities?.length ?
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="text-slate-500">{t("accounts.identity_graph_identity_cards_list.linked_identities")}</span>
                {node.linkedIdentities.map((identity: string) =>
              <Badge
                key={`${node.id}-${identity}`}
                size="sm"
                variant="default"
                className="px-2 py-0.5">
                
                    {identity}
                  </Badge>
              )}
              </div> :
            null}
          </div>);

      })}
    </>);

}