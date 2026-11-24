import { Copy, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { useCopyToClipboard, type CopyToClipboardOptions } from '../../hooks/useCopyToClipboard';
import { IconButton } from './IconButton';

export interface CodeBlockProps {
  code: string;
  label?: string;
  maxHeight?: number;
  wrap?: boolean;
  copyable?: boolean;
  copyOptions?: CopyToClipboardOptions;
  className?: string;
}

export function CodeBlock({
  code,
  label,
  maxHeight = 256,
  wrap = true,
  copyable = true,
  copyOptions,
  className,
}: CodeBlockProps) {
  const { copy, copied } = useCopyToClipboard();
  const copyLabel = copied ? t('notifications.copied') : t('common.copyToClipboard');
  const showHeader = Boolean(label) || copyable;

  return (
    <div className={cn('overflow-hidden rounded-lg border border-white/10 bg-black/40', className)}>
      {showHeader && (
        <div
          className={cn(
            'flex items-center gap-2 border-b border-white/[0.06] px-3 py-1.5',
            !label && 'justify-end'
          )}
        >
          {label && (
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {label}
            </span>
          )}
          {copyable && (
            <IconButton
              size="sm"
              onClick={() => void copy(code, copyOptions)}
              tooltip={copyLabel}
              aria-label={copyLabel}
              className={cn(copied && 'text-emerald-400 hover:text-emerald-300')}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </IconButton>
          )}
        </div>
      )}
      {/* tabIndex keeps the bounded scroll region keyboard-reachable (WCAG 2.1.1). */}
      <pre
        tabIndex={0}
        style={{ maxHeight }}
        className={cn(
          'overflow-auto p-3 font-mono text-2xs text-slate-300',
          wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
        )}
      >
        {code}
      </pre>
    </div>
  );
}
