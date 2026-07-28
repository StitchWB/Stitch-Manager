import { useMemo, useState } from 'react';
import { Package, Search, Star, Zap } from 'lucide-react';
import {
  GlassCard, Input, Badge, EmptyState,
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
  IconButton, Tooltip,
} from '@/components/ui';
import type { ProviderConfig } from '@/lib/backend/modules/opencodeConfig';

interface ModelsSectionProps {
  providers: Record<string, ProviderConfig>;
  defaultModel?: string;
  smallModel?: string;
  onSetDefault?: (model: string) => void;
  onSetSmall?: (model: string) => void;
}

interface ModelEntry {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  fullId: string; // providerId/modelId
  family?: string;
  context?: number;
  output?: number;
  reasoning?: boolean;
  toolCall?: boolean;
}

export function ModelsSection({
  providers,
  defaultModel,
  smallModel,
  onSetDefault,
  onSetSmall,
}: ModelsSectionProps) {
  const [query, setQuery] = useState('');

  const models = useMemo(() => {
    const entries: ModelEntry[] = [];
    Object.entries(providers).forEach(([pid, provider]) => {
      Object.entries(provider.models || {}).forEach(([mid, model]) => {
        entries.push({
          providerId: pid,
          providerName: provider.name || pid,
          modelId: mid,
          modelName: model.name || mid,
          fullId: `${pid}/${mid}`,
          family: model.family,
          context: model.limit?.context,
          output: model.limit?.output,
          reasoning: model.reasoning,
          toolCall: model.tool_call,
        });
      });
    });
    return entries.sort((a, b) =>
      a.providerName === b.providerName
        ? a.modelId.localeCompare(b.modelId)
        : a.providerName.localeCompare(b.providerName)
    );
  }, [providers]);

  const filtered = useMemo(() => {
    if (!query) return models;
    const q = query.toLowerCase();
    return models.filter(m =>
      m.modelId.toLowerCase().includes(q) ||
      m.modelName.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q) ||
      m.family?.toLowerCase().includes(q)
    );
  }, [models, query]);

  if (models.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No models available"
        description="Add a provider with models to see them here"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vsc-text-muted pointer-events-none" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by model, provider, or family..."
            className="pl-9"
          />
        </div>
        <Badge>{filtered.length} / {models.length}</Badge>
      </div>

      <GlassCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Context</TableHead>
              <TableHead className="text-right">Output</TableHead>
              <TableHead>Caps</TableHead>
              <TableHead className="text-right">Assign</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(m => {
              const isDefault = m.fullId === defaultModel;
              const isSmall = m.fullId === smallModel;
              return (
                <TableRow key={m.fullId} className={isDefault || isSmall ? 'bg-sky-500/5' : ''}>
                  <TableCell>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-2">
                        {m.modelName}
                        {isDefault && (
                          <Tooltip content="Default model">
                            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                          </Tooltip>
                        )}
                        {isSmall && (
                          <Tooltip content="Small model (fast tasks)">
                            <Zap className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400 shrink-0" />
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-xs text-vsc-text-muted truncate">{m.modelId}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge size="sm" variant="outline">{m.providerName}</Badge>
                    {m.family && (
                      <Badge size="sm" className="ml-1">{m.family}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatNum(m.context)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatNum(m.output)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {m.reasoning && <Badge size="sm" variant="info">R</Badge>}
                      {m.toolCall && <Badge size="sm" variant="success">T</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {onSetDefault && !isDefault && (
                        <Tooltip content="Set as default model">
                          <IconButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onSetDefault(m.fullId)}
                          >
                            <Star className="w-4 h-4" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onSetSmall && !isSmall && (
                        <Tooltip content="Set as small model">
                          <IconButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onSetSmall(m.fullId)}
                          >
                            <Zap className="w-4 h-4" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </GlassCard>
    </div>
  );
}

function formatNum(n?: number): string {
  if (n === undefined) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
