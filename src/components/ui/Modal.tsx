import { useEffect, ReactNode } from 'react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { cn } from '../../lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  isLoading?: boolean;
  loadingMessage?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  stickyFooter?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  icon,
  children,
  footer,
  isLoading = false,
  loadingMessage,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  stickyFooter = false,
  className = '',
}: ModalProps) {
  const modalRef = useFocusTrap(isOpen);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, isLoading, onClose]);

  const handleBackdropClick = () => {
    if (closeOnBackdrop && !isLoading) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={handleBackdropClick}
      />

      {/* Modal Container */}
      <div
        ref={modalRef}
        className={cn(
          'relative w-full max-h-[90vh] flex flex-col bg-[#0f1115] border border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden',
          sizeClasses[size],
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-xl z-10 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <svg className="animate-spin h-8 w-8 text-primary" viewBox="0 0 24 24">
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
              {loadingMessage && (
                <span className="text-sm text-white font-medium">{loadingMessage}</span>
              )}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02] shrink-0">
          <div className="flex items-center gap-3">
            {icon && (
              <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                {icon}
              </div>
            )}
            <h3 id="modal-title" className="text-lg font-semibold text-white">
              {title}
            </h3>
          </div>
          {showCloseButton && (
            <button
              onClick={onClose}
              disabled={isLoading}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
              aria-label="Close modal"
            >
              <X size={20} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div
            className={cn(
              'px-6 py-4 border-t border-white/10 bg-white/[0.02] shrink-0',
              stickyFooter &&
                'sticky bottom-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-[#0f1115]/85'
            )}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
