import { AlertTriangle, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
  isLoading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const variantStyles = {
    danger: {
      icon: <Trash2 className="w-5 h-5" />,
      iconColor: 'text-red-400',
      buttonBg: 'bg-red-500/20 hover:bg-red-500/30 border-red-500/30',
      buttonText: 'text-red-400',
    },
    warning: {
      icon: <AlertTriangle className="w-5 h-5" />,
      iconColor: 'text-amber-400',
      buttonBg: 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/30',
      buttonText: 'text-amber-400',
    },
  };

  const styles = variantStyles[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={<span className={styles.iconColor}>{styles.icon}</span>}
      isLoading={isLoading}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg border transition-all disabled:opacity-50 flex items-center gap-2',
              styles.buttonBg,
              styles.buttonText
            )}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing...
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      }
    >
      <div className="text-slate-300 text-sm leading-relaxed">
        {message}
      </div>
    </Modal>
  );
}
