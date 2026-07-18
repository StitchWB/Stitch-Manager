/**
 * Shared pipeline step definitions per provider.
 *
 * Stable step IDs are sent to the runtime; labels are presentation-only and
 * therefore may be localized without affecting execution.
 */

import type { PipelineStepOverride } from '../components/registration/PipelineStepConfigPanel';

export interface ProviderPipelineConfig {
  /** Whether this provider has a billing-related step. */
  needsBilling: boolean;
  /** Default pipeline steps shown before a run starts. */
  steps: PipelineStepOverride[];
}

export const PROVIDER_PIPELINES: Record<string, ProviderPipelineConfig> = {
  fireworks: {
    needsBilling: true,
    steps: [
      { id: 'signup', label: 'Создание профиля', enabled: true, pauseAfter: false, skippable: false },
      { id: 'confirm_email', label: 'Подтверждение email', enabled: true, pauseAfter: false, skippable: false },
      { id: 'onboarding', label: 'Первичная настройка', enabled: true, pauseAfter: false, skippable: true },
      { id: 'api_key', label: 'Создание API-ключа', enabled: true, pauseAfter: false, skippable: true },
      { id: 'billing', label: 'Настройка оплаты', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
  kiro_v2: {
    needsBilling: true,
    steps: [
      { id: 'landing', label: 'Переход к входу', enabled: true, pauseAfter: false, skippable: false },
      { id: 'builder_id', label: 'Профиль Builder ID', enabled: true, pauseAfter: false, skippable: false },
      { id: 'verification', label: 'Подтверждение email', enabled: true, pauseAfter: false, skippable: false },
      { id: 'password', label: 'Создание пароля', enabled: true, pauseAfter: false, skippable: false },
      { id: 'oauth_redirect', label: 'Авторизация', enabled: true, pauseAfter: false, skippable: false },
      { id: 'mfa_registration', label: 'Настройка 2FA', enabled: true, pauseAfter: false, skippable: true },
      { id: 'stripe_billing', label: 'Настройка оплаты', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
  qoder: {
    needsBilling: false,
    steps: [
      { id: 'signup', label: 'Создание профиля', enabled: true, pauseAfter: false, skippable: false },
      { id: 'otp_verify', label: 'Подтверждение кода', enabled: true, pauseAfter: false, skippable: false },
      { id: 'create_token', label: 'Создание токена доступа', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
  v0_app: {
    needsBilling: false,
    steps: [
      { id: 'signup', label: 'Создание профиля', enabled: true, pauseAfter: false, skippable: false },
      { id: 'verify_email', label: 'Подтверждение email', enabled: true, pauseAfter: false, skippable: false },
      { id: 'onboarding', label: 'Первичная настройка', enabled: true, pauseAfter: false, skippable: true },
    ],
  },
};

export function getProviderPipelineSteps(provider: string): PipelineStepOverride[] {
  return PROVIDER_PIPELINES[provider]?.steps ?? [];
}

export function providerNeedsBilling(provider: string): boolean {
  return PROVIDER_PIPELINES[provider]?.needsBilling ?? false;
}
