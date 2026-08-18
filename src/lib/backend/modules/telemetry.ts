/**
 * Telemetry / Failure Reports Module
 *
 * Handles pending failure-report bundles:
 * - List pending reports
 * - Preview the exact bundle that will be sent
 * - Send or discard a report
 *
 * Consent for sending reports is stored as a setting (key `telemetry_consent`,
 * value "true"/"false") via the existing settings module.
 */

import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

export interface PendingReport {
  id: string;
  plugin_id: string;
  version: string;
  step: string;
  step_kind: string;
  created_at: string;
  scrubbed: boolean;
  size_bytes: number;
  error_preview: string;
}

export interface GetPendingReportsResponse {
  reports: PendingReport[];
}

export interface ReportPreview {
  id: string;
  bundle: Record<string, unknown>;
  sensitive_dropped: boolean;
}

export interface SendReportResult {
  success: boolean;
  error?: string;
}

export interface DiscardReportResult {
  success: boolean;
  error?: string;
}

// ============================================
// Commands
// ============================================

/**
 * List pending failure-report bundles awaiting user action.
 */
export async function getPendingReports(): Promise<GetPendingReportsResponse> {
  return safeInvoke<GetPendingReportsResponse>('get_pending_reports');
}

/**
 * Fetch the exact bundle that will be sent for a pending report.
 */
export async function getReportPreview(params: { id: string }): Promise<ReportPreview> {
  return safeInvoke<ReportPreview>('get_report_preview', { id: params.id });
}

/**
 * Send a pending report bundle to the telemetry endpoint.
 */
export async function sendReport(params: { id: string }): Promise<SendReportResult> {
  return safeInvoke<SendReportResult>('send_report', { id: params.id });
}

/**
 * Discard a pending report without sending.
 */
export async function discardReport(params: { id: string }): Promise<DiscardReportResult> {
  return safeInvoke<DiscardReportResult>('discard_report', { id: params.id });
}
