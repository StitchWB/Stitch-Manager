import { t } from "@/lib/i18n";import { Plus, Search, Star, Users } from 'lucide-react';

import { Button, FilterDropdown, Input } from '@/components/ui';
import type { FilterOption } from '@/components/ui';

interface IdentityGraphHeaderProps {
  totalIdentities: number;
  totalServices: number;
  totalLinks: number;
  connectionReady: boolean;
  schemaStatus: 'idle' | 'loading' | 'success' | 'error';
  query: string;
  serviceFilter: string;
  statusFilter: string;
  serviceOptions: FilterOption[];
  statusOptions: FilterOption[];
  onInitSchema: () => void;
  onCreateLink: () => void;
  onQueryChange: (value: string) => void;
  onServiceFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
}

export function IdentityGraphHeader({
  totalIdentities,
  totalServices,
  totalLinks,
  connectionReady,
  schemaStatus,
  query,
  serviceFilter,
  statusFilter,
  serviceOptions,
  statusOptions,
  onInitSchema,
  onCreateLink,
  onQueryChange,
  onServiceFilterChange,
  onStatusFilterChange
}: IdentityGraphHeaderProps) {
  return (
    <div className="shrink-0 border-b border-white/5 bg-vsc-bg/60 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Users className="w-4 h-4 text-indigo-400" />
          <span className="font-semibold text-white">{t("accounts.identity_graph_header.identity_graph")}</span>
          <span className="text-slate-500">•</span>
          <span className="tabular-nums">{totalIdentities}{t("accounts.identity_graph_header.identities")}</span>
          <span className="text-slate-500">•</span>
          <span className="tabular-nums">{totalServices}{t("accounts.identity_graph_header.service_accounts")}</span>
          <span className="text-slate-500">•</span>
          <span className="tabular-nums">{totalLinks}{t("accounts.identity_graph_header.links")}</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!connectionReady || schemaStatus === 'loading'}
            onClick={onInitSchema}
            leftIcon={<Star size={14} />}>{t("accounts.identity_graph_header.init_schema")}


          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onCreateLink}
            leftIcon={<Plus size={14} />}
            disabled={!connectionReady}>{t("accounts.identity_graph_header.new_link")}


          </Button>
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search identities, emails, services"
            leftIcon={<Search className="w-3.5 h-3.5" />}
            className="text-xs"
            containerClassName="w-[220px]" />
          
          <FilterDropdown
            value={serviceFilter}
            onChange={onServiceFilterChange}
            options={serviceOptions}
            placeholder="Service"
            showActiveState={true} />
          
          <FilterDropdown
            value={statusFilter}
            onChange={onStatusFilterChange}
            options={statusOptions}
            placeholder="Status"
            showActiveState={true} />
          
        </div>
      </div>
    </div>);

}