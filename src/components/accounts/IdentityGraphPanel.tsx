import { useEffect, useMemo, useState } from 'react';
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
import type { SheetDescriptor } from '@/types/generated';
import {
  IdentityGraphHeader,
  IdentityGraphAlerts,
  IdentityGraphDiagnostics,
  IdentityGraphSchemaMessage,
  IdentityGraphStateBlocks,
  IdentityGraphIdentityList,
  IdentityGraphActiveIdentityCard,
  IdentityGraphIdentityCardsList,
  IdentityGraphLinkEditorDrawer,
  getServiceBadgeClass,
  getLinkTypeBadgeClass,
} from './identity-graph';

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
      <IdentityGraphHeader
        totalIdentities={totalIdentities}
        totalServices={services.length}
        totalLinks={totalLinks}
        connectionReady={connectionReady}
        schemaStatus={schemaStatus}
        query={query}
        serviceFilter={serviceFilter}
        statusFilter={statusFilter}
        serviceOptions={serviceOptions}
        statusOptions={statusOptions}
        onInitSchema={handleInitSchema}
        onCreateLink={() => openCreateEditor(activeIdentity?.id)}
        onQueryChange={setQuery}
        onServiceFilterChange={value => setServiceFilter(value)}
        onStatusFilterChange={value => setStatusFilter(value)}
      />

      <div className="flex-1 overflow-auto px-4 py-4 space-y-3">
        <IdentityGraphAlerts schemaIssues={schemaIssues} invalidRows={invalidRows} />
        <IdentityGraphDiagnostics diagnostics={unified.diagnostics} />
        <IdentityGraphSchemaMessage schemaMessage={schemaMessage} schemaStatus={schemaStatus} />
        <IdentityGraphStateBlocks
          isLoading={isLoading}
          error={error}
          hasData={hasData}
          onRetry={onRetry}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,360px)_1fr] gap-4">
          <IdentityGraphIdentityList
            identities={filteredIdentities}
            activeIdentityId={activeIdentity?.id ?? null}
            parsedLinks={parsedLinks}
            onSelectIdentity={setActiveIdentityId}
            resolveIdentityName={resolveIdentityName}
          />

          <div className="space-y-3">
            <IdentityGraphActiveIdentityCard
              activeIdentity={activeIdentity}
              activeIdentityLinks={activeIdentityLinks}
              activeIdentityUnifiedEdges={activeIdentityUnifiedEdges}
              services={services}
              connectionReady={connectionReady}
              onAddLink={openCreateEditor}
              onEditLink={openEditEditor}
              resolveIdentityName={resolveIdentityName}
              normalizeSheetName={normalizeSheetName}
              getLinkTypeBadgeClass={getLinkTypeBadgeClass}
            />
            <IdentityGraphIdentityCardsList
              identities={filteredIdentities}
              resolvedDataset={resolvedDataset}
              ensureServiceList={ensureServiceList}
              resolveIdentityName={resolveIdentityName}
              getServiceBadgeClass={getServiceBadgeClass}
            />
          </div>
        </div>
      </div>
      <IdentityGraphLinkEditorDrawer
        open={editorOpen}
        editorMode={editorMode}
        editorState={editorState}
        identityOptions={identityOptions}
        serviceSheetOptions={serviceSheetOptions}
        currentSheetServiceOptions={currentSheetServiceOptions}
        savingLink={savingLink}
        deletingLink={deletingLink}
        onClose={() => setEditorOpen(false)}
        onIdentityChange={value => setEditorState(prev => ({ ...prev, fromIdentityId: value }))}
        onServiceSheetChange={sheet => {
          const firstService = servicesBySheet.get(sheet)?.[0]?.id || '';
          setEditorState(prev => ({
            ...prev,
            toServiceSheet: sheet,
            toServiceAccountId: firstService,
          }));
        }}
        onServiceAccountChange={value =>
          setEditorState(prev => ({ ...prev, toServiceAccountId: value }))
        }
        onLinkTypeChange={value => setEditorState(prev => ({ ...prev, linkType: value }))}
        onStatusChange={value => setEditorState(prev => ({ ...prev, status: value }))}
        onNoteChange={value => setEditorState(prev => ({ ...prev, note: value }))}
        onPrimaryChange={checked => setEditorState(prev => ({ ...prev, isPrimary: checked }))}
        onDelete={handleDeleteLink}
        onSave={handleSaveLink}
      />
    </div>
  );
}
