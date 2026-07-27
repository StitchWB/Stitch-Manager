import { useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Zap } from 'lucide-react';

import { t } from '@/lib/i18n';
import { ButtonBase, GlassCard } from '@/components/ui';
import type { ProviderCapability } from '../../../lib/tauri/modules/aiProxy';

interface ProviderPriorityListProps {
  capabilities: ProviderCapability[];
  priority: string[];
  onChange: (newPriority: string[]) => void;
  disabled?: boolean;
}

interface SortableProviderItemProps {
  provider: ProviderCapability;
  index: number;
  disabled: boolean;
}

function SortableProviderItem({ provider, index, disabled }: SortableProviderItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: provider.provider, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2.5 rounded-md border border-white/10 bg-white/[0.02] p-2.5 transition-colors hover:border-white/20"
    >
      <ButtonBase
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        className="text-slate-400 transition-colors hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-grab enabled:active:cursor-grabbing"
        aria-label={t('aiHub.rotation.priority.description')}
      >
        <GripVertical size={16} />
      </ButtonBase>
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04]">
        <Zap size={16} className="text-slate-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">
          {provider.provider}
        </div>
        <div className="text-xs text-slate-400">
          {provider.enabledAccounts} / {provider.totalAccounts} {t('aiHub.topology.keys')}
        </div>
      </div>
      <div className="text-xs text-slate-500 font-mono">
        #{index + 1}
      </div>
    </div>
  );
}

export function ProviderPriorityList({
  capabilities,
  priority,
  onChange,
  disabled = false,
}: ProviderPriorityListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sort capabilities by priority
  const sortedCapabilities = useMemo(() => {
    const priorityMap = new Map(priority.map((id, index) => [id, index]));
    return [...capabilities].sort((a, b) => {
      const aIndex = priorityMap.get(a.provider) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = priorityMap.get(b.provider) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }, [capabilities, priority]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) return;

      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = sortedCapabilities.findIndex(p => p.provider === active.id);
        const newIndex = sortedCapabilities.findIndex(p => p.provider === over.id);

        const newOrder = arrayMove(sortedCapabilities, oldIndex, newIndex).map(p => p.provider);
        onChange(newOrder);
      }
    },
    [disabled, sortedCapabilities, onChange]
  );

  if (capabilities.length === 0) {
    return null;
  }

  return (
    <GlassCard className="p-3">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-white mb-1">
          {t('aiHub.rotation.priority.title')}
        </h3>
        <p className="text-xs text-slate-400">
          {t('aiHub.rotation.priority.description')}
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedCapabilities.map(p => p.provider)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {sortedCapabilities.map((provider, index) => (
              <SortableProviderItem
                key={provider.provider}
                provider={provider}
                index={index}
                disabled={disabled}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </GlassCard>
  );
}
