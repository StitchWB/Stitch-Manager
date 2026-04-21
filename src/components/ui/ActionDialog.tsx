import { useMemo } from 'react';
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';

type ActionDialogVariant = 'danger' | 'warning' | 'neutral';
type ActionDialogMode = 'confirm' | 'edit';

export interface ActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ActionDialogVariant;
  mode?: ActionDialogMode;
  isLoading?: boolean;
  submitDisabled?: boolean;
  children?: React.ReactNode;
}

export function ActionDialog({
  isOpen,
  onClose,
  onSubmit,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'neutral',
  mode = 'confirm',
  isLoading = false,
  submitDisabled = false,
  children,
}: ActionDialogProps) {
  const icon = useMemo(() => {
    if (variant === 'danger') return <Trash2 size={18} className="text-red-300" />;
    if (mode === 'edit') return <Pencil size={18} className="text-indigo-300" />;
    return <AlertTriangle size={18} className="text-amber-300" />;
  }, [mode, variant]);

  const submitVariant = variant === 'danger' ? 'danger' : 'secondary';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={icon}
      size="sm"
      isLoading={isLoading}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            size="sm"
            variant={submitVariant}
            onClick={onSubmit}
            disabled={submitDisabled || isLoading}
          >
            {confirmText}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {description ? (
          <p className="text-sm text-slate-300 leading-relaxed">{description}</p>
        ) : null}
        {children}
      </div>
    </Modal>
  );
}
