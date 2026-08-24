import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Puzzle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { appToast } from '@/lib/observability/toast';
import {
  Button,
  Input,
  Select,
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
import type { PluginPageSchema, RowAction, UiNode } from './schema';
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

const headingSizes = [
  'text-2xl',
  'text-xl',
  'text-lg',
  'text-base',
  'text-sm',
  'text-xs',
];

/**
 * Resolve a manifest label to display text. Labels are plugin-namespaced
 * i18n keys: text starting with `<pluginId>.` is resolved via
 * `t('plugin.{id}.{text}')` against the plugin's registered bundle (see
 * i18nPluginBundles.ts) — the same convention the scaffold generates and
 * AiTopTabs uses for plugin tab labels. Anything else (plain strings like
 * "ID", "Email", or version strings like "v1.2.3") renders as-is.
 */
function resolveLabel(pluginId: string, text: string): string {
  const prefix = `${pluginId}.`;
  return text.startsWith(prefix) ? t(`plugin.${pluginId}.${text}`) : text;
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

/**
 * Shared invoke path for button nodes and table row actions: runs
 * `plugin.{pluginId}.{command}` through invokeAction and surfaces
 * rejections as the `pluginUi.actionFailed` toast. Returns true on
 * success so callers (row actions) can trigger follow-ups like a table
 * refetch.
 */
async function runPluginCommand(
  pluginId: string,
  command: string,
  params?: Record<string, unknown>,
): Promise<boolean> {
  try {
    await invokeAction(pluginId, command, params);
    return true;
  } catch {
    appToast.error(t('pluginUi.actionFailed'));
    return false;
  }
}

function renderNode(
  pluginId: string,
  node: UiNode,
  index: number,
  fields: FieldBinding,
) {
  switch (node.kind) {
    case 'heading': {
      const level = Math.min(Math.max(node.level ?? 1, 1), 6);
      return (
        <div
          key={index}
          className={`${headingSizes[level - 1]} font-semibold text-slate-100`}
        >
          {resolveLabel(pluginId, node.text)}
        </div>
      );
    }
    case 'section':
      return (
        <div key={index} className="space-y-3">
          {node.title && (
            <div className="text-sm font-medium text-slate-300">
              {resolveLabel(pluginId, node.title)}
            </div>
          )}
          {(node.nodes ?? []).map((child, i) =>
            renderNode(pluginId, child, i, fields),
          )}
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
          <Input
            key={index}
            label={label}
            value={String(value ?? '')}
            placeholder={placeholder}
            readOnly={node.readonly}
            onChange={e => fields.onChange(node.id, e.target.value)}
          />
        );
      }
      if (node.field === 'select') {
        return (
          <Select
            key={index}
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
        );
      }
      // toggle
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
      return <TableNode key={index} pluginId={pluginId} node={node} />;
    case 'button':
      return (
        <ButtonNode
          key={index}
          pluginId={pluginId}
          node={node}
          fieldValues={fields.values}
        />
      );
    case 'card_grid':
      return <CardGridNode key={index} pluginId={pluginId} node={node} />;
    case 'markdown':
      return <MarkdownNode key={index} pluginId={pluginId} node={node} />;
    default: {
      // Tolerant reader: future node kinds not in the type union yet.
      const kind = (node as { kind: string }).kind;
      console.warn(`Unknown plugin UI node kind: ${kind}`);
      return null;
    }
  }
}

function TableNode({
  pluginId,
  node,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'table' }>;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a successful row action so the effect below re-runs the
  // source command (TableNode had no refresh mechanism before row
  // actions; page-level buttons still do NOT trigger a table refetch).
  const [fetchKey, setFetchKey] = useState(0);
  // `${rowIndex}:${actionId}` of the in-flight row action, if any.
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invokeAction<Record<string, unknown> | Record<string, unknown>[]>(
      pluginId,
      node.source.command,
      node.source.params,
    )
      .then(resp => {
        if (cancelled) return;
        // null/undefined → empty state (no rows, no error).
        if (resp == null) {
          setRows([]);
          setLoading(false);
          return;
        }
        // Bare array of rows.
        if (Array.isArray(resp)) {
          setRows(resp as Record<string, unknown>[]);
          setLoading(false);
          return;
        }
        // Object wrapping rows under `rowsKey` (default "rows").
        const rowsKey = node.rowsKey ?? 'rows';
        const data = (resp as Record<string, unknown>)[rowsKey];
        if (Array.isArray(data)) {
          setRows(data as Record<string, unknown>[]);
          setLoading(false);
          return;
        }
        // Malformed response: non-null, non-array, no rowsKey — show an
        // inline error instead of silently rendering the empty state.
        setError(
          `Table response missing rowsKey "${rowsKey}"`,
        );
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, node.source.command, node.source.params, node.rowsKey, fetchKey]);

  const rowActions = node.rowActions ?? [];

  const handleRowAction = async (
    action: RowAction,
    row: Record<string, unknown>,
    rowIndex: number,
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
    setBusyAction(`${rowIndex}:${action.id}`);
    try {
      const ok = await runPluginCommand(pluginId, action.command, params);
      // Refresh the rows so the mutation is visible immediately.
      if (ok) setFetchKey(k => k + 1);
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) return <LoadingSpinner size="sm" />;
  if (error) return <p className="text-xs text-red-400">{error}</p>;
  if (rows.length === 0) return <p className="text-xs text-slate-500">&mdash;</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {node.columns.map(col => (
            <TableHead key={col.key}>{resolveLabel(pluginId, col.label)}</TableHead>
          ))}
          {rowActions.length > 0 && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i}>
            {node.columns.map(col => (
              <TableCell key={col.key}>
                {String(row[col.key] ?? '')}
              </TableCell>
            ))}
            {rowActions.length > 0 && (
              <TableCell key="__row_actions">
                <div className="flex justify-end gap-2">
                  {rowActions.map(action => (
                    <Button
                      key={action.id}
                      size="sm"
                      variant={action.variant ?? 'primary'}
                      isLoading={busyAction === `${i}:${action.id}`}
                      onClick={() => handleRowAction(action, row, i)}
                    >
                      {resolveLabel(pluginId, action.label)}
                    </Button>
                  ))}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ButtonNode({
  pluginId,
  node,
  fieldValues,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'button' }>;
  fieldValues: Record<string, FieldValue>;
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
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
      await runPluginCommand(pluginId, node.command, params);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant={node.variant ?? 'primary'}
      isLoading={busy}
      onClick={handleClick}
    >
      {resolveLabel(pluginId, node.label)}
    </Button>
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

function CardGridNode({
  pluginId,
  node,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'card_grid' }>;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a successful card action so the effect below re-runs
  // the source command (same refetch mechanism as TableNode row actions).
  const [fetchKey, setFetchKey] = useState(0);
  // Index of the card whose action is in flight, if any.
  const [busyAction, setBusyAction] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    invokeAction<Record<string, unknown> | Record<string, unknown>[]>(
      pluginId,
      node.source.command,
      node.source.params,
    )
      .then(resp => {
        if (cancelled) return;
        // null/undefined → empty state (no cards, no error).
        if (resp == null) {
          setRows([]);
          setLoading(false);
          return;
        }
        // Bare array of rows.
        if (Array.isArray(resp)) {
          setRows(resp as Record<string, unknown>[]);
          setLoading(false);
          return;
        }
        // Object wrapping rows under "rows" (table default rowsKey;
        // card_grid has no configurable rowsKey field).
        const data = (resp as Record<string, unknown>).rows;
        if (Array.isArray(data)) {
          setRows(data as Record<string, unknown>[]);
          setLoading(false);
          return;
        }
        // Malformed response — inline error like TableNode.
        setError('Card grid response missing "rows"');
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, node.source.command, node.source.params, fetchKey]);

  const action = node.card.action;

  const handleAction = async (
    row: Record<string, unknown>,
    rowIndex: number,
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
    setBusyAction(rowIndex);
    try {
      const ok = await runPluginCommand(pluginId, action.command, params);
      // Refresh the rows so the mutation is visible immediately.
      if (ok) setFetchKey(k => k + 1);
    } finally {
      setBusyAction(null);
    }
  };

  if (loading) return <LoadingSpinner size="sm" />;
  if (error) return <p className="text-xs text-red-400">{error}</p>;
  if (rows.length === 0) return <p className="text-xs text-slate-500">&mdash;</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row, i) => {
        const title = resolveCardField(row, node.card.title);
        const subtitle = resolveCardField(row, node.card.subtitle);
        const body = resolveCardField(row, node.card.body);
        const imageSrc = resolveCardField(row, node.card.image);
        return (
          <GlassCard key={i} className="overflow-hidden">
            {imageSrc && (
              <img
                src={imageSrc}
                alt={title}
                className="h-32 w-full object-cover"
              />
            )}
            <div className="space-y-1 p-3">
              <div className="text-sm font-semibold text-white">{title}</div>
              {subtitle && (
                <div className="text-xs text-slate-400">{subtitle}</div>
              )}
              {body && (
                <div className="text-xs leading-relaxed text-slate-300">
                  {body}
                </div>
              )}
              {action && (
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant={action.variant ?? 'primary'}
                    isLoading={busyAction === i}
                    onClick={() => handleAction(row, i)}
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
  );
}

function MarkdownNode({
  pluginId,
  node,
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'markdown' }>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setText(null);
    invokeAction<unknown>(pluginId, node.source.command, node.source.params)
      .then(resp => {
        if (cancelled) return;
        // null/undefined → empty state (no text, no error).
        if (resp == null) {
          setLoading(false);
          return;
        }
        // Bare string response is accepted as the markdown text directly
        // (the string analogue of the table node's bare-array tolerance).
        if (typeof resp === 'string') {
          setText(resp);
          setLoading(false);
          return;
        }
        // Object carrying the markdown under `textKey` (default "text").
        if (typeof resp === 'object') {
          const textKey = node.textKey ?? 'text';
          const value = (resp as Record<string, unknown>)[textKey];
          if (typeof value === 'string') {
            setText(value);
            setLoading(false);
            return;
          }
          // Malformed response — inline error like TableNode.
          setError(`Markdown response missing textKey "${textKey}"`);
          setLoading(false);
          return;
        }
        setError(`Markdown response missing textKey "${node.textKey ?? 'text'}"`);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, node.source.command, node.source.params, node.textKey]);

  if (loading) return <LoadingSpinner size="sm" />;
  if (error) return <p className="text-xs text-red-400">{error}</p>;
  if (!text) return <p className="text-xs text-slate-500">&mdash;</p>;

  return renderMarkdown(text);
}

interface DeclarativePageProps {
  pluginId: string;
  schema: PluginPageSchema;
}

function DeclarativePage({ pluginId, schema }: DeclarativePageProps) {
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

  return (
    <div className="space-y-4 p-4">
      {schema?.title && (
        <h1 className="text-xl font-semibold text-slate-100">
          {resolveLabel(pluginId, schema.title)}
        </h1>
      )}
      {nodes.map((node, i) => renderNode(pluginId, node, i, fields))}
    </div>
  );
}

export function PluginPageHost() {
  const { id } = useParams<{ id: string }>();
  const [plugin, setPlugin] = useState<ServicePluginInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [notInstalled, setNotInstalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
    return <DeclarativePage key={plugin.id} pluginId={plugin.id} schema={ui.page} />;
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
