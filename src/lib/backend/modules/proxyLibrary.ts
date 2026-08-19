import { safeInvoke } from '../core';

export type ProxyLibraryType = 'http' | 'socks5';

export interface ProxyLibraryEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  proxyType: ProxyLibraryType;
  enabled: boolean;
  notes?: string | null;
  lastTestAt?: string | null;
  lastTestOk?: boolean | null;
  lastTestLatencyMs?: number | null;
  lastTestError?: string | null;
  lastTestIp?: string | null;
  lastTestLocation?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Per-user ownership flags (absent for guests / legacy shared rows). */
  mine?: boolean;
  shared?: boolean;
  /** Row owner id (null = legacy / instance-shared). Matches wire ``ownerId``. */
  ownerId?: number | null;
  /** Group names the row is shared into. Matches wire ``sharedGroupNames``. */
  sharedGroupNames?: string[];
}

export interface ProxyLibraryDraft {
  label?: string | null;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  proxyType: ProxyLibraryType;
  enabled: boolean;
  notes?: string | null;
}

export interface ProxyLibraryImportIssue {
  lineNo: number;
  linePreview: string;
  reason: string;
}

export interface ProxyLibraryImportResult {
  totalLines: number;
  imported: number;
  skipped: number;
  issues: ProxyLibraryImportIssue[];
  items: ProxyLibraryEntry[];
}

export interface ProxyLibraryBulkRequest {
  text: string;
  defaultType?: ProxyLibraryType;
  defaultEnabled?: boolean;
}

export interface ProxyLibraryUsage {
  profileAliases: string[];
  scenarioPaths: string[];
}

export interface ProxyLibraryMutateResult {
  changed: boolean;
  usage: ProxyLibraryUsage;
}

export interface ProxyLibraryMutateOptions {
  force?: boolean;
}

export interface ProxyLibraryUpdateOptions {
  force?: boolean;
}

export interface ProxyLibraryRuntimeCatalogItem {
  id: string;
  label: string;
  proxyType: ProxyLibraryType;
  host: string;
  port: number;
}

export interface ProxyLibraryDraftTestResult {
  success: boolean;
  responseTimeMs?: number | null;
  ip?: string | null;
  location?: string | null;
  error?: string | null;
  entry?: ProxyLibraryEntry | null;
}

export interface ProxyLibrarySaveUseGuardRequest {
  proxyLibraryId: string;
  maxAgeSeconds?: number;
}

export interface ProxyLibraryParseInputParams {
  raw: string;
  defaultType?: ProxyLibraryType;
}

export class ProxyLibraryError extends Error {
  code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'ProxyLibraryError';
    this.code = code;
  }
}

function normalizeError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const sep = message.indexOf('|');
  if (sep > 0) {
    const code = message.slice(0, sep).trim();
    const rest = message.slice(sep + 1).trim();
    if (/^[a-z0-9_-]+$/i.test(code)) {
      throw new ProxyLibraryError(rest || message, code || null);
    }
  }
  throw new ProxyLibraryError(message, null);
}

export async function listProxyLibrary(): Promise<ProxyLibraryEntry[]> {
  try {
    return await safeInvoke<ProxyLibraryEntry[]>('list_proxy_library');
  } catch (error) {
    normalizeError(error);
  }
}

export async function createOrGetProxyLibraryEntry(
  draft: ProxyLibraryDraft
): Promise<ProxyLibraryEntry> {
  try {
    return await safeInvoke<ProxyLibraryEntry>('create_or_get_proxy_library_entry', { draft });
  } catch (error) {
    normalizeError(error);
  }
}

export async function updateProxyLibraryEntry(params: {
  id: string;
  draft: ProxyLibraryDraft;
  options?: ProxyLibraryUpdateOptions;
}): Promise<ProxyLibraryEntry> {
  try {
    return await safeInvoke<ProxyLibraryEntry>('update_proxy_library_entry', {
      request: {
        id: params.id,
        draft: params.draft,
        options: params.options,
      },
    });
  } catch (error) {
    normalizeError(error);
  }
}

export async function deleteProxyLibraryEntry(params: {
  id: string;
  options?: ProxyLibraryMutateOptions;
}): Promise<ProxyLibraryMutateResult> {
  try {
    return await safeInvoke<ProxyLibraryMutateResult>('delete_proxy_library_entry', {
      request: {
        id: params.id,
        options: params.options,
      },
    });
  } catch (error) {
    normalizeError(error);
  }
}

export async function importProxyLibraryBulk(params: {
  text: string;
  defaultType?: ProxyLibraryType;
  defaultEnabled?: boolean;
}): Promise<ProxyLibraryImportResult> {
  try {
    return await safeInvoke<ProxyLibraryImportResult>('import_proxy_library_bulk', {
      request: {
        text: params.text,
        defaultType: params.defaultType,
        defaultEnabled: params.defaultEnabled,
      },
    });
  } catch (error) {
    normalizeError(error);
  }
}

export async function previewProxyLibraryBulk(
  params: ProxyLibraryBulkRequest
): Promise<ProxyLibraryImportResult> {
  try {
    return await safeInvoke<ProxyLibraryImportResult>('preview_proxy_library_bulk', {
      request: {
        text: params.text,
        defaultType: params.defaultType,
        defaultEnabled: params.defaultEnabled,
      },
    });
  } catch (error) {
    normalizeError(error);
  }
}

export async function getProxyLibraryRuntimeProxyUrl(id: string): Promise<string | null> {
  try {
    return await safeInvoke<string | null>('get_proxy_library_runtime_proxy_url', { id });
  } catch (error) {
    normalizeError(error);
  }
}

export async function getProxyLibraryRuntimeProxyMap(): Promise<Record<string, string>> {
  try {
    return await safeInvoke<Record<string, string>>('get_proxy_library_runtime_proxy_map');
  } catch (error) {
    normalizeError(error);
  }
}

export async function getProxyLibraryUsage(id: string): Promise<ProxyLibraryUsage> {
  try {
    return await safeInvoke<ProxyLibraryUsage>('get_proxy_library_usage', { id });
  } catch (error) {
    normalizeError(error);
  }
}

export async function testProxyLibraryDraft(
  draft: ProxyLibraryDraft,
  options?: { proxyLibraryId?: string | null; persistResult?: boolean }
): Promise<ProxyLibraryDraftTestResult> {
  try {
    return await safeInvoke<ProxyLibraryDraftTestResult>('test_proxy_library_draft', {
      request: {
        draft,
        proxyLibraryId: options?.proxyLibraryId ?? null,
        persistResult: options?.persistResult ?? false,
      },
    });
  } catch (error) {
    normalizeError(error);
  }
}

export async function ensureProxySaveUseAllowed(
  request: ProxyLibrarySaveUseGuardRequest
): Promise<boolean> {
  try {
    return await safeInvoke<boolean>('ensure_proxy_save_use_allowed', { request });
  } catch (error) {
    normalizeError(error);
  }
}

export async function parseProxyLibraryInput(
  params: ProxyLibraryParseInputParams
): Promise<ProxyLibraryDraft> {
  try {
    return await safeInvoke<ProxyLibraryDraft>('parse_proxy_library_input', {
      request: {
        raw: params.raw,
        defaultType: params.defaultType,
      },
    });
  } catch (error) {
    normalizeError(error);
  }
}

export async function getProxyLibraryRuntimeProxyCatalog(): Promise<
  ProxyLibraryRuntimeCatalogItem[]
> {
  const items = await listProxyLibrary();
  return items
    .filter(item => item.enabled)
    .map(item => ({
      id: item.id,
      label: item.label,
      proxyType: item.proxyType,
      host: item.host,
      port: item.port,
    }));
}

export async function claimProxyLibraryEntry(id: string): Promise<{ success: boolean }> {
  try {
    return await safeInvoke<{ success: boolean }>('claim_proxy_library_entry', { id });
  } catch (error) {
    normalizeError(error);
  }
}

export async function shareProxyLibraryEntry(params: {
  entryId: string;
  groupId: string;
}): Promise<{ success: boolean }> {
  try {
    return await safeInvoke<{ success: boolean }>('proxy_share_group', params, { noCache: true });
  } catch (error) {
    normalizeError(error);
  }
}

export async function unshareProxyLibraryEntry(params: {
  entryId: string;
  groupId: string;
}): Promise<{ success: boolean }> {
  try {
    return await safeInvoke<{ success: boolean }>('proxy_unshare_group', params, { noCache: true });
  } catch (error) {
    normalizeError(error);
  }
}
