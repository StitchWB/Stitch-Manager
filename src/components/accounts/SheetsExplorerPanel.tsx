import { useMemo, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Search, Table } from 'lucide-react';

import type { GoogleSheetsDataset, GoogleSheetsSheet, GoogleSheetsRow } from '@/types/googleSheets';
import { cn } from '@/lib/utils';
import { ButtonBase, EmptyState, FilterDropdown, Input, TableBody, TableCell, TableHead, TableHeader, TableRow, UITable } from '@/components/ui';


type SheetFilterOption = 'all' | string;

interface SheetsExplorerPanelProps {
  dataset: GoogleSheetsDataset | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onNavigateToGraph?: (payload: {
    sheetName: string;
    serviceAccountId?: string;
    login?: string;
  }) => void;
  className?: string;
}

const emptyDataset: GoogleSheetsDataset = { sheets: [] };

const normalizeValue = (value: string | undefined) => (value ?? '').toLowerCase().trim();

const extractSheetName = (sheet: GoogleSheetsSheet) => sheet.name || sheet.id;

const getSheetOptions = (sheets: GoogleSheetsSheet[]) => {
  const filtered = sheets.filter(sheet => normalizeValue(sheet.name).startsWith('svc_'));
  return [
    { value: 'all', label: 'All SVC sheets', count: filtered.length },
    ...filtered.map(sheet => ({
      value: sheet.id,
      label: sheet.name,
      count: sheet.rowCount ?? sheet.rows.length,
    })),
  ];
};

const getRowValue = (row: GoogleSheetsRow, key: string) => {
  const direct = row[key];
  if (typeof direct === 'string' || typeof direct === 'number') return String(direct);
  if (Array.isArray(direct)) return direct.join(', ');
  if (typeof direct === 'boolean') return direct ? 'true' : 'false';
  return '';
};

const resolvePreviewValue = (row: GoogleSheetsRow, keys: string[]) => {
  for (const key of keys) {
    const value = getRowValue(row, key);
    if (value) return value;
  }
  return '';
};

const getPreviewColumns = (sheet: GoogleSheetsSheet) => {
  const columns = sheet.columns ?? [];
  const normalized = columns.map(col => normalizeValue(col));
  const base = [
    { label: 'Login', keys: ['login', 'email', 'user', 'username'] },
    { label: 'Status', keys: ['status', 'state'] },
    { label: 'Primary Identity', keys: ['primary identity', 'primary_identity', 'identity'] },
    { label: 'Linked Identities', keys: ['linked identities', 'linked_identities', 'links'] },
  ];

  const missing = base.filter(
    col => !col.keys.some(key => normalized.includes(normalizeValue(key)))
  );
  return base.map(col => ({ ...col, missing: missing.includes(col) }));
};

export function SheetsExplorerPanel({
  dataset,
  isLoading = false,
  error,
  onRetry,
  onNavigateToGraph,
  className,
}: SheetsExplorerPanelProps) {
  const [sheetFilter, setSheetFilter] = useState<SheetFilterOption>('all');
  const [query, setQuery] = useState('');

  const resolvedDataset = dataset ?? emptyDataset;
  const svcSheets = useMemo(
    () => resolvedDataset.sheets.filter(sheet => normalizeValue(sheet.name).startsWith('svc_')),
    [resolvedDataset]
  );

  const options = useMemo(() => getSheetOptions(resolvedDataset.sheets), [resolvedDataset]);

  const selectedSheet = useMemo(() => {
    if (sheetFilter === 'all') return svcSheets[0] ?? null;
    return svcSheets.find(sheet => sheet.id === sheetFilter) ?? null;
  }, [sheetFilter, svcSheets]);

  const filteredRows = useMemo(() => {
    if (!selectedSheet) return [];
    const q = normalizeValue(query);
    if (!q) return selectedSheet.rows;
    return selectedSheet.rows.filter(row =>
      Object.values(row).some(
        value => typeof value === 'string' && normalizeValue(value).includes(q)
      )
    );
  }, [selectedSheet, query]);

  const previewColumns = selectedSheet ? getPreviewColumns(selectedSheet) : [];

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      <div className="shrink-0 border-b border-white/5 bg-ds-surface-base/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-white">Sheets Explorer</span>
            <span className="text-slate-500">•</span>
            <span className="tabular-nums">{svcSheets.length} SVC sheets</span>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search rows"
              leftIcon={<Search className="w-3.5 h-3.5" />}
              className="text-xs"
              containerClassName="w-[200px]"
            />
            <FilterDropdown
              value={sheetFilter}
              onChange={value => setSheetFilter(value)}
              options={options}
              placeholder="Sheet"
              showActiveState={true}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {isLoading ? (
          <div className="rounded-xl border border-white/10 bg-ds-surface-overlay/70 p-6 text-sm text-slate-400">
            Loading sheets preview...
          </div>
        ) : null}

        {!isLoading && error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
            {onRetry && (
              <ButtonBase
                type="button"
                onClick={onRetry}
                className="text-xs font-semibold text-rose-200 hover:text-white"
              >
                Retry
              </ButtonBase>
            )}
          </div>
        ) : null}

        {!isLoading && !error && svcSheets.length === 0 ? (
          <EmptyState
            icon={Table}
            title="No SVC_* sheets found"
            description="Ensure your dataset includes service sheets prefixed with SVC_."
          />
        ) : null}

        {!isLoading && !error && selectedSheet ? (
          <div className="rounded-xl border border-white/10 bg-ds-surface-overlay/80 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-white">
                  {extractSheetName(selectedSheet)}
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedSheet.rowCount ?? selectedSheet.rows.length} rows
                </div>
              </div>
              {selectedSheet.updatedAt && (
                <div className="text-[10px] text-slate-500">
                  Updated {new Date(selectedSheet.updatedAt).toLocaleString()}
                </div>
              )}
            </div>

            <UITable>
              <TableHeader>
                <TableRow>
                  {previewColumns.map(col => (
                    <TableHead key={col.label}>{col.label}</TableHead>
                  ))}
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.slice(0, 20).map((row, index) => (
                  <TableRow key={row.rowId ?? `${selectedSheet.id}-${index}`}>
                    {previewColumns.map(col => (
                      <TableCell key={col.label}>
                        {resolvePreviewValue(row, col.keys) || (
                          <span className="text-slate-500">—</span>
                        )}
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ButtonBase
                          type="button"
                          className="text-[10px] px-2 py-1 rounded border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                          onClick={() => {
                            const serviceAccountId = resolvePreviewValue(row, [
                              'service_account_id',
                              'account_id',
                              'id',
                            ]);
                            const login = resolvePreviewValue(row, ['login', 'email', 'username']);
                            onNavigateToGraph?.({
                              sheetName: selectedSheet.name,
                              serviceAccountId: serviceAccountId || undefined,
                              login: login || undefined,
                            });
                          }}
                        >
                          Show in graph
                        </ButtonBase>
                        {dataset?.raw?.spreadsheetId ? (
                          <ButtonBase
                            className="text-[10px] px-2 py-1 rounded border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                            onClick={() => {
                              const url = `https://docs.google.com/spreadsheets/d/${dataset.raw?.spreadsheetId}/edit#gid=${
                                dataset.raw?.services.find(s => s.sheetName === selectedSheet.name)
                                  ?.sheetId ?? 0
                              }`;
                              window.open(url, '_blank', 'noopener,noreferrer');
                            }}
                          >
                            Open sheet
                          </ButtonBase>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </UITable>

            <div className="px-4 py-3 text-[11px] text-slate-500 border-t border-white/5">
              Showing {Math.min(filteredRows.length, 20)} of {filteredRows.length} rows
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
