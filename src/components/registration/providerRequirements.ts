import type { ProviderName } from '../../types/ui';

export interface ProviderRequirementHint {
  title: string;
  points: string[];
}

export const PROVIDER_REQUIREMENT_HINTS: Partial<Record<ProviderName, ProviderRequirementHint>> = {
  openai: {
    title: 'OpenAI requirements',
    points: [
      'Email verification required (IMAP/mailbox must be configured)',
      'CAPTCHA/payment/phone checks may appear; keep browser visible',
      'Expect occasional manual intervention during sign-up',
    ],
  },
  aws: {
    title: 'AWS Builder ID note',
    points: ['No IMAP/email verification required for AWS flow'],
  },
};
