import { LucideIcon } from 'lucide-react';
import { IconButton } from './IconButton';
import { Tooltip } from '../Tooltip';
import { cn } from '../../lib/utils';
import { LoadingSpinner } from './LoadingSpinner';

export interface ActionButton {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'default' | 'danger' | 'success' | 'ghost';
  className?: string;
}

export interface ActionButtonGroupProps {
  actions: ActionButton[];
  size?: 'sm' | 'md';
  spacing?: 'tight' | 'normal' | 'loose';
  className?: string;
}

const spacingClasses = {
  tight: 'gap-1',
  normal: 'gap-2',
  loose: 'gap-3',
};

/**
 * ActionButtonGroup - Reusable component for groups of icon buttons with tooltips
 * 
 * @example
 * ```tsx
 * <ActionButtonGroup
 *   actions={[
 *     { icon: RefreshCw, label: 'Refresh', onClick: handleRefresh, disabled: loading },
 *     { icon: Download, label: 'Export', onClick: handleExport },
 *     { icon: Trash2, label: 'Clear', onClick: handleClear, variant: 'danger' },
 *   ]}
 * />
 * ```
 */
export const ActionButtonGroup: React.FC<ActionButtonGroupProps> = ({
  actions,
  size = 'md',
  spacing = 'normal',
  className = '',
}) => {
  return (
    <div className={cn('flex items-center', spacingClasses[spacing], className)}>
      {actions.map((action, index) => {
        const Icon = action.icon;
        return (
          <Tooltip key={index} content={action.label}>
            <IconButton
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              variant={action.variant}
              size={size}
              className={action.className}
              aria-label={action.label}
            >
              {action.loading ? (
                <LoadingSpinner size="xs" />
              ) : (
                <Icon size={size === 'sm' ? 14 : 16} />
              )}
            </IconButton>
          </Tooltip>
        );
      })}
    </div>
  );
};
