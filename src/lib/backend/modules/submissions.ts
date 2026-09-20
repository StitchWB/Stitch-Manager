/**
 * Plugin Submissions Module
 *
 * User submissions + admin moderation for community plugins. Thin typed
 * wrappers over the backend proxy commands (plugin_distribution/
 * submission_commands.py) which forward to the distribution server.
 * Uses `safeInvoke` like marketplace.ts — these are command-registry
 * endpoints (/api/{command}), not REST proxies like dist.ts/partners.ts.
 *
 * The backend commands never raise: failures arrive as
 * `{success: false, error}` dicts (submit_plugin additionally carries a
 * `gate_report` on 422 gate failures). `safeInvoke` itself throws
 * BackendError only on transport-level failures.
 */

import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

/**
 * Badges a marketplace item can carry. 'verified' is COMPUTED server-side
 * (attestation present and its sha256 matches the approved package) and is
 * never accepted by set_plugin_badges.
 */
export type PluginBadge = 'recommended' | 'verified' | 'works' | 'not_works';

/** Badges an admin may set manually (server rejects 'verified' with 422). */
export type ManualPluginBadge = Exclude<PluginBadge, 'verified'>;

export type SubmissionSourceType = 'release' | 'upload';

export type SubmissionReviewStatus = 'pending' | 'approved' | 'rejected' | 'delisted';

export interface SubmitPluginParams {
  source_type: SubmissionSourceType;
  plugin_id: string;
  version: string;
  /** Release tarball URL — required for source_type 'release'. */
  source_url?: string;
  /** Expected package sha256 — required for source_type 'release'. */
  sha256?: string;
  /** Hosts the plugin's goto steps may navigate to (OC4 gate). */
  declared_domains: string[];
  /** Local zip path — required for source_type 'upload' (≤ 5 MB). */
  zip_path?: string;
}

/** Single auto-gate result inside a gate_report. */
export interface GateResult {
  pass: boolean;
  detail: string;
}

export type GateReport = Record<string, GateResult>;

/** 422 gate-failure detail passed through by the backend on submit. */
export interface GateFailureDetail {
  error?: string;
  gates?: GateReport;
}

export interface SubmitPluginResult {
  success: boolean;
  submission_id?: number;
  status?: string;
  sha256?: string | null;
  error?: string;
  gate_report?: GateFailureDetail | null;
}

export interface PluginSubmissionSummary {
  id: number;
  plugin_id: string;
  version: string;
  source_type: string;
  submitted_by_name: string | null;
  review_status: SubmissionReviewStatus | string;
  /** Only present on some list responses; detail always carries it. */
  rejection_reason?: string | null;
  created_at: string;
}

/** Offline-signed attestation blob (OC3), uploaded post-approve via CLI. */
export interface SubmissionAttestation {
  reviewed_by: string;
  reviewed_at: string;
  sha256: string;
  signature: string;
}

export interface PluginSubmissionDetail {
  id: number;
  plugin_id: string;
  version: string;
  source_type: string;
  source_url: string | null;
  source_ref: string | null;
  declared_domains: string[];
  sha256: string | null;
  manifest_json: Record<string, unknown>;
  gate_report: GateReport | null;
  submitted_by_tg_id: number | null;
  submitted_by_name: string | null;
  review_status: SubmissionReviewStatus | string;
  reviewer: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  attestation: SubmissionAttestation | null;
  package_files: string[] | null;
  created_at: string;
}

export interface SubmissionListResult {
  success: boolean;
  submissions?: PluginSubmissionSummary[];
  error?: string;
}

export interface SubmissionDetailResult {
  success: boolean;
  submission?: PluginSubmissionDetail;
  error?: string;
}

export interface SubmissionActionResult {
  success: boolean;
  submission_id?: number;
  status?: string;
  error?: string;
}

export interface ListSubmissionsParams {
  status?: SubmissionReviewStatus | string;
  plugin_id?: string;
}

export interface SetPluginBadgesResult {
  success: boolean;
  plugin_id?: string;
  badges?: string[];
  error?: string;
}

// ============================================
// Commands (user-facing)
// ============================================

/**
 * Submit a plugin to the moderation queue. `source_type: 'release'` needs
 * source_url + sha256; `'upload'` needs a local zip_path (≤ 5 MB, enforced
 * by the backend). Gate failures return `{success: false, error,
 * gate_report: {error, gates}}`.
 */
export async function submitPlugin(params: SubmitPluginParams): Promise<SubmitPluginResult> {
  return safeInvoke<SubmitPluginResult>('submit_plugin', { ...params }, { noCache: true });
}

/**
 * The submissions queue for the current caller. LIMITATION: the upstream
 * server has no per-user endpoint — the backend gates this to admin callers
 * and returns the full queue; non-admin callers get
 * `{success: false, error: 'admin only'}`.
 */
export async function mySubmissions(): Promise<SubmissionListResult> {
  return safeInvoke<SubmissionListResult>('my_submissions', {}, { noCache: true });
}

// ============================================
// Commands (admin moderation)
// ============================================

/** GET /admin/submissions — queue with optional status / plugin_id filter. */
export async function listSubmissions(params: ListSubmissionsParams = {}): Promise<SubmissionListResult> {
  return safeInvoke<SubmissionListResult>('list_submissions', { ...params }, { noCache: true });
}

/** GET /admin/submissions/{id} — full detail incl. manifest + gate_report.
 *
 * The backend passes the server's SubmissionDetail through flat
 * (`{success, id, plugin_id, ...}`); normalize it into `{success,
 * submission}` for consumers.
 */
export async function getSubmission(id: number): Promise<SubmissionDetailResult> {
  const raw = await safeInvoke<SubmissionDetailResult & Partial<PluginSubmissionDetail>>(
    'get_submission', { id }, { noCache: true },
  );
  if (raw.submission) return raw;
  if (!raw.success || typeof raw.id !== 'number') return raw;
  const { success, error, submission: _ignored, ...detail } = raw;
  return { success, error, submission: detail as PluginSubmissionDetail };
}

/** Re-run all gates on the materialized package and publish it. */
export async function approveSubmission(id: number, reviewer: string): Promise<SubmissionActionResult> {
  return safeInvoke<SubmissionActionResult>('approve_submission', { id, reviewer }, { noCache: true });
}

/** Reject with a mandatory reason. */
export async function rejectSubmission(id: number, reason: string, reviewer?: string): Promise<SubmissionActionResult> {
  const args: Record<string, unknown> = { id, reason };
  if (reviewer) args.reviewer = reviewer;
  return safeInvoke<SubmissionActionResult>('reject_submission', args, { noCache: true });
}

/** Hide an approved submission from the catalog (OC10; TOFU keeps installs working). */
export async function delistSubmission(id: number): Promise<SubmissionActionResult> {
  return safeInvoke<SubmissionActionResult>('delist_submission', { id }, { noCache: true });
}

/**
 * Set the manual badges of an approved plugin. `badges` must be a subset of
 * {recommended, works, not_works} — 'verified' is computed server-side and
 * rejected with 422; works/not_works are mutually exclusive server-side.
 */
export async function setPluginBadges(pluginId: string, badges: ManualPluginBadge[]): Promise<SetPluginBadgesResult> {
  return safeInvoke<SetPluginBadgesResult>(
    'set_plugin_badges',
    { plugin_id: pluginId, badges },
    { noCache: true },
  );
}
