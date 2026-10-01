import { t } from '@/lib/i18n';

import type { Schedule, TaskType } from '../../../../types/generated';
import type { SchedulerScheduleState } from '../SchedulerScheduleSection';
import { compileComposedFlow } from '../../../../lib/scenarioFlow/compiler';
import type { ComposedFlow } from '../../../../lib/scenarioFlow/types';
import type { SchedulerTaskFormState, SchedulerTaskTypeOption } from './types';

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function isScheduleStateValid(schedule: SchedulerScheduleState): boolean {
  if (schedule.scheduleType === 'once') {
    return (
      Number.isFinite(new Date(schedule.onceDateTime).getTime()) && Boolean(schedule.onceDateTime)
    );
  }
  if (schedule.scheduleType === 'interval') {
    return Number(schedule.intervalSeconds) > 0;
  }
  return (
    Number(schedule.hour) >= 0 &&
    Number(schedule.hour) <= 23 &&
    Number(schedule.minute) >= 0 &&
    Number(schedule.minute) <= 59
  );
}

export function buildScheduleFromState(schedule: SchedulerScheduleState): Schedule {
  if (schedule.scheduleType === 'interval') {
    return { interval: { seconds: Math.max(1, Number(schedule.intervalSeconds) || 1) } };
  }
  if (schedule.scheduleType === 'daily') {
    return {
      daily: {
        hour: Math.min(23, Math.max(0, Number(schedule.hour) || 0)),
        minute: Math.min(59, Math.max(0, Number(schedule.minute) || 0)),
      },
    };
  }
  const ts = Math.floor(new Date(schedule.onceDateTime).getTime() / 1000);
  return {
    once: { timestamp: Number.isFinite(ts) ? ts : Math.floor(Date.now() / 1000) },
  };
}

export function buildTaskTypeFromState(
  taskType: SchedulerTaskTypeOption,
  scriptPath: string
): TaskType {
  if (taskType === 'scenario') {
    return { customScript: { script_path: 'python/run_scenario_replay.py' } };
  }
  if (taskType === 'composedFlow') {
    return { customScript: { script_path: 'python/run_composed_flow.py' } };
  }
  return { customScript: { script_path: scriptPath.trim() || 'python/run_scenario_replay.py' } };
}

export function buildEffectiveConfig(state: SchedulerTaskFormState): Record<string, unknown> {
  const base = parseJsonObject(state.configRaw);
  delete base.runtime;

  if (state.taskType !== 'scenario') {
    delete base.alias;
    delete base.scenarioPath;
    if (base.mode === 'scenario_replay') {
      delete base.mode;
    }
  }

  if (state.taskType !== 'composedFlow') {
    delete base.flowId;
    delete base.planPath;
    delete base.planJson;
    delete base.flow;
    if (base.mode === 'composed_flow') {
      delete base.mode;
    }
  }

  if (state.reliability.retryEnabled) {
    base.retryPolicy = {
      maxAttempts: Math.max(0, Number(state.reliability.retryMaxAttempts) || 0),
      backoffSeconds: Math.max(1, Number(state.reliability.retryBackoffSeconds) || 1),
      backoffMultiplier: Math.max(1, Number(state.reliability.retryBackoffMultiplier) || 1),
      maxBackoffSeconds: Math.max(1, Number(state.reliability.retryMaxBackoffSeconds) || 1),
    };
  } else {
    delete base.retryPolicy;
  }

  base.quietHours = {
    enabled: state.reliability.quietEnabled,
    startHour: Math.min(23, Math.max(0, Number(state.reliability.quietStartHour) || 0)),
    startMinute: Math.min(59, Math.max(0, Number(state.reliability.quietStartMinute) || 0)),
    endHour: Math.min(23, Math.max(0, Number(state.reliability.quietEndHour) || 0)),
    endMinute: Math.min(59, Math.max(0, Number(state.reliability.quietEndMinute) || 0)),
  };

  if (state.taskType === 'scenario') {
    base.alias = state.profileAlias.trim();
    base.scenarioPath = state.scenarioPath.trim();
    base.mode = 'scenario_replay';
  } else if (state.taskType === 'composedFlow') {
    base.alias = state.profileAlias.trim();
    if (state.composedFlowId.trim()) {
      base.flowId = state.composedFlowId.trim();
    }
    const rawPlanPath = state.composedFlowPath.trim();
    if (rawPlanPath) {
      base.planPath = rawPlanPath;
    } else {
      delete base.planPath;
    }

    let inputValues: Record<string, string> | undefined;
    if (state.flowVariablesJson.trim()) {
      try {
        const parsedVars = JSON.parse(state.flowVariablesJson);
        if (parsedVars && typeof parsedVars === 'object' && !Array.isArray(parsedVars)) {
          inputValues = Object.entries(parsedVars).reduce(
            (acc, [k, v]) => {
              acc[k] = v == null ? '' : String(v);
              return acc;
            },
            {} as Record<string, string>
          );
        }
      } catch {
        // keep defaults if invalid
      }
    }

    if (inputValues && Object.keys(inputValues).length > 0) {
      base.flowInputValues = inputValues;
    } else {
      delete base.flowInputValues;
    }

    if (
      state.emailSourceMode === 'googleSheets' &&
      state.emailSheetId.trim() &&
      state.emailSheetColumn.trim()
    ) {
      base.emailSource = {
        mode: 'googleSheets',
        sheetId: state.emailSheetId.trim(),
        column: state.emailSheetColumn.trim(),
        policy: state.emailSourcePolicy,
      };
    } else {
      delete base.emailSource;
    }

    // If we have flow JSON, compute compiled plan now.
    const rawFlowJson = state.composedFlowJson.trim();
    if (rawFlowJson) {
      try {
        const flow = JSON.parse(rawFlowJson) as ComposedFlow;
        if (flow && typeof flow === 'object' && !Array.isArray(flow)) {
          let effectiveFlow: ComposedFlow = flow;

          const emailValues = state.emailListRaw
            .split(/\r?\n/g)
            .map(v => v.trim())
            .filter(Boolean);

          if (emailValues.length > 0) {
            const hasPool = flow.dataLists.some(source => source.id === 'emails_pool');
            effectiveFlow = {
              ...flow,
              dataLists: hasPool
                ? flow.dataLists.map(source =>
                    source.id === 'emails_pool' ? { ...source, values: emailValues } : source
                  )
                : [
                    ...flow.dataLists,
                    {
                      id: 'emails_pool',
                      values: emailValues,
                      strategy: 'next',
                    },
                  ],
            };
          }

          base.flow = effectiveFlow;

          const compiled = compileComposedFlow(effectiveFlow, {
            contextOverride: state.profileAlias.trim()
              ? {
                  alias: state.profileAlias.trim(),
                }
              : undefined,
            inputValues,
          });
          base.planJson = JSON.stringify(compiled);
        }
      } catch {
        // keep raw fallback only
      }
    } else {
      // no flow object
      delete base.flow;
      delete base.planJson;
      delete base.flowInputValues;
    }
    base.mode = 'composed_flow';
  }

  return base;
}

export function validateTaskFormState(state: SchedulerTaskFormState): string | null {
  if (!state.name.trim()) {
    return t('scheduler.taskNameRequired');
  }

  if (!isScheduleStateValid(state.schedule)) {
    return t('scheduler.scheduleInvalid');
  }

  if (state.taskType === 'scenario') {
    if (!state.profileAlias.trim()) {
      return t('scheduler.profileRequired');
    }
    if (!state.scenarioPath.trim()) {
      return t('scheduler.scenarioPathRequired');
    }
  } else if (state.taskType === 'composedFlow') {
    if (!state.profileAlias.trim()) {
      return t('scheduler.profileRequiredForFlow');
    }
    if (
      !state.composedFlowId.trim() &&
      !state.composedFlowPath.trim() &&
      !state.composedFlowJson.trim()
    ) {
      return t('scheduler.selectSavedFlow');
    }
    if (state.composedFlowJson.trim()) {
      try {
        const parsed = JSON.parse(state.composedFlowJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return t('scheduler.flowJsonMustBeObject');
        }
      } catch {
        return t('scheduler.flowJsonMustBeValid');
      }
    }

    if (state.flowVariablesJson.trim()) {
      try {
        const parsed = JSON.parse(state.flowVariablesJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return t('scheduler.flowVarsJsonMustBeObject');
        }
      } catch {
        return t('scheduler.flowVarsJsonMustBeValid');
      }
    }

    if (state.emailSourceMode === 'manualList' && !state.emailListRaw.trim()) {
      return t('scheduler.emailListEmpty');
    }

    if (state.emailSourceMode === 'googleSheets') {
      if (!state.emailSheetId.trim()) {
        return t('scheduler.googleSheetsRequiresSheet');
      }
      if (!state.emailSheetColumn.trim()) {
        return t('scheduler.googleSheetsRequiresColumn');
      }
    }
  }

  if (state.taskType === 'script' && !state.scriptPath.trim()) {
    return t('scheduler.scriptPathRequired');
  }

  try {
    const parsed = JSON.parse(state.configRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return t('scheduler.additionalConfigJsonMustBeObject');
    }
  } catch {
    return t('scheduler.additionalConfigJsonMustBeValid');
  }

  return null;
}
