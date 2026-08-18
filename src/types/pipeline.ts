export type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed' | 'waiting';

export interface PipelineStepConfig {
  id: string;
  label: string;
  enabled: boolean;
  required: boolean;
  skippable: boolean;
  pauseAfter: boolean;
  allowManual: boolean;
  retryOnFail: boolean;
  status: PipelineStepStatus;
  config: Record<string, unknown>;
}

export interface PipelineConfigEvent {
  provider: string;
  steps: PipelineStepConfig[];
}

export interface PipelineStepEvent {
  jobId: string;
  step: PipelineStepConfig;
}

export interface PipelineStepWaitingEvent {
  jobId: string;
  stepId: string;
  reason: 'pause_after' | 'failure_choose' | 'manual';
  options?: string[];
}

export interface PipelineStepResultEvent {
  jobId: string;
  stepId: string;
  result: Record<string, unknown>;
}

export interface PipelinePausedEvent {
  jobId: string;
  stepId: string;
}

export type PipelineEventType =
  | 'pipeline_config'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_skipped'
  | 'step_waiting'
  | 'step_config_updated'
  | 'pipeline_paused'
  | 'pipeline_resumed'
  | 'pipeline_aborted'
  | 'manual_mode_entered'
  | 'manual_mode_exited'
  | 'manual_mode_active';
