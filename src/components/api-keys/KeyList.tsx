import { Key } from 'lucide-react';
import { KeyRow } from './KeyRow';
import type { KeyFilter } from '../../types/apiKeys';
import type { ApiKeyEntry } from '../../types/apiKeys';

interface KeyListProps {
  entries: ApiKeyEntry[];
  filter: KeyFilter;
  provider: string;
  testingKeys: Set<string>;
  onTest: (entry: ApiKeyEntry) => void;
  onDelete: (entry: ApiKeyEntry) => void;
  onCopy: (entry: ApiKeyEntry) => void;
}

function filterEntries(entries: ApiKeyEntry[], filter: KeyFilter): ApiKeyEntry[] {
  if (filter === 'all') return entries;
  if (filter === 'invalid') {
    return entries.filter(e => e.status === 'invalid' || e.status === 'error');
  }
  return entries.filter(e => e.status === filter);
}

export function KeyList({ entries, filter, provider, testingKeys, onTest, onDelete, onCopy }: KeyListProps) {
  const filtered = filterEntries(entries, filter);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-500">
        <Key className="w-8 h-8 mb-2 opacity-40" />
        <p className="text-sm">
          {entries.length === 0
            ? `No ${provider} API keys added yet`
            : `No ${filter === 'all' ? '' : filter.replace('_', ' ')} keys found`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {filtered.map((entry, idx) => (
        <KeyRow
          key={`${entry.key.slice(0, 12)}-${idx}`}
          entry={entry}
          provider={provider}
          isTesting={testingKeys.has(entry.key)}
          onTest={onTest}
          onDelete={onDelete}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}