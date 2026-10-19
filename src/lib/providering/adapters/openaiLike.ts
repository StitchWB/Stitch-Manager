import type { IdeProviderAdapter } from '../contracts';

/**
 * OpenAI-compatible IDE/CLI tools read OPENAI_BASE_URL + OPENAI_API_KEY.
 */
export const openAiLikeAdapter: IdeProviderAdapter = {
  key: 'openai-like',
  getManualEnvPayload: ({ endpoint, provider }) => {
    return `OPENAI_BASE_URL=${endpoint}\nOPENAI_API_KEY=${provider.defaultApiKey}`;
  },
};
