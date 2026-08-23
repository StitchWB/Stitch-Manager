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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import type { PluginPageSchema, UiNode } from './schema';
import { invokeAction } from './bindings';

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
 * Resolve a manifest label to display text. Labels that look like i18n keys
 * (contain a dot) are resolved via `t('plugin.{id}.{key}')` against the
 * plugin's registered bundle (see i18nPluginBundles.ts) — the same
 * convention AiTopTabs uses for plugin tab labels. Plain strings (e.g.
 * "ID", "Email") render as-is.
 */
function resolveLabel(pluginId: string, text: string): string {
  return text.includes('.') ? t(`plugin.${pluginId}.${text}`) : text;
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
 */
function collectInitialFieldValues(
  nodes: UiNode[],
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  const walk = (list: UiNode[]): void => {
    for (const node of list) {
      if (node.kind === 'field') {
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
        // Readonly commands may return either a bare array of rows or an
        // object wrapping the rows under `rowsKey` (default "rows").
        const data = Array.isArray(resp)
          ? resp
          : (resp as Record<string, unknown> | null | undefined)?.[
              node.rowsKey ?? 'rows'
            ];
        setRows(Array.isArray(data) ? (data as Record<string, unknown>[]) : []);
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
  }, [pluginId, node.source.command, node.source.params, node.rowsKey]);

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
      await invokeAction(pluginId, node.command, params);
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
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
    () => collectInitialFieldValues(nodes),
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
