import type { ProviderName, OpenAIAutoregResult, FireworksAutoregResult, BitbucketAutoregResult, KiroV2AutoregResult } from '../../../../types/ui';
import type { RegistrationConfig } from '../../../../stores/registration/types';
import type {
  PythonAutoregResult,
  WindsurfAutoregResult,
  TraeAutoregResult,
  GithubAutoregResult,
} from '../../../../types/generated';
import type { PythonAliasStrategy } from '../aliasValidation';
import type { PipelineStepOverride } from '../../../../components/registration/PipelineStepConfigPanel';

export type LogLevel = 'info' | 'error' | 'success' | 'warn' | 'debug';
export type RegistrationStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RegistrationOptions {
  config: RegistrationConfig;
  emailDomain: string;
  useRegistrationV2: boolean;
  launchContext?: {
    source?: 'profile';
    profileAlias?: string;
    targetProvider?: string;
    awsBootstrapAccountId?: number;
    launchMode?: string;
    targetGroupId?: string;
  };
  pipelineStepOverrides?: PipelineStepOverride[];
  onLog: (level: LogLevel, message: string) => void;
  onHistoryEntry: (entry: {
    provider: ProviderName;
    email: string;
    status: RegistrationStatus;
  }) => void;
  onCancelled: () => boolean; // Returns true if cancelled
}

export interface RegistrationSummary {
  successCount: number;
  skipCount: number;
  failCount: number;
}

export type ProviderJobParams = {
  provider: ProviderName;
  email: string | null;
  aliasStrategy: PythonAliasStrategy | null;
  config: RegistrationConfig;
  imapServer: string;
  imapUser: string;
  imapPassword: string;
  onCancelled: () => boolean;
  onLog: (level: LogLevel, message: string) => void;
  launchContext?: RegistrationOptions['launchContext'];
  pipelineStepOverrides?: PipelineStepOverride[];
};

export type ProviderJobResult =
  | PythonAutoregResult
  | WindsurfAutoregResult
  | TraeAutoregResult
  | GithubAutoregResult
  | OpenAIAutoregResult
  | FireworksAutoregResult
  | BitbucketAutoregResult
  | KiroV2AutoregResult;

export type JobPayload<T> = {
  ok?: boolean;
  message?: string | null;
  data?: T;
  error?: { message?: string } | null;
};

export interface RegistrationProcessResult {
  success?: boolean;
  email?: string | null;
  apiKey?: string | null;
  api_key?: string | null;
  error?: string | null;
}
