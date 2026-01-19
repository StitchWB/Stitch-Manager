/**
 * Custom hook for copying text to clipboard with toast notifications
 * Consolidates clipboard copy logic used across multiple components
 */

import { useState, useCallback } from 'react';
import { toast } from 'sonner';

interface UseCopyToClipboardOptions {
  successMessage?: string;
  errorMessage?: string;
  duration?: number;
}

interface UseCopyToClipboardReturn {
  copy: (text: string) => Promise<void>;
  copied: boolean;
}

/**
 * Hook for copying text to clipboard with optional toast notifications
 * 
 * @param options - Configuration options
 * @param options.successMessage - Message to show on successful copy (default: "Copied!")
 * @param options.errorMessage - Message to show on error (default: "Failed to copy")
 * @param options.duration - Duration to show copied state in ms (default: 2000)
 * 
 * @example
 * ```tsx
 * const { copy, copied } = useCopyToClipboard({ successMessage: "Email copied!" });
 * 
 * <button onClick={() => copy(email)}>
 *   {copied ? "Copied!" : "Copy"}
 * </button>
 * ```
 */
export const useCopyToClipboard = (
  options: UseCopyToClipboardOptions = {}
): UseCopyToClipboardReturn => {
  const {
    successMessage = 'Copied!',
    errorMessage = 'Failed to copy',
    duration = 2000,
  } = options;

  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success(successMessage, { duration: 1500 });
        
        // Reset copied state after duration
        setTimeout(() => setCopied(false), duration);
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        toast.error(errorMessage);
      }
    },
    [successMessage, errorMessage, duration]
  );

  return { copy, copied };
};

/**
 * Simple copy function without state management
 * Use when you don't need to track copied state
 * 
 * @example
 * ```tsx
 * <button onClick={() => copyToClipboard(email)}>Copy</button>
 * ```
 */
export const copyToClipboard = async (
  text: string,
  options: { silent?: boolean; message?: string } = {}
): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    if (!options.silent) {
      toast.success(options.message || 'Copied!', { duration: 1500 });
    }
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    if (!options.silent) {
      toast.error('Failed to copy');
    }
  }
};
