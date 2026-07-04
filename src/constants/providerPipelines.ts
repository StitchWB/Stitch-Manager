/**
 * Shared pipeline step definitions per provider.
 *
 * Each provider that supports the pipeline UI declares its steps here.
 * The UI renders them generically for any provider that has an entry.
 */

import type { PipelineStepOverride } from '../components/registration/PipelineStepConfigPanel';

export interface ProviderPipelineConfig {
  /** Whether this provider requires a billing/card step */
  needsBilling: boolean;
  /** Default pipeline steps shown in the LaunchPad */
  steps: PipelineStepOverride[];
}

/**
 * Pipeline definitions keyed by provider id.
 * Only providers listed here will show pipeline steps in the UI.
 */
export const PROVIDER_PIPELINES: Record<string, ProviderPipelineConfig> = {
  fireworks: {
    needsBilling: true,
    steps: [
      { id: 'signup', label: 'Sign Up', enabled: true, pauseAfter: false, skippable: false },
      { id: 'confirm_email', label: 'Confirm Email', enabled: true, pauseAfter: false, skippable: false },
      { id: 'onboarding', label: 'Onboarding', enabled: true, pauseAfter: false, skippable: true },
      { id: 'api_key', label: 'Create API Key', enabled: true, pauseAfter: false, skippable: true },
      { id: 'billing', label: 'Add Billing', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
  kiro_v2: {
    needsBilling: true,
    steps: [
      { id: 'landing', label: 'Landing → Sign In', enabled: true, pauseAfter: false, skippable: false },
      { id: 'builder_id', label: 'Builder ID Form', enabled: true, pauseAfter: false, skippable: false },
      { id: 'verification', label: 'Email Verification', enabled: true, pauseAfter: false, skippable: false },
      { id: 'password', label: 'Set Password', enabled: true, pauseAfter: false, skippable: false },
      { id: 'oauth_redirect', label: 'OAuth Redirect', enabled: true, pauseAfter: false, skippable: false },
      { id: 'stripe_billing', label: 'Stripe Billing', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
  qoder: {
    needsBilling: false,
    steps: [
      { id: 'signup', label: 'Sign Up Form', enabled: true, pauseAfter: false, skippable: false },
      { id: 'otp_verify', label: 'OTP Verification', enabled: true, pauseAfter: false, skippable: false },
      { id: 'create_token', label: 'Create Access Token', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
  v0_app: {
    needsBilling: false,
    steps: [
      { id: 'signup', label: 'Sign Up', enabled: true, pauseAfter: false, skippable: false },
      { id: 'verify_email', label: 'Verify Email', enabled: true, pauseAfter: false, skippable: false },
      { id: 'onboarding', label: 'Onboarding', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
};

/**
 * Get default pipeline steps for a provider, or empty array if none defined.
 */
export function getProviderPipelineSteps(provider: string): PipelineStepOverride[] {
  return PROVIDER_PIPELINES[provider]?.steps ?? [];
}

/**
 * Check if a provider needs billing (card) support.
 */
export function providerNeedsBilling(provider: string): boolean {
  return PROVIDER_PIPELINES[provider]?.needsBilling ?? false;
}
