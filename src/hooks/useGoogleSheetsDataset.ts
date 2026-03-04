import { useCallback, useEffect, useState } from 'react';
import type {
  GoogleSheetsDataset,
  GoogleSheetsIdentityEdge,
  GoogleSheetsIdentityNode,
  GoogleSheetsServiceAccount,
  GoogleSheetsSheet,
} from '@/types/googleSheets';
import type { AccountsGraphDataset, KeyValue, NormalizedRow } from '@/types/generated';
import {
  fetchGoogleSheetsDataset,
  testGoogleSheetsConnection,
  type GoogleSheetsParams,
} from '@/lib/tauri';

type GoogleSheetsDatasetResult = {
  dataset: GoogleSheetsDataset | null;
  isLoading: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
  refresh: () => Promise<void>;
  testConnection: () => Promise<boolean>;
  clearError: () => void;
};

interface UseGoogleSheetsDatasetOptions {
  autoFetch?: boolean;
  params?: GoogleSheetsParams | null;
}

const fallbackDataset = (): GoogleSheetsDataset => ({
  sheets: [],
  errors: ['Google Sheets dataset is unavailable.'],
});

const fallbackFetch = async (): Promise<GoogleSheetsDataset> => fallbackDataset();
const fallbackTest = async (): Promise<boolean> => false;

const cellsToRecord = (cells: KeyValue[]): Record<string, string> => {
  return cells.reduce(
    (acc, kv) => {
      acc[kv.key] = kv.value;
      return acc;
    },
    {} as Record<string, string>
  );
};

const pickFirst = (record: Record<string, string>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
};

const parseList = (value: string): string[] => {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => String(item).trim())
        .filter(Boolean)
        .slice(0, 25);
    }
  } catch {
    // fall through to delimiter parsing
  }
  return trimmed
    .split(/[;,|]/g)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 25);
};

const normalizeServiceName = (sheetName: string): string => {
  const upper = sheetName.toUpperCase();
  return upper.startsWith('SVC_') ? sheetName.slice(4) : sheetName;
};

const normalizeServiceRow = (
  sheetName: string,
  row: NormalizedRow,
  rowRecord: Record<string, string>
): GoogleSheetsServiceAccount => {
  const serviceAccountId = pickFirst(rowRecord, ['service_account_id', 'account_id', 'id']);
  const login = pickFirst(rowRecord, ['login', 'email', 'username']);
  const primaryIdentityId = pickFirst(rowRecord, ['primary_identity_id', 'identity_id']);
  const linked = parseList(
    pickFirst(rowRecord, ['linked_identities', 'linked_identity_ids', 'links'])
  );

  return {
    id: serviceAccountId || `${sheetName}:${row.rowNumber}`,
    service: normalizeServiceName(sheetName),
    login,
    status: pickFirst(rowRecord, ['status', 'state']) || 'unknown',
    identityId: primaryIdentityId || undefined,
    linkedIdentities: linked,
    sheetName,
    metadata: rowRecord,
  };
};

const normalizeIdentityNode = (
  row: NormalizedRow,
  rowRecord: Record<string, string>
): GoogleSheetsIdentityNode => {
  const id =
    pickFirst(rowRecord, ['identity_id', 'id', 'email', 'login']) || `identity:${row.rowNumber}`;
  const label =
    pickFirst(rowRecord, [
      'label',
      'name',
      'display_name',
      'email',
      'login',
      'identity_id',
      'id',
    ]) || id;

  return {
    id,
    label,
    primaryEmail: pickFirst(rowRecord, ['email', 'login']) || undefined,
    status: pickFirst(rowRecord, ['status', 'state']) || 'unknown',
    tags: parseList(pickFirst(rowRecord, ['tags'])),
    linkedIdentities: parseList(pickFirst(rowRecord, ['linked_identities', 'linked_identity_ids'])),
    metadata: rowRecord,
  };
};

const normalizeSheetRows = (rows: NormalizedRow[]): GoogleSheetsSheet['rows'] => {
  return rows.map(row => {
    const rowRecord = cellsToRecord(row.cells);
    const linkedIdentities = parseList(
      pickFirst(rowRecord, ['linked_identities', 'linked_identity_ids', 'links'])
    );

    return {
      rowId: row.rowNumber,
      login: pickFirst(rowRecord, ['login', 'email', 'username']) || undefined,
      status: pickFirst(rowRecord, ['status', 'state']) || undefined,
      primaryIdentity:
        pickFirst(rowRecord, ['primary_identity_id', 'identity_id', 'identity']) || undefined,
      linkedIdentities,
      ...rowRecord,
    };
  });
};

const deriveColumns = (rows: NormalizedRow[]): string[] => {
  const set = new Set<string>();
  rows.forEach(row => {
    row.cells.forEach(cell => {
      if (cell.key) set.add(cell.key);
    });
  });
  return Array.from(set);
};

const mapRawDataset = (raw: AccountsGraphDataset): GoogleSheetsDataset => {
  const identities = raw.identities.map(row => {
    const record = cellsToRecord(row.cells);
    return normalizeIdentityNode(row, record);
  });

  const serviceAccounts: GoogleSheetsServiceAccount[] = [];
  const sheets: GoogleSheetsSheet[] = raw.services.map(serviceSheet => {
    const rows = normalizeSheetRows(serviceSheet.rows);
    serviceSheet.rows.forEach(row => {
      const record = cellsToRecord(row.cells);
      serviceAccounts.push(normalizeServiceRow(serviceSheet.sheetName, row, record));
    });

    return {
      id: serviceSheet.sheetName,
      name: serviceSheet.sheetName,
      rowCount: serviceSheet.rows.length,
      columns: deriveColumns(serviceSheet.rows),
      rows,
    };
  });

  const identityById = new Map(identities.map(identity => [identity.id, identity] as const));
  serviceAccounts.forEach(service => {
    if (service.identityId) {
      const identity = identityById.get(service.identityId);
      if (identity) {
        identity.services = [...(identity.services ?? []), service];
      }
    }
  });

  const linkEdges: GoogleSheetsIdentityEdge[] = raw.links.map(linkRow => {
    const record = cellsToRecord(linkRow.cells);
    const sourceId = pickFirst(record, [
      'from_identity_id',
      'source_identity_id',
      'identity_id',
      'from_id',
    ]);
    const toService = pickFirst(record, ['to_service', 'service', 'to_service_sheet']);
    const toServiceAccountId = pickFirst(record, ['to_service_account_id', 'target_id', 'to_id']);
    const targetId = toServiceAccountId
      ? `${toService || 'service'}:${toServiceAccountId}`
      : pickFirst(record, ['to_identity_id', 'target_identity_id', 'to_id']) ||
        `link:${linkRow.rowNumber}`;

    return {
      id: pickFirst(record, ['link_id', 'id']) || `link:${linkRow.rowNumber}`,
      sourceId: sourceId || 'unknown',
      targetId,
      relation: pickFirst(record, ['link_type', 'relation']) || undefined,
      service: toService || undefined,
    };
  });

  return {
    fetchedAt: new Date().toISOString(),
    source: 'google-sheets',
    identityGraph: {
      identities,
      services: serviceAccounts,
      edges: linkEdges,
    },
    sheets,
    invalidRows: raw.invalidRows,
    raw,
    errors: raw.invalidRows.length
      ? [`Found ${raw.invalidRows.length} invalid row(s) while parsing dataset`]
      : [],
  };
};

export function useGoogleSheetsDataset(
  options: UseGoogleSheetsDatasetOptions = {}
): GoogleSheetsDatasetResult {
  const { autoFetch = true, params = null } = options;
  const [dataset, setDataset] = useState<GoogleSheetsDataset | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const safeFetch = fetchGoogleSheetsDataset ?? fallbackFetch;
  const safeTest = testGoogleSheetsConnection ?? fallbackTest;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (!params) {
        setDataset(fallbackDataset());
        setError('Google Sheets connection details are not configured.');
        return;
      }
      const result = await safeFetch(params as GoogleSheetsParams);
      const mapped = mapRawDataset(result as AccountsGraphDataset);
      setDataset(mapped);
      setLastUpdatedAt(mapped.fetchedAt ?? new Date().toISOString());
      if (mapped.errors?.length) {
        setError(mapped.errors[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDataset(fallbackDataset());
    } finally {
      setIsLoading(false);
    }
  }, [safeFetch, params]);

  const testConnection = useCallback(async () => {
    try {
      if (!params) {
        setError('Google Sheets connection details are not configured.');
        return false;
      }
      const result = await safeTest(params as GoogleSheetsParams);
      if (typeof result === 'boolean') return result;
      if (!result.ok) {
        setError(result.warnings?.[0] ?? 'Google Sheets connection failed.');
      }
      if (result.warnings?.length) {
        setError(result.warnings[0]);
      }
      return result.ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [safeTest, params]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (autoFetch) {
      void refresh();
    }
  }, [autoFetch, refresh]);

  return {
    dataset,
    isLoading,
    error,
    lastUpdatedAt,
    refresh,
    testConnection,
    clearError,
  };
}
