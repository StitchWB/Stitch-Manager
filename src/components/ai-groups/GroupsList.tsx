import { useMemo, useState } from 'react';
import { Plus, Search, ChevronRight, UsersRound, AlertTriangle } from 'lucide-react';
import {
  GlassCard,
  Badge,
  Button,
  ButtonBase,
  IconButton,
  Input,
  EmptyState,
  SkeletonLoader,
  Tooltip,
} from '@/components/ui';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';
import type { GroupSummary } from '@/lib/backend/modules/groups';

interface GroupsListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

function roleBadge(role: GroupSummary['role']) {
  if (role === 'owner') {
    return (
      <Badge variant="indigo" size="sm">
        {t('ai.groups.role.owner')}
      </Badge>
    );
  }
  return (
    <Badge variant="slate" size="sm">
      {t('ai.groups.role.member')}
    </Badge>
  );
}

function avatarLetter(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

/**
 * Master column for the Groups tab. Renders a search input, a list of
 * group rows (letter avatar + name + role badge + meta + chevron), and
 * empty / loading / error states. The create button sits in the header.
 */
export function GroupsList({ selectedId, onSelect, onCreate }: GroupsListProps) {
  const { groups, loading, errors, fetchList } = useGroupsStore();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g => g.name.toLowerCase().includes(q));
  }, [groups, query]);

  return (
    <GlassCard className="flex flex-col p-0 overflow-hidden h-full" >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">{t('ai.groups.title')}</h3>
          <Badge variant="info" size="sm">
            {groups.length}
          </Badge>
        </div>
        <Tooltip content={t('ai.groups.create.title')}>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={onCreate}
            aria-label={t('ai.groups.create.title')}
          >
            <Plus size={16} />
          </IconButton>
        </Tooltip>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <Input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('ai.groups.search.placeholder')}
          leftIcon={<Search className="w-4 h-4" />}
          containerClassName="w-full"
          aria-label={t('ai.groups.search.placeholder')}
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading.list ? (
          <div className="p-3 space-y-2">
            <SkeletonLoader variant="rectangle" height="h-16" count={3} />
          </div>
        ) : errors.list ? (
          <div className="p-3">
            <EmptyState
              compact
              icon={AlertTriangle}
              title={t('ai.groups.loadFailed')}
              action={
                <Button size="sm" variant="ghost" onClick={() => fetchList()}>
                  {t('common.retry')}
                </Button>
              }
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-3">
            <EmptyState
              icon={UsersRound}
              title={t('ai.groups.empty.title')}
              description={t('ai.groups.empty.desc')}
              action={
                <Button size="sm" variant="primary" onClick={onCreate} leftIcon={<Plus size={14} />}>
                  {t('ai.groups.create.cta')}
                </Button>
              }
            />
          </div>
        ) : (
          <div className="py-1">
            {filtered.map(group => {
              const isActive = group.id === selectedId;
              return (
                <ButtonBase
                  key={group.id}
                  type="button"
                  onClick={() => onSelect(group.id)}
                  data-active={isActive}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                    isActive
                      ? 'ring-1 ring-indigo-500/30 bg-white/[0.04]'
                      : 'hover:bg-white/[0.04]',
                  ].join(' ')}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <span className="w-9 h-9 rounded-lg bg-indigo-500/10 text-indigo-300 flex items-center justify-center text-sm font-semibold shrink-0">
                    {avatarLetter(group.name)}
                  </span>
                  <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-slate-100 truncate">
                        {group.name}
                      </span>
                      {roleBadge(group.role)}
                    </span>
                    <span className="text-[11px] text-slate-500 truncate">
                      {t('ai.groups.meta', {
                        members: group.member_count,
                        keys: group.key_count,
                      })}
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-slate-600 shrink-0" />
                </ButtonBase>
              );
            })}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
