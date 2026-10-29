import { Copy } from 'lucide-react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { Tooltip } from './Tooltip';
import { cn } from '../../lib/utils';

/**
 * InfoField - Display label-value pairs with optional copy functionality
 * 
 * Used for displaying structured information in detail views, settings panels,
 * and anywhere you need to show a label with a corresponding value.
 * 
 * @example
 * // Basic usage
 * <InfoField label="Email" value="user@example.com" />
 * 
 * @example
 * // With copy button
 * <InfoField label="API Key" value="sk_test_123..." copyable />
 * 
 * @example
 * // With truncation for long values
 * <InfoField label="Path" value="/very/long/path/to/file" truncate />
 * 
 * @example
 * // Custom max width for truncation
 * <InfoField label="URL" value="https://..." truncate maxWidth="300px" />
 */

interface InfoFieldProps {
  /** Label text displayed above the value */
  label: string;
  /** Value text to display */
  value: string;
  /** Show copy button on hover (default: false) */
  copyable?: boolean;
  /** Truncate long values with ellipsis (default: false) */
  truncate?: boolean;
  /** Maximum width for truncated text (default: "200px") */
  maxWidth?: string;
  /** Additional CSS classes for the container */
  className?: string;
}

export const InfoField: React.FC<InfoFieldProps> = ({
  label,
  value,
  copyable = false,
  truncate = false,
  maxWidth = '200px',
  className = '',
}) => {
  const { copy } = useCopyToClipboard();

  return (
    <div className={className}>
      <label className="block text-[10px] uppercase tracking-wider text-slate-500 mb-0.5">
        {label}
      </label>
      <div className="flex items-center gap-2 group">
        <Tooltip
          content={value}
          side="top"
          className={!truncate && value.length < 30 ? 'hidden' : ''}
        >
          <span
            className={cn(
              'text-sm text-slate-200 font-mono block',
              truncate && 'truncate'
            )}
            style={truncate ? { maxWidth } : undefined}
          >
            {value}
          </span>
        </Tooltip>
        {copyable && (
          <Tooltip content="Copy">
            <button
              onClick={() => copy(value)}
              className="p-1 text-slate-500 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-white/10 rounded transition-all"
              aria-label={`Copy ${label}`}
            >
              <Copy size={12} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export type { InfoFieldProps };
