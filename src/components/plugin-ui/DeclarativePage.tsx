import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useParams } from 'react-router-dom';
import { Inbox, Puzzle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { appToast } from '@/lib/observability/toast';
import {
  Button,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
  LoadingSpinner,
  EmptyState,
  GlassCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { CardTemplate, PluginPageSchema, RowAction, UiNode } from './schema';
import { invokeAction } from './bindings';
import { renderMarkdown } from './markdown';

/** Minimal shape of a service-plugin entry returned by list_service_plugins. */
interface ServicePluginInfo {
  id: string;
  version: string;
  status: string;
  ui?: {
    kind: 'declarative' | 'core_page';
    page?: PluginPageSchema;
  };
}

// Invariant: heading-node scale stays one step below the page title (text-2xl).
const headingSizes = [
  'text-xl',
  'text-lg',
  'text-base',
  'text-sm',
  'text-xs',
  'text-xs',
];

/** Centered spinner block for async node loads. */
function NodeLoading() {
  return (
    <div className="flex justify-center py-6">
      <LoadingSpinner size="sm" />
    </div>
  );
}

/** Dashed-border centered empty block shared by table/card_grid/markdown nodes. */
function NodeEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-8 text-center">
      <Inbox className="h-5 w-5 text-slate-600" aria-hidden="true" />
      <p className="text-xs text-slate-500">{message}</p>
    </div>
  );
}

/** Inline error block for malformed/failed node sources. */
function NodeError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
      {message}
    </div>
  );
}

/** Subtle indicator shown while a background refetch keeps stale content on screen. */
function NodeRefreshing() {
  return (
    <div className="flex justify-end py-1" data-testid="node-refreshing" role="status">
      <LoadingSpinner size="sm" />
    </div>
  );
}

/** `autoRetry` → `Auto Retry`; used for the unresolved-i18n-key fallback. */
function humanizeLabelKey(segment: string): string {
  const words = segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .trim();
  if (words === '') return segment;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Resolve a manifest label to display text. Labels are plugin-namespaced
 * i18n keys: text starting with `<pluginId>.` is resolved via
 * `t('plugin.{id}.{text}')` against the plugin's registered bundle (see
 * i18nPluginBundles.ts) — the same convention the scaffold generates and
 * AiHubLayout uses for plugin tab labels. Anything else (plain strings like
 * "ID", "Email", or version strings like "v1.2.3") renders as-is.
 * An unresolved key falls back to the humanized last segment, never the raw key.
 */
function resolveLabel(pluginId: string, text: string): string {
  const prefix = `${pluginId}.`;
  if (!text.startsWith(prefix)) return text;
  const key = `plugin.${pluginId}.${text}`;
  const resolved = t(key);
  if (resolved !== key) return resolved;
  const remainder = text.slice(prefix.length);
  const lastSegment = remainder.split('.').pop() ?? remainder;
  return humanizeLabelKey(lastSegment);
}

function hashRowContent(row: Record<string, unknown>): string {
  const serialized = JSON.stringify(row);
  let hash = 0;
  for (let i = 0; i < serialized.length; i += 1) {
    hash = (hash * 31 + serialized.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

/** Stable React/busy-state key: row id column first, content hash + index as fallback. */
function stableRowKey(row: Record<string, unknown>, index: number): string {
  const id = row.id;
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return `${hashRowContent(row)}:${index}`;
}

/** Value held in the page-level field state map. */
type FieldValue = string | boolean;

/** Page-scoped controlled field state threaded through renderNode. */
interface FieldBinding {
  values: Record<string, FieldValue>;
  onChange: (fieldId: string, value: FieldValue) => void;
}

/**
 * Collect the initial value of every field node in the schema
 * (`node.value ?? ''`; toggles default to `false` so bindings send a real
 * boolean). Fields nested inside section nodes participate in the same
 * page-scoped map — state is page-level, not section-level.
 *
 * Duplicate field ids within the same page silently overwrite (last-wins)
 * but emit a one-time `console.warn` per plugin+id pair so manifest
 * authors can catch the bug. The warn-once registry is module-level so
 * repeated renders of the same plugin page don't spam the console.
 */
const duplicateFieldIdWarnings = new Set<string>();

function collectInitialFieldValues(
  pluginId: string,
  nodes: UiNode[],
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  const seen = new Set<string>();
  const walk = (list: UiNode[]): void => {
    for (const node of list) {
      if (node.kind === 'field') {
        if (seen.has(node.id)) {
          const warnKey = `${pluginId}.${node.id}`;
          if (!duplicateFieldIdWarnings.has(warnKey)) {
            duplicateFieldIdWarnings.add(warnKey);
            console.warn(
              `DeclarativePage: duplicate field id "${node.id}" in plugin ` +
                `"${pluginId}" — last value wins`,
            );
          }
        }
        seen.add(node.id);
        out[node.id] = node.value ?? (node.field === 'toggle' ? false : '');
      } else if (node.kind === 'section') {
        walk(node.nodes ?? []);
      }
    }
  };
  walk(nodes);
  return out;
}

/** Warn-once registry for buttons whose paramsFrom references a missing field. */
const missingParamsFromWarnings = new Set<string>();

/** Warn-once registry for row actions whose paramsFromRow references a missing column. */
const missingRowParamWarnings = new Set<string>();

/** Floor for `source.refreshMs` polling — manifests asking for less are capped. */
const MIN_REFRESH_MS = 2000;

// RPC result envelope keys — stripped only when the payload matches the envelope shape.
const SUCCESS_ENVELOPE_KEYS = new Set(['success', 'error']);
const DEFERRED_ENVELOPE_KEYS = new Set(['accepted', 'actionId', 'reason']);

/**
 * Envelope keys to strip from a payload, or null when it is plain command
 * output. `{success:boolean, error?}` and `{accepted:boolean, actionId, reason?}`
 * are the two RPC envelope conventions plugin handlers use; a `reason` field
 * on a non-deferred payload is business data and must survive.
 */
function envelopeKeysFor(payload: Record<string, unknown>): ReadonlySet<string> | null {
  if (typeof payload.success === 'boolean') return SUCCESS_ENVELOPE_KEYS;
  if (typeof payload.accepted === 'boolean' && 'actionId' in payload) {
    return DEFERRED_ENVELOPE_KEYS;
  }
  return null;
}

interface CommandOutcome {
  ok: boolean;
  /** Success payload when it is a plain object (dialog surface input). */
  payload?: Record<string, unknown>;
}

interface CommandResultEntry {
  key: string;
  value: string;
}

/** Business-error text of a resolved payload; null when it is not a business error. */
function businessErrorText(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.success === false) {
    return typeof record.error === 'string' && record.error !== ''
      ? record.error
      : t('pluginUi.actionFailed');
  }
  if (record.accepted === false) {
    return typeof record.reason === 'string' && record.reason !== ''
      ? record.reason
      : t('pluginUi.actionFailed');
  }
  return null;
}

/** Non-empty string fields of a success payload, envelope keys excluded. */
function copyableEntries(payload?: Record<string, unknown>): CommandResultEntry[] {
  if (!payload) return [];
  const envelopeKeys = envelopeKeysFor(payload);
  const entries: CommandResultEntry[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (envelopeKeys?.has(key)) continue;
    if (typeof value === 'string' && value !== '') entries.push({ key, value });
  }
  return entries;
}

/** Shared invoke path: success → actionSucceeded toast, business error → error toast with the reason text. */
async function runPluginCommand(
  pluginId: string,
  command: string,
  params?: Record<string, unknown>,
): Promise<CommandOutcome> {
  try {
    const payload = await invokeAction<unknown>(pluginId, command, params);
    const errorText = businessErrorText(payload);
    if (errorText !== null) {
      appToast.error(errorText);
      return { ok: false };
    }
    appToast.success(t('pluginUi.actionSucceeded'));
    return {
      ok: true,
      payload:
        payload != null && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : undefined,
    };
  } catch {
    appToast.error(t('pluginUi.actionFailed'));
    return { ok: false };
  }
}

/** Copyable surface for success payloads carrying string output (devbox `issue_tokens` → `{chatBlock}`). */
function CommandResultDialog({
  entries,
  onClose,
}: {
  entries: CommandResultEntry[];
  onClose: () => void;
}) {
  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      appToast.success(t('pluginUi.copied'));
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={t('pluginUi.actionSucceeded')} size="sm">
      <div className="space-y-4">
        {entries.map(entry => (
          <div key={entry.key} className="space-y-1.5">
            <div className="text-xs font-medium text-slate-400">{entry.key}</div>
            <Textarea
              readOnly
              rows={Math.min(8, entry.value.split('\n').length + 1)}
              value={entry.value}
              data-testid={`command-result-${entry.key}`}
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              data-testid={`copy-${entry.key}`}
              onClick={() => void handleCopy(entry.value)}
            >
              {t('common.copy')}
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/** Page-scoped refetch wiring: per-node bump signals + the button entry point. */
interface RefreshBinding {
  signals: Record<string, number>;
  request: (nodeIds: string[]) => void;
}

/** `source.refreshMs` polling: bumps the node's fetch key on an interval, capped at MIN_REFRESH_MS. */
function useRefreshInterval(refreshMs: number | undefined, bump: () => void) {
  useEffect(() => {
    if (typeof refreshMs !== 'number' || refreshMs <= 0) return;
    const timer = setInterval(bump, Math.max(refreshMs, MIN_REFRESH_MS));
    return () => clearInterval(timer);
  }, [refreshMs, bump]);
}

/** Readonly toggle bound to a fetched source value (`field.source` + `valueKey`, default "value"). */
function SourceToggle({
  pluginId,
  node,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'field' }>;
}) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const bump = useCallback(() => setFetchKey(k => k + 1), []);
  const source = node.source;
  const command = source?.command;

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const commandMissing = typeof command !== 'string' || command === '';
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync error state before the async fetch
    setError(commandMissing ? 'Toggle source is missing a command' : null);
    if (commandMissing) return;
    invokeAction<unknown>(pluginId, command, source.params)
      .then(resp => {
        if (cancelled) return;
        const valueKey = node.valueKey ?? 'value';
        if (resp != null && typeof resp === 'object') {
          setChecked((resp as Record<string, unknown>)[valueKey] === true);
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, source, command, node.valueKey, fetchKey]);

  useRefreshInterval(source?.refreshMs, bump);

  return (
    <div className="space-y-2">
      <Toggle
        label={resolveLabel(pluginId, node.label)}
        checked={checked}
        disabled
        onChange={() => undefined}
      />
      {error && <NodeError message={error} />}
    </div>
  );
}

function renderNode(
  pluginId: string,
  node: UiNode,
  index: number,
  fields: FieldBinding,
  refresh: RefreshBinding,
) {
  switch (node.kind) {
    case 'heading': {
      const level = Math.min(Math.max(node.level ?? 1, 1), 6);
      return (
        <div
          key={index}
          className={`${headingSizes[level - 1]} font-semibold tracking-tight text-slate-100`}
        >
          {resolveLabel(pluginId, node.text)}
        </div>
      );
    }
    case 'section':
      return (
        <div
          key={index}
          className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
        >
          {node.title && (
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {resolveLabel(pluginId, node.title)}
            </div>
          )}
          {renderNodeList(pluginId, node.nodes ?? [], fields, refresh)}
        </div>
      );
    case 'field': {
      const label = resolveLabel(pluginId, node.label);
      const placeholder =
        node.placeholder !== undefined
          ? resolveLabel(pluginId, node.placeholder)
          : undefined;
      const value = fields.values[node.id];
      if (node.field === 'text') {
        return (
          <div key={index} className="max-w-md">
            <Input
              label={label}
              value={String(value ?? '')}
              placeholder={placeholder}
              readOnly={node.readonly}
              onChange={e => fields.onChange(node.id, e.target.value)}
            />
          </div>
        );
      }
      if (node.field === 'select') {
        return (
          <div key={index} className="max-w-md">
            <Select
              label={label}
              value={String(value ?? '')}
              placeholder={placeholder}
              options={(node.options ?? []).map(opt => ({
                ...opt,
                label: resolveLabel(pluginId, opt.label),
              }))}
              disabled={node.readonly}
              onChange={e => fields.onChange(node.id, e.target.value)}
            />
          </div>
        );
      }
      // toggle
      if (node.source) {
        return <SourceToggle key={index} pluginId={pluginId} node={node} />;
      }
      return (
        <Toggle
          key={index}
          label={label}
          checked={Boolean(value)}
          onChange={v => fields.onChange(node.id, v)}
          disabled={node.readonly}
        />
      );
    }
    case 'table':
      return (
        <TableNode
          key={index}
          pluginId={pluginId}
          node={node}
          refreshSignal={refresh.signals[node.id] ?? 0}
        />
      );
    case 'button':
      return (
        <ButtonNode
          key={index}
          pluginId={pluginId}
          node={node}
          fieldValues={fields.values}
          onRefresh={refresh.request}
        />
      );
    case 'card_grid':
      return (
        <CardGridNode
          key={index}
          pluginId={pluginId}
          node={node}
          refreshSignal={refresh.signals[node.id] ?? 0}
        />
      );
    case 'markdown':
      return (
        <MarkdownNode
          key={index}
          pluginId={pluginId}
          node={node}
          refreshSignal={refresh.signals[node.id] ?? 0}
        />
      );
    default: {
      // Tolerant reader: future node kinds not in the type union yet.
      const kind = (node as { kind: string }).kind;
      console.warn(`Unknown plugin UI node kind: ${kind}`);
      return null;
    }
  }
}

/** Render a node list, grouping consecutive button nodes into one wrapping row. */
function renderNodeList(
  pluginId: string,
  nodes: UiNode[],
  fields: FieldBinding,
  refresh: RefreshBinding,
): ReactNode[] {
  const out: ReactNode[] = [];
  let run: number[] = [];
  const flushRun = (): void => {
    if (run.length === 0) return;
    out.push(
      <div key={`buttons-${run[0]}`} className="flex flex-wrap items-center gap-2">
        {run.map(i => renderNode(pluginId, nodes[i], i, fields, refresh))}
      </div>,
    );
    run = [];
  };
  nodes.forEach((node, i) => {
    if (node.kind === 'button') {
      run.push(i);
      return;
    }
    flushRun();
    out.push(renderNode(pluginId, node, i, fields, refresh));
  });
  flushRun();
  return out;
}

function TableNode({
  pluginId,
  node,
  refreshSignal,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'table' }>;
  refreshSignal: number;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by row actions, refreshMs polling and refreshOnSuccess to re-run the source command.
  const [fetchKey, setFetchKey] = useState(0);
  // `${rowKey}:${actionId}` of the in-flight row action, if any.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const loadedOnce = useRef(false);
  const bump = useCallback(() => setFetchKey(k => k + 1), []);
  const command = node.source?.command;
  const sourceParams = node.source?.params;
  useRefreshInterval(node.source?.refreshMs, bump);

  useEffect(() => {
    if (typeof command !== 'string' || command === '') return;
    let cancelled = false;
    if (loadedOnce.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch keeps stale rows visible
      setRefreshing(true);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load must spin before the async fetch
      setLoading(true);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stale error must clear before the async fetch
    setError(null);
    invokeAction<Record<string, unknown> | Record<string, unknown>[]>(
      pluginId,
      command,
      sourceParams,
    )
      .then(resp => {
        if (cancelled) return;
        loadedOnce.current = true;
        setRefreshing(false);
        setLoading(false);
        // null/undefined → empty state (no rows, no error).
        if (resp == null) {
          setRows([]);
          return;
        }
        // Bare array of rows.
        if (Array.isArray(resp)) {
          setRows(resp as Record<string, unknown>[]);
          return;
        }
        // Object wrapping rows under `rowsKey` (default "rows").
        const rowsKey = node.rowsKey ?? 'rows';
        const data = (resp as Record<string, unknown>)[rowsKey];
        if (Array.isArray(data)) {
          setRows(data as Record<string, unknown>[]);
          return;
        }
        // Malformed response: non-null, non-array, no rowsKey — show an
        // inline error instead of silently rendering the empty state.
        setError(
          `Table response missing rowsKey "${rowsKey}"`,
        );
      })
      .catch(err => {
        if (cancelled) return;
        loadedOnce.current = true;
        setRefreshing(false);
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, command, sourceParams, node.rowsKey, fetchKey, refreshSignal]);

  const rowActions = node.rowActions ?? [];

  const handleRowAction = async (
    action: RowAction,
    row: Record<string, unknown>,
    rowKeyValue: string,
  ) => {
    // Destructive actions confirm before invoking; declining aborts
    // without calling the command.
    if (
      action.variant === 'danger' &&
      !window.confirm(t('pluginUi.confirmRowAction'))
    ) {
      return;
    }
    // Static params first, then paramsFromRow entries resolved from the
    // clicked row — the row analogue of ButtonNode's paramsFrom merge.
    const params: Record<string, unknown> = { ...(action.params ?? {}) };
    for (const [paramKey, columnKey] of Object.entries(
      action.paramsFromRow ?? {},
    )) {
      if (columnKey in row) {
        params[paramKey] = row[columnKey];
      } else {
        // Manifest bug: referenced column does not exist on the row.
        // Omit the key entirely and warn once per table+action+param.
        delete params[paramKey];
        const warnKey = `${pluginId}.${node.id}.${action.id}.${paramKey}`;
        if (!missingRowParamWarnings.has(warnKey)) {
          missingRowParamWarnings.add(warnKey);
          console.warn(
            `DeclarativePage: row action "${action.id}" in table ` +
              `"${node.id}" paramsFromRow references unknown column ` +
              `"${columnKey}" — param "${paramKey}" omitted`,
          );
        }
      }
    }
    setBusyAction(`${rowKeyValue}:${action.id}`);
    try {
      const { ok } = await runPluginCommand(pluginId, action.command, params);
      // Refresh the rows so the mutation is visible immediately.
      if (ok) setFetchKey(k => k + 1);
    } finally {
      setBusyAction(null);
    }
  };

  if (!Array.isArray(node.columns)) {
    return <NodeError message="Table node is missing columns" />;
  }
  if (typeof command !== 'string' || command === '') {
    return <NodeError message="Table source is missing a command" />;
  }
  if (loading) return <NodeLoading />;
  if (error) return <NodeError message={error} />;
  if (rows.length === 0) {
    return (
      <NodeEmpty
        message={node.empty ? resolveLabel(pluginId, node.empty) : t('pluginUi.noData')}
      />
    );
  }

  return (
    <div className="space-y-2">
      {refreshing && <NodeRefreshing />}
      <div className="overflow-hidden rounded-xl border border-white/[0.06]">
        <Table className="w-full" containerClassName="overflow-x-auto">
          <TableHeader className="bg-white/[0.03]">
            <TableRow className="border-b border-white/[0.06] hover:bg-transparent">
              {node.columns.map(col => (
                <TableHead
                  key={col.key}
                  className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                >
                  {resolveLabel(pluginId, col.label)}
                </TableHead>
              ))}
              {rowActions.length > 0 && <TableHead className="px-4 py-2.5" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const key = stableRowKey(row, i);
              return (
                <TableRow key={key} className="border-b border-white/[0.04] last:border-b-0">
                  {node.columns.map(col => (
                    <TableCell key={col.key} className="px-4 py-2 text-xs text-slate-300">
                      {String(row[col.key] ?? '')}
                    </TableCell>
                  ))}
                  {rowActions.length > 0 && (
                    <TableCell key="__row_actions" className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        {rowActions.map(action => (
                          <Button
                            key={action.id}
                            size="xs"
                            variant={action.variant ?? 'secondary'}
                            isLoading={busyAction === `${key}:${action.id}`}
                            onClick={() => handleRowAction(action, row, key)}
                          >
                            {resolveLabel(pluginId, action.label)}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ButtonNode({
  pluginId,
  node,
  fieldValues,
  onRefresh,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'button' }>;
  fieldValues: Record<string, FieldValue>;
  onRefresh: (nodeIds: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [resultEntries, setResultEntries] = useState<CommandResultEntry[] | null>(null);

  const handleClick = async () => {
    // danger buttons confirm via the row-action key when no explicit confirm text is given.
    const confirmText = node.confirm
      ? resolveLabel(pluginId, node.confirm)
      : node.variant === 'danger'
        ? t('pluginUi.confirmRowAction')
        : undefined;
    if (confirmText !== undefined && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      // Without paramsFrom the button sends its static params unchanged.
      let params: Record<string, unknown> | undefined = node.params;
      if (node.paramsFrom) {
        // Start from the static params, then override every key listed in
        // paramsFrom with the current value of the referenced field.
        const merged: Record<string, unknown> = { ...(node.params ?? {}) };
        for (const [paramKey, fieldId] of Object.entries(node.paramsFrom)) {
          if (fieldId in fieldValues) {
            merged[paramKey] = fieldValues[fieldId];
          } else {
            // Manifest bug: referenced field does not exist on the page.
            // Omit the key entirely and warn once per button+param.
            delete merged[paramKey];
            const warnKey = `${pluginId}.${node.id}.${paramKey}`;
            if (!missingParamsFromWarnings.has(warnKey)) {
              missingParamsFromWarnings.add(warnKey);
              console.warn(
                `DeclarativePage: button "${node.id}" paramsFrom references ` +
                  `unknown field "${fieldId}" — param "${paramKey}" omitted`,
              );
            }
          }
        }
        params = merged;
      }
      const { ok, payload } = await runPluginCommand(pluginId, node.command, params);
      if (ok) {
        const entries = copyableEntries(payload);
        if (entries.length > 0) setResultEntries(entries);
        if (node.refreshOnSuccess && node.refreshOnSuccess.length > 0) {
          onRefresh(node.refreshOnSuccess);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant={node.variant ?? 'primary'}
        isLoading={busy}
        onClick={handleClick}
      >
        {resolveLabel(pluginId, node.label)}
      </Button>
      {resultEntries && (
        <CommandResultDialog
          entries={resultEntries}
          onClose={() => setResultEntries(null)}
        />
      )}
    </>
  );
}

/**
 * Resolve a card template field against a row: the template string is
 * FIRST treated as a column key of the row — if the row has that key its
 * value is rendered ('' for null/undefined); otherwise the template
 * string renders literally (static text / literal image URL).
 */
function resolveCardField(
  row: Record<string, unknown>,
  template: string | undefined,
): string {
  if (template === undefined) return '';
  if (template in row) {
    const value = row[template];
    return value == null ? '' : String(value);
  }
  return template;
}

/** Card status tone → dot color + border color; unknown tones render neutral. */
const TONE_STYLES: Record<string, { dot: string; border: string }> = {
  ok: { dot: 'bg-emerald-400', border: 'border-emerald-500/40' },
  warn: { dot: 'bg-amber-400', border: 'border-amber-500/40' },
  down: { dot: 'bg-red-400', border: 'border-red-500/40' },
};

function CardGridNode({
  pluginId,
  node,
  refreshSignal,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'card_grid' }>;
  refreshSignal: number;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by card actions, refreshMs polling and refreshOnSuccess to re-run the source command.
  const [fetchKey, setFetchKey] = useState(0);
  // Stable key of the card whose action is in flight, if any.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const loadedOnce = useRef(false);
  const bump = useCallback(() => setFetchKey(k => k + 1), []);
  const command = node.source?.command;
  const sourceParams = node.source?.params;
  const card = node.card as CardTemplate | undefined;
  useRefreshInterval(node.source?.refreshMs, bump);

  useEffect(() => {
    if (typeof command !== 'string' || command === '') return;
    let cancelled = false;
    if (loadedOnce.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch keeps stale cards visible
      setRefreshing(true);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load must spin before the async fetch
      setLoading(true);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stale error must clear before the async fetch
    setError(null);
    invokeAction<Record<string, unknown> | Record<string, unknown>[]>(
      pluginId,
      command,
      sourceParams,
    )
      .then(resp => {
        if (cancelled) return;
        loadedOnce.current = true;
        setRefreshing(false);
        setLoading(false);
        // null/undefined → empty state (no cards, no error).
        if (resp == null) {
          setRows([]);
          return;
        }
        // Bare array of rows.
        if (Array.isArray(resp)) {
          setRows(resp as Record<string, unknown>[]);
          return;
        }
        // Object wrapping rows under "rows" (table default rowsKey;
        // card_grid has no configurable rowsKey field).
        const data = (resp as Record<string, unknown>).rows;
        if (Array.isArray(data)) {
          setRows(data as Record<string, unknown>[]);
          return;
        }
        // Malformed response — inline error like TableNode.
        setError('Card grid response missing "rows"');
      })
      .catch(err => {
        if (cancelled) return;
        loadedOnce.current = true;
        setRefreshing(false);
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, command, sourceParams, fetchKey, refreshSignal]);

  const action = card?.action;

  const handleAction = async (
    row: Record<string, unknown>,
    rowKeyValue: string,
  ) => {
    if (!action) return;
    // Destructive actions confirm before invoking; declining aborts
    // without calling the command (same key as table row actions).
    if (
      action.variant === 'danger' &&
      !window.confirm(t('pluginUi.confirmRowAction'))
    ) {
      return;
    }
    // Static params first, then paramsFromRow entries resolved from the
    // clicked card's row — identical to TableNode's rowAction merge.
    const params: Record<string, unknown> = { ...(action.params ?? {}) };
    for (const [paramKey, columnKey] of Object.entries(
      action.paramsFromRow ?? {},
    )) {
      if (columnKey in row) {
        params[paramKey] = row[columnKey];
      } else {
        // Manifest bug: referenced column does not exist on the row.
        // Omit the key entirely and warn once per grid+param.
        delete params[paramKey];
        const warnKey = `${pluginId}.${node.id}.${paramKey}`;
        if (!missingRowParamWarnings.has(warnKey)) {
          missingRowParamWarnings.add(warnKey);
          console.warn(
            `DeclarativePage: card grid "${node.id}" action paramsFromRow ` +
              `references unknown column "${columnKey}" — param ` +
              `"${paramKey}" omitted`,
          );
        }
      }
    }
    setBusyAction(rowKeyValue);
    try {
      const { ok } = await runPluginCommand(pluginId, action.command, params);
      // Refresh the rows so the mutation is visible immediately.
      if (ok) setFetchKey(k => k + 1);
    } finally {
      setBusyAction(null);
    }
  };

  if (!card || typeof card !== 'object') {
    return <NodeError message="Card grid node is missing the card template" />;
  }
  if (typeof command !== 'string' || command === '') {
    return <NodeError message="Card grid source is missing a command" />;
  }
  if (loading) return <NodeLoading />;
  if (error) return <NodeError message={error} />;
  if (rows.length === 0) {
    return (
      <NodeEmpty
        message={node.empty ? resolveLabel(pluginId, node.empty) : t('pluginUi.noData')}
      />
    );
  }

  return (
    <div className="space-y-2">
      {refreshing && <NodeRefreshing />}
      <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row, i) => {
          const key = stableRowKey(row, i);
          const title = resolveCardField(row, card.title);
          const subtitle = resolveCardField(row, card.subtitle);
          const body = resolveCardField(row, card.body);
          const imageSrc = resolveCardField(row, card.image);
          const tone = resolveCardField(row, card.tone);
          const toneStyle = TONE_STYLES[tone];
          const hintRaw = resolveCardField(row, card.hint);
          const hint = hintRaw ? resolveLabel(pluginId, hintRaw) : '';
          return (
            <GlassCard
              key={key}
              className={cn('flex h-full flex-col overflow-hidden', toneStyle?.border)}
            >
              {imageSrc && (
                <img
                  src={imageSrc}
                  alt={title}
                  className="h-32 w-full shrink-0 object-cover"
                />
              )}
              <div className="flex flex-col gap-1 p-4">
                <div className="flex items-center gap-2">
                  {toneStyle && (
                    <span
                      aria-hidden="true"
                      data-tone={tone}
                      className={cn('h-2 w-2 shrink-0 rounded-full', toneStyle.dot)}
                    />
                  )}
                  <span className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">
                    {title}
                  </span>
                </div>
                {subtitle && (
                  <div
                    title={subtitle}
                    className="truncate text-lg font-semibold tabular-nums text-white"
                  >
                    {subtitle}
                  </div>
                )}
                {body && (
                  <div className="text-xs leading-relaxed text-slate-300">
                    {body}
                  </div>
                )}
                {hint && (
                  <div className="text-[11px] text-slate-500">{hint}</div>
                )}
                {action && (
                  <div className="mt-2">
                    <Button
                      size="xs"
                      variant={action.variant ?? 'secondary'}
                      isLoading={busyAction === key}
                      onClick={() => handleAction(row, key)}
                    >
                      {resolveLabel(pluginId, action.label)}
                    </Button>
                  </div>
                )}
              </div>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

function MarkdownNode({
  pluginId,
  node,
  refreshSignal,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'markdown' }>;
  refreshSignal: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped by refreshMs polling and refreshOnSuccess to re-run the source command.
  const [fetchKey, setFetchKey] = useState(0);
  const loadedOnce = useRef(false);
  const bump = useCallback(() => setFetchKey(k => k + 1), []);
  const command = node.source?.command;
  const sourceParams = node.source?.params;
  useRefreshInterval(node.source?.refreshMs, bump);

  useEffect(() => {
    if (typeof command !== 'string' || command === '') return;
    let cancelled = false;
    if (loadedOnce.current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch keeps stale text visible
      setRefreshing(true);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load must spin before the async fetch
      setLoading(true);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- stale error must clear before the async fetch
    setError(null);
    invokeAction<unknown>(pluginId, command, sourceParams)
      .then(resp => {
        if (cancelled) return;
        loadedOnce.current = true;
        setRefreshing(false);
        setLoading(false);
        // null/undefined → empty state (no text, no error).
        if (resp == null) {
          setText(null);
          return;
        }
        // Bare string response is accepted as the markdown text directly
        // (the string analogue of the table node's bare-array tolerance).
        if (typeof resp === 'string') {
          setText(resp);
          return;
        }
        // Object carrying the markdown under `textKey` (default "text").
        if (typeof resp === 'object') {
          const textKey = node.textKey ?? 'text';
          const value = (resp as Record<string, unknown>)[textKey];
          if (typeof value === 'string') {
            setText(value);
            return;
          }
          // Malformed response — inline error like TableNode.
          setError(`Markdown response missing textKey "${textKey}"`);
          return;
        }
        setError(`Markdown response missing textKey "${node.textKey ?? 'text'}"`);
      })
      .catch(err => {
        if (cancelled) return;
        loadedOnce.current = true;
        setRefreshing(false);
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, command, sourceParams, node.textKey, fetchKey, refreshSignal]);

  if (typeof command !== 'string' || command === '') {
    return <NodeError message="Markdown source is missing a command" />;
  }
  if (loading) return <NodeLoading />;
  if (error) return <NodeError message={error} />;
  if (!text) {
    return (
      <NodeEmpty
        message={node.empty ? resolveLabel(pluginId, node.empty) : t('pluginUi.noData')}
      />
    );
  }

  return (
    <div className="space-y-2">
      {refreshing && <NodeRefreshing />}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        {renderMarkdown(text)}
      </div>
    </div>
  );
}

interface DeclarativePageProps {
  pluginId: string;
  schema: PluginPageSchema;
}

interface PluginUiErrorBoundaryState {
  failed: boolean;
}

/** Last-resort fallback so a malformed manifest cannot blank the whole host route. */
class PluginUiErrorBoundary extends Component<
  { children: ReactNode },
  PluginUiErrorBoundaryState
> {
  state: PluginUiErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): PluginUiErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      'DeclarativePage: plugin UI failed to render',
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
          <NodeError message="Plugin UI failed to render" />
        </div>
      );
    }
    return this.props.children;
  }
}

function DeclarativePageContent({ pluginId, schema }: DeclarativePageProps) {
  // Tolerant of malformed manifests: a missing/non-array `nodes` renders an
  // empty page instead of crashing the whole host route.
  const nodes = Array.isArray(schema?.nodes) ? schema.nodes : [];

  // Page-level controlled field state: every field node (including fields
  // nested in sections) contributes its initial value at schema load; input
  // changes write back into this map and buttons read it via paramsFrom.
  const [fieldValues, setFieldValues] = useState<Record<string, FieldValue>>(
    () => collectInitialFieldValues(pluginId, nodes),
  );
  const handleFieldChange = useCallback((fieldId: string, value: FieldValue) => {
    setFieldValues(prev => ({ ...prev, [fieldId]: value }));
  }, []);
  const fields: FieldBinding = { values: fieldValues, onChange: handleFieldChange };

  const [refreshSignals, setRefreshSignals] = useState<Record<string, number>>({});
  const requestRefresh = useCallback((nodeIds: string[]) => {
    setRefreshSignals(prev => {
      const next = { ...prev };
      for (const id of nodeIds) next[id] = (next[id] ?? 0) + 1;
      return next;
    });
  }, []);
  const refresh: RefreshBinding = { signals: refreshSignals, request: requestRefresh };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      {schema?.title && (
        <h1 className="text-2xl font-bold tracking-tight text-white">
          {resolveLabel(pluginId, schema.title)}
        </h1>
      )}
      {renderNodeList(pluginId, nodes, fields, refresh)}
    </div>
  );
}

function DeclarativePage(props: DeclarativePageProps) {
  return (
    <PluginUiErrorBoundary>
      <DeclarativePageContent {...props} />
    </PluginUiErrorBoundary>
  );
}

export function PluginPageHost() {
  const { id } = useParams<{ id: string }>();
  const [plugin, setPlugin] = useState<ServicePluginInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync loading flag before async fetch ensures spinner shows during refetch
    setLoading(true);
    setNotInstalled(false);
    safeInvoke<ServicePluginInfo[]>('list_service_plugins')
      .then(plugins => {
        if (cancelled) return;
        const found = plugins?.find(p => p.id === id) ?? null;
        setPlugin(found);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNotInstalled(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (notInstalled || !plugin) {
    return (
      <EmptyState
        icon={Puzzle}
        title={t('pluginUi.pluginNotInstalled')}
        description={t('pluginUi.pluginNotInstalledDescription')}
      />
    );
  }

  const ui = plugin.ui;
  if (ui?.kind === 'declarative' && ui.page) {
    // Key by plugin id so navigating between two plugin pages remounts and
    // the field state map is re-collected from the new schema.
    return (
      <div className="h-full overflow-y-auto">
        <DeclarativePage key={plugin.id} pluginId={plugin.id} schema={ui.page} />
      </div>
    );
  }

  return (
    <EmptyState
      icon={Puzzle}
      title={t('pluginUi.pluginNotInstalled')}
      description={t('pluginUi.pluginNotInstalledDescription')}
    />
  );
}

export default DeclarativePage;
