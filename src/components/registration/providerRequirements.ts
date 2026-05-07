import type { ProviderName } from '../../types/ui';

export interface ProviderRequirementHint {
  title: string;
  points: string[];
}

export const PROVIDER_REQUIREMENT_HINTS: Partial<Record<ProviderName, ProviderRequirementHint>> = {
  openai: {
    title: 'Требования OpenAI',
    points: [
      'Требуется верификация email (IMAP/почтовый ящик должен быть настроен)',
      'Могут появляться CAPTCHA/проверка оплаты/телефона; держите браузер видимым',
      'Возможно ручное вмешательство во время регистрации',
    ],
  },
  aws: {
    title: 'Примечание AWS Builder ID',
    points: ['Для потока AWS не требуется IMAP/верификация email'],
  },
};
