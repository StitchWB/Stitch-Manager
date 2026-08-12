export type ScenarioStepKind = 'click' | 'change' | 'submit' | 'nav' | 'proxy.switch' | 'unknown';

export type ScenarioRunnerMode = 'native' | 'extension';

/** Which engine actually captures browser events in a native run. */
export type ScenarioCaptureMode = 'extension' | 'injected';

export interface ScenarioRecordedStep {
  kind: ScenarioStepKind | string;
  ts: string;
  url: string | null;
  selector: string | null;
  value: string | null;
  meta: Record<string, unknown>;
}

export interface RecordedScenarioV1 {
  version: 1;
  name: string;
  runId: string;
  alias: string;
  startedUrl: string;
  recordedAt: string;
  steps: ScenarioRecordedStep[];
}

export type ScenarioRecordStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'done'
  | 'error';
