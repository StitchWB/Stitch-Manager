import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import type {
  GoogleSheetsAccountAuthLink,
  GoogleSheetsAccountLinkEdge,
  GoogleSheetsAuthMethod,
  GoogleSheetsDataset,
  GoogleSheetsIdentityNode,
  GoogleSheetsProfileLinkEdge,
  GoogleSheetsServiceAccount,
} from '@/types/googleSheets';
import type { NormalizedRow } from '@/types/generated';
import { Button, Select } from '@/components/ui';
import {
  deleteGoogleSheetsAccountLink,
  deleteGoogleSheetsAccountAuthLink,
  deleteGoogleSheetsAuthMethod,
  deleteGoogleSheetsLink,
  deleteGoogleSheetsProfileLink,
  initGoogleSheetsSchema,
  upsertGoogleSheetsAccountLink,
  upsertGoogleSheetsAccountAuthLink,
  upsertGoogleSheetsAuthMethod,
  upsertGoogleSheetsLink,
  upsertGoogleSheetsProfileLink,
} from '@/lib/tauri/modules/googleSheets';
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

interface AccountRelationEditorState {
  accountLinkId: string;
  fromAccount: string;
  toAccount: string;
  linkType: string;
  status: string;
  confidence: string;
}

interface ProfileRelationEditorState {
  profileLinkId: string;
  profileAlias: string;
  account: string;
  relationType: string;
  status: string;
}

interface AuthMethodEditorState {
  authMethodId: string;
  authType: string;
  provider: string;
  principalAccount: string;
  secretRef: string;
  keyFingerprint: string;
  clientName: string;
  status: string;
}

interface AccountAuthLinkEditorState {
  accountAuthLinkId: string;
  account: string;
  authMethodId: string;
  channel: string;
  clientName: string;
  profileAlias: string;
  status: string;
  isPrimary: boolean;
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

const normalizeProviderValue = (value: string | undefined) => {
  const key = normalizeValue(value);
  if (key === 'aws_builder_id' || key === 'aws builder id') return 'aws';
  return key;
};

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

const ensureRelationIdValue = (prefix: string, current?: string) => {
  if (current && current.trim()) return current.trim();
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const packAccountRef = (provider: string, login: string) => `${provider}::${login}`;

const unpackAccountRef = (packed: string) => {
  const [provider = '', login = ''] = packed.split('::');
  return { provider: normalizeProviderValue(provider), login: normalizeValue(login) };
};

const accountRefEqual = (aPacked: string, bProvider: string, bLogin: string) => {
  const a = unpackAccountRef(aPacked);
  return a.provider === normalizeProviderValue(bProvider) && a.login === normalizeValue(bLogin);
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
  const [authEdgeFilter, setAuthEdgeFilter] = useState<'all' | 'auth_only' | 'no_auth'>('all');
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
  const [accountRelationState, setAccountRelationState] = useState<AccountRelationEditorState>({
    accountLinkId: '',
    fromAccount: '',
    toAccount: '',
    linkType: 'signup_email',
    status: 'ok',
    confidence: 'manual',
  });
  const [profileRelationState, setProfileRelationState] = useState<ProfileRelationEditorState>({
    profileLinkId: '',
    profileAlias: '',
    account: '',
    relationType: 'login',
    status: 'active',
  });
  const [savingAccountRelation, setSavingAccountRelation] = useState(false);
  const [savingProfileRelation, setSavingProfileRelation] = useState(false);
  const [deletingAccountRelationId, setDeletingAccountRelationId] = useState<string | null>(null);
  const [deletingProfileRelationId, setDeletingProfileRelationId] = useState<string | null>(null);
  const [authMethodState, setAuthMethodState] = useState<AuthMethodEditorState>({
    authMethodId: '',
    authType: 'api_key',
    provider: '',
    principalAccount: '',
    secretRef: '',
    keyFingerprint: '',
    clientName: 'codex_cli',
    status: 'active',
  });
  const [accountAuthLinkState, setAccountAuthLinkState] = useState<AccountAuthLinkEditorState>({
    accountAuthLinkId: '',
    account: '',
    authMethodId: '',
    channel: 'api',
    clientName: 'codex_cli',
    profileAlias: '',
    status: 'active',
    isPrimary: false,
  });
  const [savingAuthMethod, setSavingAuthMethod] = useState(false);
  const [savingAccountAuthLink, setSavingAccountAuthLink] = useState(false);
  const [deletingAuthMethodId, setDeletingAuthMethodId] = useState<string | null>(null);
  const [deletingAccountAuthLinkId, setDeletingAccountAuthLinkId] = useState<string | null>(null);

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

  const accountOptions = useMemo(() => {
    return localAccounts
      .map(account => ({
        value: packAccountRef(
          normalizeProviderValue(account.provider),
          normalizeValue(account.email)
        ),
        label: `${account.provider}:${account.email}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [localAccounts]);

  const profileOptions = useMemo(() => {
    return localProfiles.map(alias => ({ value: alias, label: alias }));
  }, [localProfiles]);

  const accountLinks = useMemo<GoogleSheetsAccountLinkEdge[]>(
    () => resolvedDataset.identityGraph?.accountLinks ?? [],
    [resolvedDataset]
  );

  const profileLinks = useMemo<GoogleSheetsProfileLinkEdge[]>(
    () => resolvedDataset.identityGraph?.profileLinks ?? [],
    [resolvedDataset]
  );
  const authMethods = useMemo<GoogleSheetsAuthMethod[]>(
    () => resolvedDataset.identityGraph?.authMethods ?? [],
    [resolvedDataset]
  );
  const authMethodById = useMemo(() => {
    return new Map(authMethods.map(method => [method.id, method] as const));
  }, [authMethods]);
  const accountAuthLinks = useMemo<GoogleSheetsAccountAuthLink[]>(
    () => resolvedDataset.identityGraph?.accountAuthLinks ?? [],
    [resolvedDataset]
  );

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

    const providerScoped = {
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

    return providerScoped;
  }, [resolvedDataset, localAccounts, localProfiles, providerFilter]);

  const filteredUnified = useMemo(() => {
    if (authEdgeFilter === 'all') {
      return unified;
    }

    const authKinds = new Set(['account_to_auth_method', 'auth_method_to_profile']);
    const edges = unified.edges.filter(edge =>
      authEdgeFilter === 'auth_only' ? authKinds.has(edge.kind) : !authKinds.has(edge.kind)
    );
    const allowedNodeIds = new Set<string>();
    edges.forEach(edge => {
      allowedNodeIds.add(edge.fromId);
      allowedNodeIds.add(edge.toId);
    });
    const nodes = unified.nodes.filter(
      node =>
        allowedNodeIds.has(node.id) || (authEdgeFilter === 'no_auth' && node.kind === 'identity')
    );

    return {
      ...unified,
      nodes,
      edges,
    };
  }, [unified, authEdgeFilter]);

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

  useEffect(() => {
    if (accountAuthLinkState.channel === 'browser' && !accountAuthLinkState.profileAlias) {
      if (profileOptions.length > 0) {
        setAccountAuthLinkState(prev => ({
          ...prev,
          profileAlias: prev.profileAlias || profileOptions[0].value,
        }));
      }
    }
  }, [accountAuthLinkState.channel, accountAuthLinkState.profileAlias, profileOptions]);

  const activeIdentityLinks = useMemo(() => {
    if (!activeIdentity) return [];
    return parsedLinks.filter(
      link => link.fromIdentityId === activeIdentity.id && link.status !== 'deleted'
    );
  }, [activeIdentity, parsedLinks]);

  const activeIdentityUnifiedEdges = useMemo(() => {
    if (!activeIdentity) return [];
    const fromId = `identity:${activeIdentity.id}`;
    return filteredUnified.edges.filter(edge => edge.fromId === fromId);
  }, [activeIdentity, filteredUnified.edges]);

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

  const handleSaveAccountRelation = async () => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    const from = unpackAccountRef(accountRelationState.fromAccount);
    const to = unpackAccountRef(accountRelationState.toAccount);
    if (!from.provider || !from.login || !to.provider || !to.login) {
      toast.error('From account and to account are required.');
      return;
    }
    if (from.provider === to.provider && from.login === to.login) {
      toast.error('From and to account must be different.');
      return;
    }

    const accountLinkId = ensureRelationIdValue('account_link', accountRelationState.accountLinkId);

    try {
      setSavingAccountRelation(true);
      await upsertGoogleSheetsAccountLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        link: [
          { key: 'account_link_id', value: accountLinkId },
          { key: 'from_account_provider', value: from.provider },
          { key: 'from_account_login', value: from.login },
          { key: 'to_account_provider', value: to.provider },
          { key: 'to_account_login', value: to.login },
          { key: 'link_type', value: accountRelationState.linkType || 'signup_email' },
          { key: 'status', value: accountRelationState.status || 'ok' },
          { key: 'confidence', value: accountRelationState.confidence || 'manual' },
          { key: 'source_system', value: 'identity-graph-ui' },
        ],
      });

      setAccountRelationState(prev => ({ ...prev, accountLinkId }));
      toast.success('Account relation saved');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAccountRelation(false);
    }
  };

  const handleDeleteAccountRelation = async (accountLinkId: string) => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    if (!accountLinkId.trim()) {
      toast.error('Invalid account_link_id');
      return;
    }
    try {
      setDeletingAccountRelationId(accountLinkId);
      await deleteGoogleSheetsAccountLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        accountLinkId,
      });
      toast.success('Account relation deleted');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingAccountRelationId(null);
    }
  };

  const handleSaveProfileRelation = async () => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    if (!profileRelationState.profileAlias) {
      toast.error('Profile alias is required.');
      return;
    }

    const account = unpackAccountRef(profileRelationState.account);
    if (!account.provider || !account.login) {
      toast.error('Account is required.');
      return;
    }

    const profileLinkId = ensureRelationIdValue('profile_link', profileRelationState.profileLinkId);

    try {
      setSavingProfileRelation(true);
      await upsertGoogleSheetsProfileLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        link: [
          { key: 'profile_link_id', value: profileLinkId },
          { key: 'profile_alias', value: profileRelationState.profileAlias },
          { key: 'account_provider', value: account.provider },
          { key: 'account_login', value: account.login },
          { key: 'relation_type', value: profileRelationState.relationType || 'login' },
          { key: 'status', value: profileRelationState.status || 'active' },
          { key: 'source_system', value: 'identity-graph-ui' },
        ],
      });

      setProfileRelationState(prev => ({ ...prev, profileLinkId }));
      toast.success('Profile relation saved');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingProfileRelation(false);
    }
  };

  const handleDeleteProfileRelation = async (profileLinkId: string) => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    if (!profileLinkId.trim()) {
      toast.error('Invalid profile_link_id');
      return;
    }
    try {
      setDeletingProfileRelationId(profileLinkId);
      await deleteGoogleSheetsProfileLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        profileLinkId,
      });
      toast.success('Profile relation deleted');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingProfileRelationId(null);
    }
  };

  const handleSaveAuthMethod = async () => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    if (!authMethodState.authType || !authMethodState.provider) {
      toast.error('Auth type and provider are required.');
      return;
    }
    if (authMethodState.authType === 'api_key' && !authMethodState.secretRef.trim()) {
      toast.error('secret_ref is required for api_key auth type.');
      return;
    }
    if (authMethodState.secretRef.trim().length > 0 && !authMethodState.secretRef.includes(':')) {
      toast.error('secret_ref should look like a vault reference (example: vault:openai/key-1).');
      return;
    }
    const principal = unpackAccountRef(authMethodState.principalAccount);
    const authMethodId = ensureRelationIdValue('auth_method', authMethodState.authMethodId);

    try {
      setSavingAuthMethod(true);
      await upsertGoogleSheetsAuthMethod({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        method: [
          { key: 'auth_method_id', value: authMethodId },
          { key: 'auth_type', value: authMethodState.authType },
          { key: 'provider', value: normalizeProviderValue(authMethodState.provider) },
          { key: 'principal_provider', value: principal.provider || '' },
          { key: 'principal_login', value: principal.login || '' },
          { key: 'secret_ref', value: authMethodState.secretRef || '' },
          { key: 'key_fingerprint', value: authMethodState.keyFingerprint || '' },
          { key: 'client_name', value: authMethodState.clientName || '' },
          { key: 'status', value: authMethodState.status || 'active' },
          { key: 'source_system', value: 'identity-graph-ui' },
        ],
      });

      setAuthMethodState(prev => ({ ...prev, authMethodId }));
      toast.success('Auth method saved');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAuthMethod(false);
    }
  };

  const handleDeleteAuthMethod = async (authMethodId: string) => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    if (!authMethodId.trim()) {
      toast.error('Invalid auth_method_id');
      return;
    }
    try {
      setDeletingAuthMethodId(authMethodId);
      await deleteGoogleSheetsAuthMethod({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        authMethodId,
      });
      toast.success('Auth method deleted');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingAuthMethodId(null);
    }
  };

  const handleSaveAccountAuthLink = async () => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    const account = unpackAccountRef(accountAuthLinkState.account);
    if (!account.provider || !account.login || !accountAuthLinkState.authMethodId) {
      toast.error('Account and auth method are required.');
      return;
    }

    if (
      accountAuthLinkState.channel === 'browser' &&
      !(accountAuthLinkState.profileAlias || '').trim()
    ) {
      toast.error('profile_alias is required when channel=browser.');
      return;
    }

    const accountAuthLinkId = ensureRelationIdValue(
      'account_auth_link',
      accountAuthLinkState.accountAuthLinkId
    );

    try {
      setSavingAccountAuthLink(true);

      const sameAccountLinks = accountAuthLinks.filter(
        link =>
          link.id !== accountAuthLinkId &&
          (link.status || '').toLowerCase() !== 'deleted' &&
          accountRefEqual(accountAuthLinkState.account, link.accountProvider, link.accountLogin)
      );

      if (accountAuthLinkState.isPrimary) {
        const primaryConflicts = sameAccountLinks.filter(link => link.isPrimary);
        if (primaryConflicts.length > 0) {
          toast.warning(
            'Existing primary auth links found for this account. Demoting previous primary links.'
          );
        }

        for (const link of primaryConflicts) {
          await upsertGoogleSheetsAccountAuthLink({
            spreadsheetId: spreadsheetId.trim(),
            serviceAccountJson: serviceAccountJson.trim(),
            link: [
              { key: 'account_auth_link_id', value: link.id },
              { key: 'account_provider', value: link.accountProvider },
              { key: 'account_login', value: link.accountLogin },
              { key: 'auth_method_id', value: link.authMethodId },
              { key: 'channel', value: link.channel || 'api' },
              { key: 'client_name', value: link.clientName || '' },
              { key: 'profile_alias', value: link.profileAlias || '' },
              { key: 'is_primary', value: 'FALSE' },
              { key: 'status', value: link.status || 'active' },
              { key: 'source_system', value: 'identity-graph-ui' },
            ],
          });
        }
      }

      await upsertGoogleSheetsAccountAuthLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        link: [
          { key: 'account_auth_link_id', value: accountAuthLinkId },
          { key: 'account_provider', value: account.provider },
          { key: 'account_login', value: account.login },
          { key: 'auth_method_id', value: accountAuthLinkState.authMethodId },
          { key: 'channel', value: accountAuthLinkState.channel || 'api' },
          { key: 'client_name', value: accountAuthLinkState.clientName || '' },
          { key: 'profile_alias', value: accountAuthLinkState.profileAlias || '' },
          { key: 'is_primary', value: accountAuthLinkState.isPrimary ? 'TRUE' : 'FALSE' },
          { key: 'status', value: accountAuthLinkState.status || 'active' },
          { key: 'source_system', value: 'identity-graph-ui' },
        ],
      });

      setAccountAuthLinkState(prev => ({ ...prev, accountAuthLinkId }));
      toast.success('Account auth link saved');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingAccountAuthLink(false);
    }
  };

  const handleDeleteAccountAuthLink = async (accountAuthLinkId: string) => {
    if (!connectionReady) {
      toast.error('Set Spreadsheet ID and Service Account JSON first.');
      return;
    }
    if (!accountAuthLinkId.trim()) {
      toast.error('Invalid account_auth_link_id');
      return;
    }
    try {
      setDeletingAccountAuthLinkId(accountAuthLinkId);
      await deleteGoogleSheetsAccountAuthLink({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim(),
        accountAuthLinkId,
      });
      toast.success('Account auth link deleted');
      if (onRetry) {
        await onRetry();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingAccountAuthLinkId(null);
    }
  };

  const applyCodexApiPreset = () => {
    setAuthMethodState(prev => ({
      ...prev,
      authType: 'api_key',
      clientName: 'codex_cli',
      status: 'active',
    }));
    setAccountAuthLinkState(prev => ({
      ...prev,
      channel: 'api',
      clientName: 'codex_cli',
      status: 'active',
      profileAlias: '',
    }));
  };

  const applyCodexBrowserPreset = () => {
    setAuthMethodState(prev => ({
      ...prev,
      authType: 'browser_session',
      clientName: 'codex_cli',
      status: 'active',
    }));
    setAccountAuthLinkState(prev => ({
      ...prev,
      channel: 'browser',
      clientName: 'codex_cli',
      status: 'active',
    }));
  };

  const applyQuickFillFromActiveIdentity = () => {
    const identityEmail = normalizeValue(
      activeIdentity?.primaryEmail || activeIdentity?.label || ''
    );
    if (!identityEmail) {
      toast.error('No active identity with email/login to quick-fill from.');
      return;
    }

    const match = accountOptions.find(option => option.value.endsWith(`::${identityEmail}`));
    if (!match) {
      toast.error(`No local account matched active identity login: ${identityEmail}`);
      return;
    }

    setAuthMethodState(prev => ({
      ...prev,
      principalAccount: match.value,
    }));
    setAccountAuthLinkState(prev => ({
      ...prev,
      account: match.value,
    }));
    toast.success('Quick-filled account from active identity');
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

            <div className="rounded-xl border border-white/10 bg-[#111116]/80 p-4 space-y-3">
              <div className="text-sm font-semibold text-white">
                Account Relations (ACCOUNT_LINKS)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Select
                  label="From account"
                  value={accountRelationState.fromAccount}
                  onValueChange={value =>
                    setAccountRelationState(prev => ({ ...prev, fromAccount: value }))
                  }
                  options={accountOptions}
                />
                <Select
                  label="To account"
                  value={accountRelationState.toAccount}
                  onValueChange={value =>
                    setAccountRelationState(prev => ({ ...prev, toAccount: value }))
                  }
                  options={accountOptions}
                />
                <Select
                  label="Type"
                  value={accountRelationState.linkType}
                  onValueChange={value =>
                    setAccountRelationState(prev => ({ ...prev, linkType: value }))
                  }
                  options={[
                    { value: 'signup_email', label: 'signup_email' },
                    { value: 'oauth_authorizer', label: 'oauth_authorizer' },
                    { value: 'recovery_email', label: 'recovery_email' },
                    { value: 'same_owner', label: 'same_owner' },
                  ]}
                />
                <Select
                  label="Status"
                  value={accountRelationState.status}
                  onValueChange={value =>
                    setAccountRelationState(prev => ({ ...prev, status: value }))
                  }
                  options={[
                    { value: 'ok', label: 'ok' },
                    { value: 'unknown', label: 'unknown' },
                    { value: 'broken', label: 'broken' },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveAccountRelation}
                  disabled={savingAccountRelation || !connectionReady}
                >
                  {savingAccountRelation ? 'Saving…' : 'Save account relation'}
                </Button>
                <span className="text-[11px] text-slate-500">
                  Presets: signup_email / oauth_authorizer
                </span>
              </div>
              <div className="space-y-1 max-h-44 overflow-auto pr-1">
                {accountLinks.length ? (
                  accountLinks.map(link => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
                    >
                      <div className="text-[11px] text-slate-300 truncate">
                        {link.fromProvider}:{link.fromLogin} → {link.toProvider}:{link.toLogin} (
                        {link.relation})
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={deletingAccountRelationId === link.id || !connectionReady}
                        onClick={() => handleDeleteAccountRelation(link.id)}
                      >
                        {deletingAccountRelationId === link.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] text-slate-500">No ACCOUNT_LINKS rows yet.</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111116]/80 p-4 space-y-3">
              <div className="text-sm font-semibold text-white">
                Profile Relations (PROFILE_LINKS)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Select
                  label="Profile alias"
                  value={profileRelationState.profileAlias}
                  onValueChange={value =>
                    setProfileRelationState(prev => ({ ...prev, profileAlias: value }))
                  }
                  options={profileOptions}
                />
                <Select
                  label="Account"
                  value={profileRelationState.account}
                  onValueChange={value =>
                    setProfileRelationState(prev => ({ ...prev, account: value }))
                  }
                  options={accountOptions}
                />
                <Select
                  label="Relation"
                  value={profileRelationState.relationType}
                  onValueChange={value =>
                    setProfileRelationState(prev => ({ ...prev, relationType: value }))
                  }
                  options={[
                    { value: 'login', label: 'login' },
                    { value: 'signup', label: 'signup' },
                    { value: 'recovery', label: 'recovery' },
                  ]}
                />
                <Select
                  label="Status"
                  value={profileRelationState.status}
                  onValueChange={value =>
                    setProfileRelationState(prev => ({ ...prev, status: value }))
                  }
                  options={[
                    { value: 'active', label: 'active' },
                    { value: 'inactive', label: 'inactive' },
                    { value: 'deleted', label: 'deleted' },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveProfileRelation}
                  disabled={savingProfileRelation || !connectionReady}
                >
                  {savingProfileRelation ? 'Saving…' : 'Save profile relation'}
                </Button>
                <span className="text-[11px] text-slate-500">
                  Presets: login / signup / recovery
                </span>
              </div>
              <div className="space-y-1 max-h-44 overflow-auto pr-1">
                {profileLinks.length ? (
                  profileLinks.map(link => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
                    >
                      <div className="text-[11px] text-slate-300 truncate">
                        {link.profileAlias} → {link.accountProvider}:{link.accountLogin} (
                        {link.relation})
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={deletingProfileRelationId === link.id || !connectionReady}
                        onClick={() => handleDeleteProfileRelation(link.id)}
                      >
                        {deletingProfileRelationId === link.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] text-slate-500">No PROFILE_LINKS rows yet.</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111116]/80 p-4 space-y-3">
              <div className="text-sm font-semibold text-white">Auth Methods (AUTH_METHODS)</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="xs" variant="secondary" onClick={applyCodexApiPreset}>
                  Preset: CODEX API
                </Button>
                <Button size="xs" variant="secondary" onClick={applyCodexBrowserPreset}>
                  Preset: CODEX Browser
                </Button>
                <Button size="xs" variant="ghost" onClick={applyQuickFillFromActiveIdentity}>
                  Quick fill from selected identity
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Select
                  label="Auth type"
                  value={authMethodState.authType}
                  onValueChange={value =>
                    setAuthMethodState(prev => ({ ...prev, authType: value }))
                  }
                  options={[
                    { value: 'api_key', label: 'api_key' },
                    { value: 'browser_session', label: 'browser_session' },
                    { value: 'oauth_token', label: 'oauth_token' },
                    { value: 'device_flow', label: 'device_flow' },
                  ]}
                />
                <Select
                  label="Provider"
                  value={authMethodState.provider}
                  onValueChange={value =>
                    setAuthMethodState(prev => ({ ...prev, provider: value }))
                  }
                  options={[
                    { value: 'openai', label: 'openai' },
                    { value: 'github', label: 'github' },
                    { value: 'aws', label: 'aws' },
                    { value: 'google', label: 'google' },
                    { value: 'anthropic', label: 'anthropic' },
                  ]}
                />
                <Select
                  label="Principal account"
                  value={authMethodState.principalAccount}
                  onValueChange={value =>
                    setAuthMethodState(prev => ({ ...prev, principalAccount: value }))
                  }
                  options={accountOptions}
                />
                <Select
                  label="Client"
                  value={authMethodState.clientName}
                  onValueChange={value =>
                    setAuthMethodState(prev => ({ ...prev, clientName: value }))
                  }
                  options={[
                    { value: 'codex_cli', label: 'codex_cli' },
                    { value: 'browser', label: 'browser' },
                    { value: 'openai_sdk', label: 'openai_sdk' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  className="h-9 rounded-md border border-white/10 bg-black/30 px-3 text-xs text-white"
                  value={authMethodState.secretRef}
                  onChange={event =>
                    setAuthMethodState(prev => ({ ...prev, secretRef: event.target.value }))
                  }
                  placeholder="secret_ref (never raw key)"
                />
                <input
                  className="h-9 rounded-md border border-white/10 bg-black/30 px-3 text-xs text-white"
                  value={authMethodState.keyFingerprint}
                  onChange={event =>
                    setAuthMethodState(prev => ({ ...prev, keyFingerprint: event.target.value }))
                  }
                  placeholder="key_fingerprint"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveAuthMethod}
                  disabled={savingAuthMethod || !connectionReady}
                >
                  {savingAuthMethod ? 'Saving…' : 'Save auth method'}
                </Button>
                <span className="text-[11px] text-slate-500">
                  Store secret references only, never raw API keys.
                </span>
              </div>
              <div className="space-y-1 max-h-44 overflow-auto pr-1">
                {authMethods.length ? (
                  authMethods.map(method => (
                    <div
                      key={method.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
                    >
                      <div className="text-[11px] text-slate-300 truncate">
                        {method.authType} • {method.provider} • {method.clientName || 'client'} •{' '}
                        {method.keyFingerprint || 'no-fingerprint'}
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={deletingAuthMethodId === method.id || !connectionReady}
                        onClick={() => handleDeleteAuthMethod(method.id)}
                      >
                        {deletingAuthMethodId === method.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] text-slate-500">No AUTH_METHODS rows yet.</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111116]/80 p-4 space-y-3">
              <div className="text-sm font-semibold text-white">
                Account Auth Links (ACCOUNT_AUTH_LINKS)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Select
                  label="Account"
                  value={accountAuthLinkState.account}
                  onValueChange={value =>
                    setAccountAuthLinkState(prev => ({ ...prev, account: value }))
                  }
                  options={accountOptions}
                />
                <Select
                  label="Auth method"
                  value={accountAuthLinkState.authMethodId}
                  onValueChange={value =>
                    setAccountAuthLinkState(prev => ({ ...prev, authMethodId: value }))
                  }
                  options={authMethods.map(method => ({
                    value: method.id,
                    label: `${method.authType}:${method.provider}:${method.clientName || 'client'}`,
                  }))}
                />
                <Select
                  label="Channel"
                  value={accountAuthLinkState.channel}
                  onValueChange={value =>
                    setAccountAuthLinkState(prev => ({ ...prev, channel: value }))
                  }
                  options={[
                    { value: 'api', label: 'api' },
                    { value: 'browser', label: 'browser' },
                    { value: 'cli', label: 'cli' },
                  ]}
                />
                <Select
                  label="Profile"
                  value={accountAuthLinkState.profileAlias}
                  onValueChange={value =>
                    setAccountAuthLinkState(prev => ({ ...prev, profileAlias: value }))
                  }
                  options={[{ value: '', label: '(none)' }, ...profileOptions]}
                />
                <Select
                  label="Primary"
                  value={accountAuthLinkState.isPrimary ? 'yes' : 'no'}
                  onValueChange={value =>
                    setAccountAuthLinkState(prev => ({ ...prev, isPrimary: value === 'yes' }))
                  }
                  options={[
                    { value: 'yes', label: 'yes' },
                    { value: 'no', label: 'no' },
                  ]}
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveAccountAuthLink}
                  disabled={savingAccountAuthLink || !connectionReady}
                >
                  {savingAccountAuthLink ? 'Saving…' : 'Save account auth link'}
                </Button>
                <span className="text-[11px] text-slate-500">
                  Use channel=browser for CODEX browser auth.
                </span>
              </div>
              <div className="space-y-1 max-h-44 overflow-auto pr-1">
                {accountAuthLinks.length ? (
                  accountAuthLinks.map(link => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-white/10 px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-slate-300 truncate">
                          {link.accountProvider}:{link.accountLogin} →{' '}
                          {authMethodById.get(link.authMethodId)?.authType || 'auth'}:
                          {authMethodById.get(link.authMethodId)?.provider || 'provider'}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                              link.channel === 'browser'
                                ? 'bg-blue-500/20 text-blue-200 border border-blue-500/40'
                                : link.channel === 'api'
                                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                                  : 'bg-slate-500/20 text-slate-200 border border-slate-500/40'
                            )}
                          >
                            {link.channel || 'channel'}
                          </span>
                          {link.isPrimary ? (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                              PRIMARY
                            </span>
                          ) : null}
                          {link.profileAlias ? (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-violet-200 bg-violet-500/20 border border-violet-500/40">
                              profile:{link.profileAlias}
                            </span>
                          ) : null}
                          {link.clientName ? (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] text-slate-300 bg-slate-500/20 border border-slate-500/30">
                              {link.clientName}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={deletingAccountAuthLinkId === link.id || !connectionReady}
                        onClick={() => handleDeleteAccountAuthLink(link.id)}
                      >
                        {deletingAccountAuthLinkId === link.id ? 'Deleting…' : 'Delete'}
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="text-[11px] text-slate-500">No ACCOUNT_AUTH_LINKS rows yet.</div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#111116]/80 p-4 space-y-2">
              <div className="text-xs text-slate-400">
                Auth-aware edges in graph now include:
                <span className="ml-2 text-slate-200">account_to_auth_method</span>
                <span className="ml-2 text-slate-200">auth_method_to_profile</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  label="Graph auth edges"
                  value={authEdgeFilter}
                  onValueChange={value =>
                    setAuthEdgeFilter((value as 'all' | 'auth_only' | 'no_auth') || 'all')
                  }
                  options={[
                    { value: 'all', label: 'all edges' },
                    { value: 'auth_only', label: 'auth edges only' },
                    { value: 'no_auth', label: 'without auth edges' },
                  ]}
                />
                <div className="text-[11px] text-slate-500">
                  Showing {filteredUnified.edges.length} edges / {filteredUnified.nodes.length}{' '}
                  nodes
                </div>
              </div>
            </div>
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
