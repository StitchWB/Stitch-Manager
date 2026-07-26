import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import { ChevronDown, Check, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './Badge';

export interface ModelOption {
  value: string;
  label: string;
  provider: string;
  family?: string;
  context?: number;
  reasoning?: boolean;
  toolCall?: boolean;
}

interface ModelPickerProps {
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export function ModelPicker({
  value,
  options,
  onChange,
  placeholder = 'Select model',
  label,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.value === value);

  // Group options by provider
  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const opt of options) {
      const list = map.get(opt.provider) ?? [];
      list.push(opt);
      map.set(opt.provider, list);
    }
    return Array.from(map.entries());
  }, [options]);

  const updatePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({
      top: Math.min(r.bottom + 4, window.innerHeight - 340),
      left: Math.max(8, Math.min(r.left, window.innerWidth - 400)),
      width: Math.max(r.width, 380),
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const reposition = () => updatePosition();
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  return (
    <div>
      {label && (
        <label className="block text-sm font-medium text-slate-300 mb-1.5">{label}</label>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center justify-between w-full h-8 px-3 text-sm text-left rounded-lg',
          'bg-white/5 border border-white/10 hover:border-white/20 transition-colors',
          'text-slate-200 focus:outline-none focus:border-sky-500/50'
        )}
      >
        {selected ? (
          <span className="flex items-center gap-2 truncate">
            <Badge size="sm" variant="info">{selected.provider}</Badge>
            <span className="truncate">{selected.label}</span>
          </span>
        ) : (
          <span className="text-slate-500">{placeholder}</span>
        )}
        <ChevronDown size={14} className={cn('shrink-0 ml-2 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && rect && createPortal(
        <div
          ref={listRef}
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width }}
          className="z-[9999] rounded-lg bg-slate-900 border border-white/10 shadow-xl shadow-black/40 overflow-hidden"
        >
          <Command>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
              <Search size={14} className="text-slate-500 shrink-0" />
              <Command.Input
                placeholder="Type to filter models..."
                autoFocus
                className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
              />
            </div>
            <Command.List className="max-h-72 overflow-y-auto py-1">
              <Command.Empty className="px-3 py-4 text-sm text-slate-500 text-center">
                No models found
              </Command.Empty>
              {groups.map(([provider, models]) => (
                <Command.Group
                  key={provider}
                  heading={
                    <div className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {provider}
                    </div>
                  }
                >
                  {models.map(opt => (
                    <Command.Item
                      key={opt.value}
                      value={`${opt.label} ${opt.value} ${opt.family ?? ''}`}
                      onSelect={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex items-center justify-between gap-2 px-3 py-1.5 text-sm cursor-pointer',
                        'text-slate-300 aria-selected:bg-white/10 aria-selected:text-white'
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Check
                          size={12}
                          className={cn('shrink-0 text-sky-400', opt.value === value ? 'opacity-100' : 'opacity-0')}
                        />
                        <span className="truncate">{opt.label}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {opt.context !== undefined && (
                          <span className="text-xs text-slate-500">{formatNum(opt.context)}</span>
                        )}
                        {opt.reasoning && <Badge size="sm" variant="info">R</Badge>}
                        {opt.toolCall && <Badge size="sm" variant="success">T</Badge>}
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </div>,
        document.body
      )}
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
