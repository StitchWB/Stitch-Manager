import type { SchedulerReliabilityState } from '../SchedulerReliabilitySection';
import type { SchedulerScheduleState } from '../SchedulerScheduleSection';

export type SchedulerTaskTypeOption = 'scenario' | 'composedFlow' | 'script';

export interface SchedulerTaskFormState {
  name: string;
  description?: string;
  enabled?: boolean;
  taskType: SchedulerTaskTypeOption;
  scriptPath: string;
  profileAlias: string;
  scenarioPath: string;
  composedFlowPath: string;
  composedFlowId: string;
  composedFlowJson: string;
  flowVariablesJson: string;
  emailSourceMode: 'none' | 'manualList' | 'googleSheets';
  emailSourcePolicy: 'strict' | 'fallback_to_pool' | 'prefer_pool';
  emailListRaw: string;
  emailSheetId: string;
  emailSheetColumn: string;
  schedule: SchedulerScheduleState;
  reliability: SchedulerReliabilityState;
  configRaw: string;
}
