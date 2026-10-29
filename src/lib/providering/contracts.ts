export type ProviderKey = string;

export interface ProviderProfile {
  key: ProviderKey;
  label: string;
  description: string;
  defaultApiKey: string;
}

export interface ManualEnvBuildInput {
  endpoint: string;
  provider: ProviderProfile;
}

export interface IdeProviderAdapter {
  key: ProviderKey;
  getManualEnvPayload: (input: ManualEnvBuildInput) => string;
}
