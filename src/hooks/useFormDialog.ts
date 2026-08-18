import { useState } from 'react';

/**
 * Manages the (open, editing) state pair shared by form dialogs. `open(item?)`
 * sets the editing item (or null for "create") and opens the dialog; `close()`
 * resets both.
 */
export function useFormDialog<T>() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<T | null>(null);

  const open = (item?: T) => {
    setEditingItem(item || null);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    setEditingItem(null);
  };

  return { isOpen, editingItem, open, close };
}
