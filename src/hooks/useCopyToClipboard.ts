/**
 * Custom hook for copying text to clipboard with toast notifications
 * Consolidates clipboard copy logic used across multiple components
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { copyToClipboard as nativeCopy } from '@/lib/native';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';

// Module-level timer for the stateless helper below.
// Prevents a previous sensitive auto-clear from wiping out later clipboard content.
let copyToClipboardAutoClearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Write text to clipboard — delegates to native layer (Backend plugin / navigator / execCommand).
 */
async function writeToClipboard(text: string): Promise<void> {
  return nativeCopy(text);
}

interface UseCopyToClipboardOptions {
  successMessage?: string;
  errorMessage?: string;
  duration?: number;
}

export interface CopyToClipboardOptions {
  /** Treat this value as sensitive (enables safer defaults). */
  sensitive?: boolean;
  /** Ask user confirmation before copying. */
  requireConfirmation?: boolean;
  /** Message used for the in-app confirmation dialog. */
  confirmationMessage?: string;
  /** Auto-clear clipboard after copying. Defaults to true for sensitive copy. */
  autoClear?: boolean;
  /** Delay before auto-clearing clipboard (ms). Defaults to 15000 for sensitive copy. */
  autoClearAfterMs?: number;
  /** Override success toast message for this copy action. */
  successMessage?: string;
  /** Override error toast message for this copy action. */
  errorMessage?: string;
  /** Do not show toasts for this copy action. */
  silent?: boolean;
}

interface UseCopyToClipboardReturn {
  copy: (text: string, copyOptions?: CopyToClipboardOptions) => Promise<void>;
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
  const { successMessage = 'Copied!', errorMessage = 'Failed to copy', duration = 2000 } = options;

  const [copied, setCopied] = useState(false);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current) clearTimeout(copiedResetTimerRef.current);
      if (autoClearTimerRef.current) clearTimeout(autoClearTimerRef.current);
    };
  }, []);

  const maybeToastSuccess = (message: string, silent?: boolean) => {
    if (silent) return;
    toast.success(message, { duration: 1500 });
  };

  const maybeToastError = (message: string, silent?: boolean) => {
    if (silent) return;
    toast.error(message);
  };

  const scheduleCopiedReset = (ms: number) => {
    if (copiedResetTimerRef.current) clearTimeout(copiedResetTimerRef.current);
    copiedResetTimerRef.current = setTimeout(() => setCopied(false), ms);
  };

  const scheduleAutoClear = (ms: number) => {
    if (autoClearTimerRef.current) clearTimeout(autoClearTimerRef.current);
    autoClearTimerRef.current = setTimeout(() => {
      // Best-effort: clearing clipboard may fail depending on browser permissions.
      void writeToClipboard('').catch(() => {});
      autoClearTimerRef.current = null;
    }, ms);
  };

  const cancelAutoClear = () => {
    if (autoClearTimerRef.current) {
      clearTimeout(autoClearTimerRef.current);
      autoClearTimerRef.current = null;
    }
  };

  const copy = useCallback(
    async (text: string, copyOptions: CopyToClipboardOptions = {}) => {
      try {
        // Safety: cancel any pending auto-clear from a previous sensitive copy.
        // Otherwise a delayed clear could wipe whatever the user copied afterwards.
        cancelAutoClear();

        if (!text) {
          maybeToastError(
            copyOptions.errorMessage || errorMessage || 'Nothing to copy',
            copyOptions.silent
          );
          return;
        }

        const isSensitive = !!copyOptions.sensitive;
        const shouldConfirm = !!copyOptions.requireConfirmation;

        if (shouldConfirm) {
          const message =
            copyOptions.confirmationMessage ||
            (isSensitive
              ? 'This value is sensitive. Copy to clipboard? (Clipboard may be readable by other apps.)'
              : 'Copy to clipboard?');

          const confirmed = await askConfirm({
            title: isSensitive ? 'Sensitive data' : 'Copy to clipboard',
            message,
            variant: 'warning',
          });
          if (!confirmed) {
            return;
          }
        }

        await writeToClipboard(text);
        setCopied(true);

        const perActionSuccess = copyOptions.successMessage || successMessage;
        maybeToastSuccess(perActionSuccess, copyOptions.silent);

        // Reset copied state after duration
        scheduleCopiedReset(duration);

        const autoClearDefault = isSensitive;
        const shouldAutoClear = copyOptions.autoClear ?? autoClearDefault;
        if (shouldAutoClear) {
          const autoClearAfterMs = copyOptions.autoClearAfterMs ?? (isSensitive ? 15000 : 0);
          if (autoClearAfterMs > 0) scheduleAutoClear(autoClearAfterMs);
        }
      } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        maybeToastError(copyOptions.errorMessage || errorMessage, copyOptions.silent);
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
  options: CopyToClipboardOptions & { message?: string } = {}
): Promise<void> => {
  try {
    // Safety: cancel any pending auto-clear from a previous sensitive copy.
    // This avoids wiping a new clipboard value copied after the sensitive one.
    if (copyToClipboardAutoClearTimer) {
      clearTimeout(copyToClipboardAutoClearTimer);
      copyToClipboardAutoClearTimer = null;
    }

    if (!text) {
      if (!options.silent) toast.error(options.errorMessage || 'Nothing to copy');
      return;
    }

    if (options.requireConfirmation) {
      const message =
        options.confirmationMessage ||
        (options.sensitive
          ? 'This value is sensitive. Copy to clipboard? (Clipboard may be readable by other apps.)'
          : 'Copy to clipboard?');
      const confirmed = await askConfirm({
        title: options.sensitive ? 'Sensitive data' : 'Copy to clipboard',
        message,
        variant: 'warning',
      });
      if (!confirmed) return;
    }

    await writeToClipboard(text);
    if (!options.silent) {
      toast.success(options.successMessage || options.message || 'Copied!', { duration: 1500 });
    }

    const autoClearDefault = !!options.sensitive;
    const shouldAutoClear = options.autoClear ?? autoClearDefault;
    if (shouldAutoClear) {
      const autoClearAfterMs = options.autoClearAfterMs ?? (options.sensitive ? 15000 : 0);
      if (autoClearAfterMs > 0) {
        copyToClipboardAutoClearTimer = setTimeout(() => {
          void writeToClipboard('').catch(() => {});
          copyToClipboardAutoClearTimer = null;
        }, autoClearAfterMs);
      }
    }
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    if (!options.silent) {
      toast.error(options.errorMessage || 'Failed to copy');
    }
  }
};
