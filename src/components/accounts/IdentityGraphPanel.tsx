import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Link2,
  PenSquare,
  Plus,
  Search,
  Star,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import type {
  GoogleSheetsDataset,
  GoogleSheetsIdentityNode,
  GoogleSheetsServiceAccount,
} from '@/types/googleSheets';
import type { NormalizedRow } from '@/types/generated';
import {
  deleteGoogleSheetsLink,
  initGoogleSheetsSchema,
  upsertGoogleSheetsLink,
} from '@/lib/tauri';
import { cn } from '@/lib/utils';
import { useRegistrationStore } from '@/stores/registration';
import { useUIPreferencesStore } from '@/stores/uiPreferences';
import { buildUnifiedGraph } from '@/lib/graph/unifiedGraph';
import { useAccountsStore } from '@/stores/accounts';
import { Button, Checkbox, EmptyState, FilterDropdown, Input, Select, UnstyledButton } from '../ui';
import type { SheetDescriptor } from '@/types/generated';

type ServiceFilterOption = 'all' | string;
type StatusFilterOption = 'all' | string;

type LinkEditorMode = 'create' | 'edit';

interface ParsedLinkRow {
  rowNumber: number;
  linkId: string;
  linkIdValue?: string;
  fromIdentityId: string;
  toServiceSheet: string;
  toServiceAccountId: string;
  isPrimary: boolean;
  linkType: string;
  status: string;
  note: string;
  record: Record<string, string>;
}

interface LinkEditorState {
  linkId: string;
  fromIdentityId: string;
  toServiceSheet: string;
  toServiceAccountId: string;
  isPrimary: boolean;
  linkType: string;
  status: string;
  note: string;
}

interface IdentityGraphPanelProps {
  dataset: GoogleSheetsDataset | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  localProfiles?: string[];
  className?: string;
}

const emptyDataset: GoogleSheetsDataset = {
  sheets: [],
  identityGraph: {
    identities: [],
    services: [],
    edges: [],
  },
};

const normalizeValue = (value: string | undefined) => (value ?? '').toLowerCase().trim();

const normalizeSheetName = (value: string) => {
  const trimmed = value.trim();
  return trimmed.toUpperCase().startsWith('SVC_') ? trimmed.slice(4) : trimmed;
};

const parseBooleanValue = (value: string | undefined) => {
  if (!value) return false;
  return ['true', 'yes', '1', 'y'].includes(value.toLowerCase().trim());
};

const formatBooleanValue = (value: boolean) => (value ? 'TRUE' : 'FALSE');

const buildKeyValueList = (record: Record<string, string>) => {
  return Object.entries(record)
    .filter(([key]) => key.trim().length > 0)
    .map(([key, value]) => ({ key, value: value ?? '' }));
};

const cellsToRecord = (cells: Array<{ key: string; value: string }>) => {
  return cells.reduce(
    (acc, cell) => {
      if (cell.key) acc[cell.key] = cell.value;
      return acc;
    },
    {} as Record<string, string>
  );
};

const pickFirst = (record: Record<string, string>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (value && value.trim()) return value.trim();
  }
  return '';
};

const ensureLinkIdValue = (current?: string) => {
  if (current && current.trim()) return current.trim();
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const getServiceOptions = (services: GoogleSheetsServiceAccount[]) => {
  const counts = services.reduce((map, svc) => {
    const key = svc.service?.trim() || 'unknown';
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  return [
    { value: 'all', label: 'All services' },
    ...Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, count })),
  ];
};

const getStatusOptions = (identities: GoogleSheetsIdentityNode[]) => {
  const counts = identities.reduce((map, node) => {
    const key = node.status?.trim() || 'unknown';
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  return [
    { value: 'all', label: 'All statuses' },
    ...Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, label: value, count })),
  ];
};

const extractServiceAccounts = (dataset: GoogleSheetsDataset) => {
  if (dataset.identityGraph?.services?.length) {
    return dataset.identityGraph.services;
  }

  return dataset.identityGraph?.identities.flatMap(node => node.services ?? []) ?? [];
};

const getServiceBadgeClass = (service: string) => {
  const key = normalizeValue(service);
  if (key.includes('aws')) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (key.includes('github')) return 'border-slate-500/30 bg-slate-500/10 text-slate-200';
  if (key.includes('kiro')) return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200';
  if (key.includes('windsurf')) return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  if (key.includes('trae')) return 'border-purple-500/30 bg-purple-500/10 text-purple-200';
  return 'border-white/10 bg-white/5 text-slate-300';
};

const getStatusBadgeClass = (status?: string) => {
  const key = normalizeValue(status);
  if (key.includes('active')) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (key.includes('expired') || key.includes('limit'))
    return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  if (key.includes('banned') || key.includes('suspended'))
    return 'border-rose-500/30 bg-rose-500/10 text-rose-200';
  if (key.includes('pending')) return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  return 'border-white/10 bg-white/5 text-slate-300';
};

const getLinkTypeBadgeClass = (linkType?: string) => {
  const key = normalizeValue(linkType);
  if (key.includes('oauth')) return 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200';
  if (key.includes('password')) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
  if (key.includes('phone')) return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  if (key.includes('recovery')) return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-white/10 bg-white/5 text-slate-300';
};

const resolveIdentityName = (node: GoogleSheetsIdentityNode) =>
  node.primaryEmail || node.label || node.id;

const ensureServiceList = (node: GoogleSheetsIdentityNode, dataset: GoogleSheetsDataset) => {
  if (node.services?.length) return node.services;
  const services = extractServiceAccounts(dataset);
  return services.filter(service => service.identityId === node.id);
};

const setRecordField = (record: Record<string, string>, keys: string[], value: string) => {
  const existing = keys.find(key => key in record);
  record[existing ?? keys[0]] = value;
};

const buildLinkRecord = (state: LinkEditorState, baseRecord: Record<string, string> = {}) => {
  const next = { ...baseRecord };
  const linkId = ensureLinkIdValue(state.linkId || pickFirst(next, ['link_id', 'id']));
  setRecordField(next, ['link_id', 'id'], linkId);
  setRecordField(
    next,
    ['from_identity_id', 'source_identity_id', 'identity_id', 'from_id'],
    state.fromIdentityId
  );
  setRecordField(next, ['to_service_sheet', 'to_service', 'service'], state.toServiceSheet);
  setRecordField(next, ['to_service_account_id', 'target_id', 'to_id'], state.toServiceAccountId);
  setRecordField(next, ['is_primary', 'primary'], formatBooleanValue(state.isPrimary));
  setRecordField(next, ['link_type', 'relation'], state.linkType);
  setRecordField(next, ['status', 'state'], state.status);
  setRecordField(next, ['note'], state.note);
  return next;
};

const parseLinkRow = (row: NormalizedRow): ParsedLinkRow => {
  const record = cellsToRecord(row.cells);
  const linkIdValue = pickFirst(record, ['link_id', 'id']) || undefined;
  const linkId = linkIdValue || `link:${row.rowNumber}`;
  return {
    rowNumber: row.rowNumber,
    linkId,
    linkIdValue,
    fromIdentityId: pickFirst(record, [
      'from_identity_id',
      'source_identity_id',
      'identity_id',
      'from_id',
    ]),
    toServiceSheet: pickFirst(record, ['to_service_sheet', 'to_service', 'service']),
    toServiceAccountId: pickFirst(record, ['to_service_account_id', 'target_id', 'to_id']),
    isPrimary: parseBooleanValue(pickFirst(record, ['is_primary', 'primary'])),
    linkType: pickFirst(record, ['link_type', 'relation']),
    status: pickFirst(record, ['status', 'state']),
    note: pickFirst(record, ['note']),
    record,
  };
};

const getServiceSheetOptionValue = (sheet: SheetDescriptor) => sheet.title;

const getServiceSheetOptions = (sheets: SheetDescriptor[]) => {
  return sheets
    .filter(sheet => normalizeValue(sheet.title).startsWith('svc_'))
    .map(sheet => ({
      value: getServiceSheetOptionValue(sheet),
      label: normalizeSheetName(sheet.title),
    }));
};

const groupServicesBySheet = (services: GoogleSheetsServiceAccount[]) => {
  const map = new Map<string, GoogleSheetsServiceAccount[]>();
  services.forEach(service => {
    const key = service.sheetName || `SVC_${service.service}`;
    const list = map.get(key) ?? [];
    list.push(service);
    map.set(key, list);
  });
  return map;
};

export function IdentityGraphPanel({
  dataset,
  isLoading = false,
  error,
  onRetry,
  localProfiles: localProfilesProp,
  className,
}: IdentityGraphPanelProps) {
  const [query, setQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState<ServiceFilterOption>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterOption>('all');
  const [schemaStatus, setSchemaStatus] = useState<'idle' | 'loading' | 'success' | 'error'>(
    'idle'
  );
  const [schemaMessage, setSchemaMessage] = useState<string | null>(null);
  const [activeIdentityId, setActiveIdentityId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<LinkEditorMode>('create');
  const [editorState, setEditorState] = useState<LinkEditorState>({
    linkId: '',
    fromIdentityId: '',
    toServiceSheet: '',
    toServiceAccountId: '',
    isPrimary: false,
    linkType: 'oauth',
    status: 'ok',
    note: '',
  });
  const [editingBaseRecord, setEditingBaseRecord] = useState<Record<string, string>>({});
  const [savingLink, setSavingLink] = useState(false);
  const [deletingLink, setDeletingLink] = useState(false);

  const resolvedDataset = dataset ?? emptyDataset;
  const graph = resolvedDataset.identityGraph ?? emptyDataset.identityGraph;
  const services = useMemo(() => extractServiceAccounts(resolvedDataset), [resolvedDataset]);
  const linksRaw = resolvedDataset.raw?.links ?? [];
  const parsedLinks = useMemo(() => linksRaw.map(parseLinkRow), [linksRaw]);
  const schemaIssues = resolvedDataset.raw?.schemaIssues ?? [];
  const invalidRows = resolvedDataset.invalidRows ?? [];

  const localAccounts = useAccountsStore(state => state.accounts);
  const providerFilter = useUIPreferencesStore(
    (state: { accountsPage: { providerFilter?: string } }) =>
      state.accountsPage.providerFilter || 'all'
  );
  const localProfiles = localProfilesProp ?? [];

  const unified = useMemo(() => {
    const graph = buildUnifiedGraph({ sheets: resolvedDataset, localAccounts, localProfiles });
    if (providerFilter === 'all') return graph;

    const providerKey = providerFilter.toLowerCase();
    const allowedNodes = new Set<string>();
    graph.nodes.forEach(node => {
      if (node.kind === 'service') {
        const service = String(node.meta?.service ?? '').toLowerCase();
        const sheetName = String(node.meta?.sheetName ?? '').toLowerCase();
        if (service.includes(providerKey) || sheetName.includes(providerKey)) {
          allowedNodes.add(node.id);
        }
      }
      if (node.kind === 'account') {
        const provider = String(node.meta?.provider ?? '').toLowerCase();
        if (provider === providerKey) {
          allowedNodes.add(node.id);
        }
      }
    });

    // Keep identities/profiles if they connect to allowed nodes
    graph.edges.forEach(edge => {
      if (allowedNodes.has(edge.fromId) || allowedNodes.has(edge.toId)) {
        allowedNodes.add(edge.fromId);
        allowedNodes.add(edge.toId);
      }
    });

    return {
      ...graph,
      nodes: graph.nodes.filter(n => allowedNodes.has(n.id) || n.kind === 'identity'),
      edges: graph.edges.filter(e => allowedNodes.has(e.fromId) && allowedNodes.has(e.toId)),
      diagnostics: {
        ...graph.diagnostics,
        reasons:
          providerFilter === 'all'
            ? graph.diagnostics.reasons
            : [
                {
                  code: 'provider_filter',
                  message: `Provider filter applied: ${providerFilter}`,
                },
                ...graph.diagnostics.reasons,
              ],
      },
    };
  }, [resolvedDataset, localAccounts, localProfiles, providerFilter]);

  const spreadsheetId = useRegistrationStore(
    state => state.config.advanced.googleSheetsSpreadsheetId || ''
  );
  const serviceAccountJson = useRegistrationStore(
    state => state.config.advanced.googleSheetsServiceAccountJson || ''
  );

  const connectionReady = Boolean(spreadsheetId.trim() && serviceAccountJson.trim());

  const serviceOptions = useMemo(() => getServiceOptions(services), [services]);
  const statusOptions = useMemo(() => getStatusOptions(graph?.identities ?? []), [graph]);
  const serviceSheetOptions = useMemo(
    () => getServiceSheetOptions(resolvedDataset.connection?.sheets ?? []),
    [resolvedDataset.connection?.sheets]
  );
  const servicesBySheet = useMemo(() => groupServicesBySheet(services), [services]);
  const identityOptions = useMemo(
    () =>
      (graph?.identities ?? []).map(identity => ({
        value: identity.id,
        label: resolveIdentityName(identity),
      })),
    [graph]
  );

  const filteredIdentities = useMemo(() => {
    const q = normalizeValue(query);

    return (graph?.identities ?? []).filter(node => {
      const matchesQuery =
        !q ||
        normalizeValue(node.label).includes(q) ||
        normalizeValue(node.primaryEmail).includes(q) ||
        normalizeValue(node.id).includes(q) ||
        (node.services ?? []).some(
          service =>
            normalizeValue(service.login).includes(q) || normalizeValue(service.service).includes(q)
        );

      if (!matchesQuery) return false;

      if (statusFilter !== 'all') {
        const status = normalizeValue(node.status);
        if (!status || status !== normalizeValue(statusFilter)) return false;
      }

      if (serviceFilter !== 'all') {
        const list = ensureServiceList(node, resolvedDataset);
        if (
          !list.some(service => normalizeValue(service.service) === normalizeValue(serviceFilter))
        ) {
          return false;
        }
      }

      return true;
    });
  }, [graph, query, serviceFilter, statusFilter, resolvedDataset]);

  const hasData = filteredIdentities.length > 0;
  const totalIdentities = graph?.identities?.length ?? 0;
  const totalLinks = graph?.edges?.length ?? 0;

  const activeIdentity = useMemo(() => {
    if (activeIdentityId) {
      return filteredIdentities.find(identity => identity.id === activeIdentityId) ?? null;
    }
    return filteredIdentities[0] ?? null;
  }, [filteredIdentities, activeIdentityId]);

  useEffect(() => {
    if (!activeIdentity && activeIdentityId) {
      setActiveIdentityId(null);
    }
  }, [activeIdentity, activeIdentityId]);

  const activeIdentityLinks = useMemo(() => {
    if (!activeIdentity) return [];
    return parsedLinks.filter(
      link => link.fromIdentityId === activeIdentity.id && link.status !== 'deleted'
    );
  }, [activeIdentity, parsedLinks]);

  const activeIdentityUnifiedEdges = useMemo(() => {
    if (!activeIdentity) return [];
    const fromId = `identity:${activeIdentity.id}`;
    return unified.edges.filter(edge => edge.fromId === fromId);
  }, [activeIdentity, unified.edges]);

  const openCreateEditor = (identityId?: string) => {
    const fallbackSheet = serviceSheetOptions[0]?.value || '';
    const fallbackService = servicesBySheet.get(fallbackSheet)?.[0]?.id || '';
    setEditorMode('create');
    setEditingBaseRecord({});
    setEditorState({
      linkId: '',
      fromIdentityId: identityId || activeIdentity?.id || identityOptions[0]?.value || '',
      toServiceSheet: fallbackSheet,
      toServiceAccountId: fallbackService,
      isPrimary: false,
      linkType: 'oauth',
      status: 'ok',
      note: '',
    });
    setEditorOpen(true);
  };

  const openEditEditor = (link: ParsedLinkRow) => {
    setEditorMode('edit');
    setEditingBaseRecord(link.record);
    setEditorState({
      linkId: link.linkIdValue || link.linkId,
      fromIdentityId: link.fromIdentityId,
      toServiceSheet: link.toServiceSheet,
      toServiceAccountId: link.toServiceAccountId,
      isPrimary: link.isPrimary,
      linkType: link.linkType || 'oauth',
      status: link.status || 'ok',
      note: link.note || '',
    });
    setEditorOpen(true);
  };

  const handleInitSchema = async () => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    try {
      setSchemaStatus('loading');
      setSchemaMessage(null);
      const status = await initGoogleSheetsSchema({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
      });
      setSchemaStatus('success');
      setSchemaMessage(
        status.warnings.length
          ? `Schema initialized with warnings: ${status.warnings[0]}`
          : 'Schema initialized successfully'
      );
      if (onRetry) {
        await onRetry();
      }
      toast.success('Google Sheets schema initialized');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSchemaStatus('error');
      setSchemaMessage(message);
      toast.error(message);
    }
  };

  const handleSaveLink = async () => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    if (
      !editorState.fromIdentityId ||
      !editorState.toServiceSheet ||
      !editorState.toServiceAccountId
    ) {
      toast.error('Identity, service sheet, and service account are required.');
      return;
    }
    try {
      setSavingLink(true);

      const sameTargetLinks = parsedLinks.filter(
        link =>
          link.status !== 'deleted' &&
          link.toServiceSheet === editorState.toServiceSheet &&
          link.toServiceAccountId === editorState.toServiceAccountId
      );

      if (editorState.isPrimary) {
        const updates = sameTargetLinks.filter(
          link =>
            link.isPrimary && (editorMode === 'create' || link.linkIdValue !== editorState.linkId)
        );
        for (const link of updates) {
          const updated = buildLinkRecord(
            {
              linkId: link.linkIdValue || link.linkId,
              fromIdentityId: link.fromIdentityId,
              toServiceSheet: link.toServiceSheet,
              toServiceAccountId: link.toServiceAccountId,
              isPrimary: false,
              linkType: link.linkType,
              status: link.status || 'ok',
              note: link.note,
            },
            link.record
          );

          await upsertGoogleSheetsLink({
            spreadsheetId: spreadsheetId.trim(),
            serviceAccountJson: serviceAccountJson.trim(),
            link: buildKeyValueList(updated),
          });
        }
      }

      const nextRecord = buildLinkRecord(editorState, editingBaseRecord);
      await upsertGoogleSheetsLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        link: buildKeyValueList(nextRecord),
      });

      toast.success(editorMode === 'create' ? 'Link created' : 'Link updated');
      setEditorOpen(false);
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingLink(false);
    }
  };

  const handleDeleteLink = async () => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    const linkId = editorState.linkId.trim();
    if (!linkId) {
      toast.error('This link does not have a stable link_id yet. Save it first.');
      return;
    }
    try {
      setDeletingLink(true);
      await deleteGoogleSheetsLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        linkId,
      });
      toast.success('Link deleted');
      setEditorOpen(false);
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingLink(false);
    }
  };

  const currentSheetServiceOptions = useMemo(() => {
    const rows = servicesBySheet.get(editorState.toServiceSheet) ?? [];
    return rows.map(service => ({
      value: service.id,
      label: service.login || service.id,
    }));
  }, [servicesBySheet, editorState.toServiceSheet]);

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      <div className="shrink-0 border-b border-white/5 bg-[#0a0a0c]/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Users className="w-4 h-4 text-indigo-400" />
            <span className="font-semibold text-white">Identity Graph</span>
            <span className="text-slate-500">•</span>
            <span className="tabular-nums">{totalIdentities} identities</span>
            <span className="text-slate-500">•</span>
            <span className="tabular-nums">{services.length} service accounts</span>
            <span className="text-slate-500">•</span>
            <span className="tabular-nums">{totalLinks} links</span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!connectionReady || schemaStatus === 'loading'}
              onClick={handleInitSchema}
              leftIcon={<Star size={14} />}
            >
              Init schema
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openCreateEditor(activeIdentity?.id)}
              leftIcon={<Plus size={14} />}
              disabled={!connectionReady}
            >
              New link
            </Button>
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search identities, emails, services"
              leftIcon={<Search className="w-3.5 h-3.5" />}
              className="text-xs"
              containerClassName="w-[220px]"
            />
            <FilterDropdown
              value={serviceFilter}
              onChange={value => setServiceFilter(value)}
              options={serviceOptions}
              placeholder="Service"
              showActiveState={true}
            />
            <FilterDropdown
              value={statusFilter}
              onChange={value => setStatusFilter(value)}
              options={statusOptions}
              placeholder="Status"
              showActiveState={true}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        {schemaIssues.length > 0 ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-200">
              Schema issues ({schemaIssues.length})
            </div>
            <div className="mt-2 space-y-1">
              {schemaIssues.slice(0, 6).map((issue, idx) => (
                <div key={`${issue.sheetName}-${idx}`} className="text-xs text-amber-100/90">
                  [{issue.level}] {issue.sheetName}: {issue.message}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {invalidRows.length > 0 ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-rose-200">
              Invalid rows ({invalidRows.length})
            </div>
            <div className="mt-2 space-y-1">
              {invalidRows.slice(0, 6).map(row => (
                <div key={`${row.sheetName}-${row.rowNumber}`} className="text-xs text-rose-100/90">
                  {row.sheetName} row {row.rowNumber}: {row.reason}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Graph diagnostics
          </div>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-slate-400">
            <div>Identities: {unified.diagnostics.identities}</div>
            <div>Services: {unified.diagnostics.services}</div>
            <div>Links: {unified.diagnostics.links}</div>
            <div>Local accounts: {unified.diagnostics.localAccounts}</div>
            <div>Local profiles: {unified.diagnostics.localProfiles}</div>
            <div>Svc→Acc matches: {unified.diagnostics.matchedServiceToAccount}</div>
            <div>Acc→Profile matches: {unified.diagnostics.matchedAccountToProfile}</div>
          </div>
          {unified.diagnostics.reasons.length ? (
            <div className="mt-2 space-y-1">
              {unified.diagnostics.reasons.slice(0, 4).map(reason => (
                <div key={reason.code} className="text-[11px] text-amber-200/90">
                  {reason.message}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {schemaMessage ? (
          <div
            className={cn(
              'rounded-xl border p-3 text-xs',
              schemaStatus === 'error'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            )}
          >
            {schemaMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-xl border border-white/10 bg-[#111116]/70 p-6 text-sm text-slate-400">
            Loading identity graph...
          </div>
        ) : null}

        {!isLoading && error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
            {onRetry && (
              <UnstyledButton
                type="button"
                onClick={onRetry}
                className="text-xs font-semibold text-rose-200 hover:text-white"
              >
                Retry
              </UnstyledButton>
            )}
          </div>
        ) : null}

        {!isLoading && !error && !hasData ? (
          <EmptyState
            icon={User}
            title="No identities found"
            description="Try adjusting filters or loading another dataset."
          />
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,360px)_1fr] gap-4">
          <div className="rounded-xl border border-white/10 bg-[#111116]/80 p-3 space-y-2 max-h-[680px] overflow-auto">
            {filteredIdentities.map(node => {
              const selected = activeIdentity?.id === node.id;
              const linksCount = parsedLinks.filter(
                link => link.fromIdentityId === node.id && link.status !== 'deleted'
              ).length;
              return (
                <UnstyledButton
                  key={node.id}
                  type="button"
                  onClick={() => setActiveIdentityId(node.id)}
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
                  <div className="mt-1 text-[10px] text-slate-400">{linksCount} links</div>
                </UnstyledButton>
              );
            })}
          </div>

          <div className="space-y-3">
            {activeIdentity ? (
              <div className="rounded-xl border border-white/10 bg-[#111116]/80 p-4 space-y-3">
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
                    onClick={() => openCreateEditor(activeIdentity.id)}
                    disabled={!connectionReady}
                  >
                    Add link
                  </Button>
                </div>

                {activeIdentityLinks.length ? (
                  <div className="space-y-2">
                    {activeIdentityLinks.map(link => {
                      const serviceName = normalizeSheetName(link.toServiceSheet || 'service');
                      const targetService = services.find(s => s.id === link.toServiceAccountId);
                      return (
                        <div
                          key={link.linkId}
                          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate">
                                {targetService?.login ||
                                  link.toServiceAccountId ||
                                  'Unknown service account'}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">
                                {serviceName} • {link.linkIdValue || link.linkId}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {link.isPrimary ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-200 uppercase tracking-widest font-semibold">
                                  Primary
                                </span>
                              ) : null}
                              {link.linkType ? (
                                <span
                                  className={cn(
                                    'text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-widest font-semibold',
                                    getLinkTypeBadgeClass(link.linkType)
                                  )}
                                >
                                  {link.linkType}
                                </span>
                              ) : null}
                              <Button
                                size="xs"
                                variant="ghost"
                                leftIcon={<PenSquare size={12} />}
                                onClick={() => openEditEditor(link)}
                                disabled={!connectionReady}
                              >
                                Edit
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-slate-500 flex items-center gap-2">
                    <Link2 className="w-3.5 h-3.5" />
                    No links for this identity yet.
                  </div>
                )}

                {activeIdentityUnifiedEdges.length ? (
                  <div className="pt-3 mt-3 border-t border-white/10">
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      Unified edges
                    </div>
                    <div className="mt-2 space-y-1">
                      {activeIdentityUnifiedEdges.slice(0, 8).map(edge => (
                        <div
                          key={edge.id}
                          className="text-[11px] text-slate-400 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {edge.kind} → {edge.toId}
                          </span>
                          {edge.label ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300">
                              {edge.label}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {filteredIdentities.map(node => {
              const serviceList = ensureServiceList(node, resolvedDataset);
              return (
                <div
                  key={node.id}
                  className="rounded-xl border border-white/10 bg-[#111116]/80 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
                        <User className="w-4 h-4 text-indigo-300" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white truncate max-w-[240px]">
                          {resolveIdentityName(node)}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[240px]">
                          {node.id}
                        </div>
                      </div>
                    </div>

                    {node.status && (
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
                          getStatusBadgeClass(node.status)
                        )}
                      >
                        {node.status}
                      </span>
                    )}

                    {node.tags?.length ? (
                      <div className="flex flex-wrap items-center gap-1">
                        {node.tags.slice(0, 3).map(tag => (
                          <span
                            key={`${node.id}-${tag}`}
                            className="text-[10px] text-slate-400 bg-white/5 border border-white/10 rounded-full px-2 py-0.5"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {serviceList.length ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                      {serviceList.map(service => (
                        <div
                          key={service.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/30 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white truncate">
                              {service.login || service.identityLabel || 'Unknown login'}
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {service.service}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
                                getServiceBadgeClass(service.service)
                              )}
                            >
                              {service.service}
                            </span>
                            {service.status && (
                              <span
                                className={cn(
                                  'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border',
                                  getStatusBadgeClass(service.status)
                                )}
                              >
                                {service.status}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-slate-500 flex items-center gap-2">
                      <Link2 className="w-3.5 h-3.5" />
                      No linked service accounts yet.
                    </div>
                  )}

                  {node.linkedIdentities?.length ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="text-slate-500">Linked identities:</span>
                      {node.linkedIdentities.map((identity: string) => (
                        <span
                          key={`${node.id}-${identity}`}
                          className="px-2 py-0.5 rounded-full border border-white/10 bg-white/5"
                        >
                          {identity}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editorOpen ? (
        <div className="absolute inset-0 z-20 bg-black/50 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md h-full bg-[#0b0d11] border-l border-white/10 p-4 overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold text-white">
                  {editorMode === 'create' ? 'Create link' : 'Edit link'}
                </div>
                <div className="text-[11px] text-slate-500">LINKS write-back</div>
              </div>
              <UnstyledButton
                type="button"
                onClick={() => setEditorOpen(false)}
                className="p-1 rounded-md hover:bg-white/10 text-slate-300"
              >
                <X className="w-4 h-4" />
              </UnstyledButton>
            </div>

            <div className="space-y-3">
              <Select
                label="Identity"
                value={editorState.fromIdentityId}
                onValueChange={value =>
                  setEditorState(prev => ({ ...prev, fromIdentityId: value }))
                }
                options={identityOptions.map(option => ({
                  value: option.value,
                  label: option.label,
                }))}
              />

              <Select
                label="Service sheet"
                value={editorState.toServiceSheet}
                onValueChange={sheet => {
                  const firstService = servicesBySheet.get(sheet)?.[0]?.id || '';
                  setEditorState(prev => ({
                    ...prev,
                    toServiceSheet: sheet,
                    toServiceAccountId: firstService,
                  }));
                }}
                options={serviceSheetOptions.map(option => ({
                  value: option.value,
                  label: option.label,
                }))}
              />

              <Select
                label="Service account"
                value={editorState.toServiceAccountId}
                onValueChange={value =>
                  setEditorState(prev => ({ ...prev, toServiceAccountId: value }))
                }
                options={currentSheetServiceOptions.map(option => ({
                  value: option.value,
                  label: option.label,
                }))}
              />

              <Select
                label="Link type"
                value={editorState.linkType}
                onValueChange={value => setEditorState(prev => ({ ...prev, linkType: value }))}
                options={[
                  { value: 'oauth', label: 'oauth' },
                  { value: 'password', label: 'password' },
                  { value: 'recovery', label: 'recovery' },
                  { value: 'phone', label: 'phone' },
                  { value: 'unknown', label: 'unknown' },
                ]}
              />

              <Select
                label="Status"
                value={editorState.status}
                onValueChange={value => setEditorState(prev => ({ ...prev, status: value }))}
                options={[
                  { value: 'ok', label: 'ok' },
                  { value: 'broken', label: 'broken' },
                  { value: 'unknown', label: 'unknown' },
                  { value: 'deleted', label: 'deleted' },
                ]}
              />

              <Input
                label="Note"
                value={editorState.note}
                onChange={event => setEditorState(prev => ({ ...prev, note: event.target.value }))}
                placeholder="Optional note"
              />

              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <Checkbox
                  checked={editorState.isPrimary}
                  onChange={checked =>
                    setEditorState(prev => ({ ...prev, isPrimary: Boolean(checked) }))
                  }
                  label="Primary link"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              {editorMode === 'edit' ? (
                <Button
                  variant="danger"
                  size="sm"
                  leftIcon={<Trash2 size={14} />}
                  onClick={handleDeleteLink}
                  disabled={deletingLink || savingLink}
                >
                  {deletingLink ? 'Deleting…' : 'Delete'}
                </Button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditorOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<PenSquare size={14} />}
                  onClick={handleSaveLink}
                  disabled={savingLink || deletingLink}
                >
                  {savingLink ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
