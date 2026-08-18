import { ActionDialog } from './ActionDialog';

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
  return (
    <ActionDialog
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={onConfirm}
      title={title}
      variant={variant}
      mode="confirm"
      isLoading={isLoading}
      confirmText={confirmText}
      cancelText={cancelText}
    >
      <div className="text-slate-300 text-sm leading-relaxed">{message}</div>
    </ActionDialog>
  );
}
