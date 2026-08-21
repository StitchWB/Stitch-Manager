import { useEffect, useState } from 'react';
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

function renderNode(pluginId: string, node: UiNode, index: number) {
  switch (node.kind) {
    case 'heading': {
      const level = Math.min(Math.max(node.level ?? 1, 1), 6);
      return (
        <div
          key={index}
          className={`${headingSizes[level - 1]} font-semibold text-slate-100`}
        >
          {node.text}
        </div>
      );
    }
    case 'section':
      return (
        <div key={index} className="space-y-3">
          {node.title && (
            <div className="text-sm font-medium text-slate-300">{node.title}</div>
          )}
          {node.nodes.map((child, i) => renderNode(pluginId, child, i))}
        </div>
      );
    case 'field': {
      if (node.field === 'text') {
        return (
          <Input
            key={index}
            label={node.label}
            value={(node.value as string) ?? ''}
            readOnly={node.readonly}
          />
        );
      }
      if (node.field === 'select') {
        return (
          <Select
            key={index}
            label={node.label}
            value={(node.value as string) ?? ''}
            options={node.options ?? []}
            disabled={node.readonly}
          />
        );
      }
      // toggle
      return (
        <Toggle
          key={index}
          label={node.label}
          checked={Boolean(node.value)}
          onChange={() => {}}
          disabled={node.readonly}
        />
      );
    }
    case 'table':
      return <TableNode key={index} pluginId={pluginId} node={node} />;
    case 'button':
      return (
        <ButtonNode key={index} pluginId={pluginId} node={node} />
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
    invokeAction<Record<string, unknown>>(pluginId, node.source.command, node.source.params)
      .then(resp => {
        if (cancelled) return;
        const key = node.rowsKey ?? 'rows';
        const data = (resp as Record<string, unknown> | null | undefined)?.[key];
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
            <TableHead key={col.key}>{col.label}</TableHead>
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
}: {
  pluginId: string;
  node: Extract<UiNode, { kind: 'button' }>;
}) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await invokeAction(pluginId, node.command, node.params);
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
      {node.label}
    </Button>
  );
}

interface DeclarativePageProps {
  pluginId: string;
  schema: PluginPageSchema;
}

function DeclarativePage({ pluginId, schema }: DeclarativePageProps) {
  return (
    <div className="space-y-4 p-4">
      {schema.title && (
        <h1 className="text-xl font-semibold text-slate-100">
          {t(schema.title)}
        </h1>
      )}
      {schema.nodes.map((node, i) => renderNode(pluginId, node, i))}
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
    return <DeclarativePage pluginId={plugin.id} schema={ui.page} />;
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
