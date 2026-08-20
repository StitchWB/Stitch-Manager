/**
 * Registration Module
 *
 * Handles all registration-related operations including:
 * - AWS Cognito registration (no browser)
 * - Device Flow OAuth
 * - Python browser automation (DrissionPage)
 * - Provider-specific registration (Windsurf, Trae, GitHub)
 * - Registration job management
 * - Registration V2 flow
 */

import type { OpenAIAutoregConfig, FireworksAutoregConfig, QoderAutoregConfig, BitbucketAutoregConfig, KiroV2AutoregConfig, V0AppAutoregConfig, RegistrationJob } from '../../../types/ui';
import type {
  PythonAutoregConfig,
  WindsurfAutoregConfig,
  TraeAutoregConfig,
  GithubAutoregConfig,
  RegistrationStatus,
} from '../../../types/generated';
import { safeInvoke } from '../core';
import { emailInboxConnect, emailInboxDisconnect, type EmailProviderType } from './emailInbox';

export interface PythonAutoregLaunchContext {
  launchProfileAlias?: string | null;
  launchMode?: string | null;
  awsBootstrapAccountId?: number | null;
}

export type ExtendedPythonAutoregConfig = PythonAutoregConfig & PythonAutoregLaunchContext;

export interface InboxPreflightParams {
  provider: EmailProviderType;
  imapServer?: string;
  imapPort?: number;
  imapUser?: string;
  imapPassword?: string;
  useTls?: boolean;
  mailbox?: string;
  mailtmAddress?: string;
  mailtmPassword?: string;
  mailtmBaseUrl?: string;
}

/**
 * Unified inbox preflight check.
 * Validates provider credentials by doing connect -> disconnect roundtrip.
 */
export async function testInboxConnection(params: InboxPreflightParams): Promise<string> {
  const provider = params.provider;

  const input =
    provider === 'mail_tm'
      ? {
          provider: 'mail_tm' as const,
          accountId: `mailtm:${params.mailtmAddress || 'unknown'}`,
          credentials: {
            type: 'mail_tm' as const,
            value: {
              address: params.mailtmAddress || '',
              password: params.mailtmPassword || '',
              baseUrl: params.mailtmBaseUrl || null,
            },
          },
          options: { mailbox: null, readOnly: false },
        }
      : {
          provider: 'imap' as const,
          accountId: `imap:${params.imapUser || 'unknown'}`,
          credentials: {
            type: 'imap' as const,
            value: {
              host: params.imapServer || '',
              port: params.imapPort || 993,
              username: params.imapUser || '',
              password: params.imapPassword || '',
              useTls: params.useTls ?? true,
            },
          },
          options: { mailbox: params.mailbox || 'INBOX', readOnly: false },
        };

  const session = await emailInboxConnect(input);
  try {
    return `Inbox connection successful (${session.provider})`;
  } finally {
    await emailInboxDisconnect(session.sessionId).catch(() => undefined);
  }
}

// ============================================
// Provider Plugins
// ============================================

/**
 * Provider plugin descriptor returned by the backend `get_providers` command.
 *
 * After the backend inversion, `get_providers` returns ONLY installed-plugin
 * providers — empty by default. Each provider is a separate plugin that must
 * be installed from the Marketplace before it appears here.
 */
export interface ProviderInfo {
  id: string;
  displayName: string;
  requiresMachineId: boolean;
}

/**
 * List all registered provider plugins.
 *
 * Returns only installed-plugin providers (empty by default). Each provider is
 * a separate plugin — install plugins from the Marketplace to add registrations.
 */
export async function getProviders(): Promise<ProviderInfo[]> {
  const result = await safeInvoke<{ providers: ProviderInfo[] }>('get_providers', {});
  return result.providers;
}

// ============================================
// Python Browser Automation
// ============================================

export interface AutoRegParams {
  email: string;
  password: string;
  provider?: string;
}

export interface ConfirmRegistrationParams {
  email: string;
  code: string;
}

/**
 * Experimental: start Python autoreg through unified Python JobManager.
 * Returns jobId immediately; caller can poll status and consume obs:event stream.
 */
export async function startPythonAutoregJob(
  config: ExtendedPythonAutoregConfig
): Promise<{ jobId: string }> {
  // Single authoritative backend path to avoid frontend/backend drift.
  return safeInvoke<{ jobId: string }>('start_python_autoreg_job', { config });
}

/**
 * Check if Python and required dependencies (DrissionPage) are available
 */
export async function checkPythonAutoreg(): Promise<boolean> {
  return safeInvoke<boolean>('check_python_autoreg');
}

// ============================================
// Windsurf Registration
// ============================================

export async function startWindsurfAutoregJob(
  config: WindsurfAutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_windsurf_autoreg_job', { config });
}

// ============================================
// Trae Registration
// ============================================

export async function startTraeAutoregJob(config: TraeAutoregConfig): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_trae_autoreg_job', { config });
}

// ============================================
// GitHub Registration
// ============================================

export async function startGithubAutoregJob(
  config: GithubAutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_github_autoreg_job', { config });
}

// ============================================
// OpenAI Registration
// ============================================

export async function startOpenAIAutoregJob(
  config: OpenAIAutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_openai_autoreg_job', { config });
}

// ============================================
// Fireworks AI Registration
// ============================================

export async function startFireworksAutoregJob(
  config: FireworksAutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_fireworks_autoreg_job', { config });
}

// ============================================
// Qoder Registration (CloakBrowser + Aliyun slider captcha)
// ============================================

export async function startQoderAutoregJob(
  config: QoderAutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_qoder_autoreg_job', { config });
}

// ============================================
// v0 App Registration
// ============================================

export async function startV0AppAutoregJob(
  config: V0AppAutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_v0_app_autoreg_job', { config });
}

export interface ReferralDonor {
  id: string;
  email: string;
  refCode: string | null;
  refUrl: string | null;
  refUsedCount: number;
  refMaxCount: number;
  status: string;
}

/**
 * List v0_app referral donors and the id of the donor that auto-selection
 * would use next. Powers the donor picker on the registration page.
 */
export async function getReferralDonors(): Promise<{
  donors: ReferralDonor[];
  activeDonorId: string | null;
}> {
  return safeInvoke<{ donors: ReferralDonor[]; activeDonorId: string | null }>(
    'get_referral_donors',
    {}
  );
}

// ============================================
// Bitbucket Registration
// ============================================

export async function startBitbucketAutoregJob(
  config: BitbucketAutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_bitbucket_autoreg_job', { config });
}

// ============================================
// Kiro v2 Registration (web sign-up + Stripe billing)
// ============================================

export async function startKiroV2AutoregJob(
  config: KiroV2AutoregConfig
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('start_kiro_v2_autoreg_job', { config });
}

/**
 * Authorize a registered Kiro / Kiro v2 account into the Kiro IDE via the
 * existing-AWS-session OAuth flow. Triggers a Python job — the result is
 * delivered through the standard ``obs:event`` stream.
 */
export async function authorizeKiroAccount(
  accountId: number,
  options?: { headless?: boolean }
): Promise<{ jobId: string }> {
  return safeInvoke<{ jobId: string }>('authorize_kiro_account', {
    accountId,
    headless: options?.headless ?? false,
  });
}

// ============================================
// Registration Job Management
// ============================================

export interface StopRegistrationParams {
  jobId?: string;
}

/**
 * Stop registration process (specific job or all)
 */
export async function stopRegistration(params?: StopRegistrationParams): Promise<void> {
  return safeInvoke<void>('stop_registration', { jobId: params?.jobId });
}

/**
 * Get all registration jobs
 */
export async function getRegistrationJobs(): Promise<RegistrationJob[]> {
  return safeInvoke<RegistrationJob[]>('get_registration_jobs');
}

/**
 * Get a specific registration job by ID
 */
export async function getRegistrationJob(params: { jobId: string }): Promise<RegistrationJob> {
  return safeInvoke<RegistrationJob>('get_registration_job', { jobId: params.jobId });
}

/**
 * Clear completed/failed registration jobs
 */
export async function clearRegistrationJobs(params?: { status?: string }): Promise<void> {
  return safeInvoke<void>('clear_registration_jobs', params);
}

/**
 * Get registration status
 */
export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  return safeInvoke<RegistrationStatus>('get_registration_status');
}

// ============================================
// Pipeline Control
// ============================================

export type PipelineControlAction = 'pause' | 'resume' | 'skip' | 'retry' | 'abort' | 'manual' | 'configure';

export async function registrationControl(
  jobId: string,
  command: PipelineControlAction,
  stepId?: string,
  data?: Record<string, unknown>,
): Promise<void> {
  return safeInvoke<void>('registration_control', { jobId, command, stepId, data });
}

// ============================================
// Registration V2
// ============================================

export interface StartRegistrationV2Params {
  email: string | null;
  name: string | null;
  password: string | null;
  provider?: string;
}

export interface RegistrationV2Result {
  success: boolean;
  email: string;
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

/**
 * Start Registration V2 flow using RegistrationFlow service
 *
 * This uses the new Rust-based registration orchestrator with:
 * - OAuth PKCE flow
 * - Browser automation via Python worker
 * - IMAP verification code retrieval
 * - Progress events emitted to frontend
 */
export async function startRegistrationV2(
  params: StartRegistrationV2Params
): Promise<RegistrationV2Result> {
  return safeInvoke<RegistrationV2Result>('start_registration_v2_command', {
    params,
  });
}
