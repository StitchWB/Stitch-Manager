/**
 * File dialog utilities.
 *
 * All file picker / save picker / file read operations go through the
 * Python backend via HTTP commands.
 */

import { safeInvoke } from '@/lib/backend/core/invoke';

// ── Types ────────────────────────────────────────────────────────────────────

interface FileFilter {
  name: string;
  extensions: string[];
}

interface OpenDialogOptions {
  title?: string;
  multiple?: boolean;
  filters?: FileFilter[];
  directory?: boolean;
}

interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
}

// ── Functions ────────────────────────────────────────────────────────────────

/**
 * Open a file picker dialog. Returns the selected path(s) or null if cancelled.
 */
export async function openFileDialog(
  options: OpenDialogOptions = {},
): Promise<string | string[] | null> {
  const result = await safeInvoke<{ selected: string | string[] | null }>(
    'open_file_dialog',
    {
      title: options.title ?? 'Open',
      multiple: options.multiple ?? false,
      filters: options.filters ?? [],
      directory: options.directory ?? false,
    },
  );
  return result.selected ?? null;
}

/**
 * Open a save-file dialog. Returns the chosen path or null if cancelled.
 */
export async function saveFileDialog(
  options: SaveDialogOptions = {},
): Promise<string | null> {
  const result = await safeInvoke<{ selected: string | null }>(
    'save_file_dialog',
    {
      title: options.title ?? 'Save',
      defaultPath: options.defaultPath ?? '',
      filters: options.filters ?? [],
    },
  );
  return result.selected ?? null;
}

/**
 * Read a text file by absolute path (replaces `convertFileSrc` + fetch).
 */
export async function readFileText(path: string): Promise<string> {
  const result = await safeInvoke<{ content: string; size: number; path: string }>(
    'read_file_text',
    { path },
  );
  return result.content;
}
