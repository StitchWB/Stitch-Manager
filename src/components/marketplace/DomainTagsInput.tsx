import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { getFieldShellClassName } from '@/components/ui/field';

export const DOMAIN_RE = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/;

interface DomainTagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}

export function DomainTagsInput({
  value,
  onChange,
  disabled,
  placeholder,
  id,
}: DomainTagsInputProps) {
  const [draft, setDraft] = useState('');

  const addTags = (raw: string) => {
    const incoming = raw
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!incoming.length) return;
    const merged = [...value];
    for (const tag of incoming) {
      if (!merged.includes(tag)) merged.push(tag);
    }
    onChange(merged);
  };

  const commitDraft = () => {
    setDraft('');
    addTags(draft);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && !draft && value.length) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    setDraft('');
    addTags(draft ? `${draft} ${text}` : text);
  };

  const removeTag = (tag: string) => {
    onChange(value.filter(v => v !== tag));
  };

  const draftInvalid = draft !== '' && !DOMAIN_RE.test(draft);

  return (
    <div className="flex flex-col w-full">
      <div
        className={cn(
          getFieldShellClassName(undefined, disabled),
          'flex flex-wrap items-center gap-1 min-h-8 py-1 px-1.5',
        )}
      >
        {value.map(tag => {
          const valid = DOMAIN_RE.test(tag);
          return (
            <span
              key={tag}
              title={valid ? undefined : t('marketplace.submit.domainInvalid')}
              className={cn(
                'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium max-w-full truncate',
                valid
                  ? 'bg-white/5 border border-white/10 text-slate-300'
                  : 'ring-1 ring-rose-500/50 text-rose-300',
              )}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={disabled}
                aria-label={`Remove ${tag}`}
                className="shrink-0 rounded p-0.5 text-slate-500 hover:text-slate-200 transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          );
        })}
        <input
          id={id}
          value={draft}
          onChange={e => setDraft(e.target.value.toLowerCase())}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={value.length ? '' : placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent px-1.5 py-1 text-sm text-slate-200 placeholder-slate-600 outline-none min-w-[80px] font-sans"
        />
      </div>
      {draftInvalid && (
        <p className="text-xs text-rose-300/80 px-0.5 mt-0.5">
          {t('marketplace.submit.domainInvalid')}
        </p>
      )}
    </div>
  );
}
