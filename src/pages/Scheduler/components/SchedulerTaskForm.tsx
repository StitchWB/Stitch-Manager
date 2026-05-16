import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@/lib/i18n';

import type { Schedule, TaskType } from '../../../types/generated';
import { SchedulerScenarioPicker } from './SchedulerScenarioPicker';
import { listComposedFlows, type ComposedFlowItem } from '../../../lib/tauri/modules/pythonJobs';
import { useGoogleSheetsDataset } from '../../../hooks/useGoogleSheetsDataset';
import { useRegistrationStore } from '../../../stores/registration';
import {
  SchedulerReliabilitySection,
  type SchedulerReliabilityState,
} from './SchedulerReliabilitySection';
import { SchedulerScheduleSection, type SchedulerScheduleState } from './SchedulerScheduleSection';
import { compileComposedFlow } from '../../../lib/scenarioFlow/compiler';
import type { ComposedFlow } from '../../../lib/scenarioFlow/types';
import { formatProfileAliasOptionLabel } from '../../../lib/profiles/displayName';
import { Button, Input, Select, Textarea, Toggle } from '@/components/ui';

const SCHEDULER_FLOW_CACHE_KEY = 'scheduler:currentComposedFlow';

interface CachedSchedulerFlow {
  alias: string;
  flowId: string;
  flowName: string;
  flowJson: string;
  updatedAt?: string;
}

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

interface SchedulerTaskFormProps {
  state: SchedulerTaskFormState;
  onChange: (next: SchedulerTaskFormState) => void;
  showDescription?: boolean;
  showEnabled?: boolean;
}

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

function parseFlowObject(raw: string): ComposedFlow | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const asFlow = parsed as ComposedFlow;
    if (!Array.isArray(asFlow.nodes) || !Array.isArray(asFlow.dataLists)) return null;
    return asFlow;
  } catch {
    return null;
  }
}

function collectFlowInputKeys(flow: ComposedFlow): string[] {
  const keys = new Set<string>();
  for (const node of flow.nodes ?? []) {
    if (node.type !== 'runScenario') continue;
    for (const binding of Object.values(node.bindings ?? {})) {
      if (binding.kind === 'input' && binding.key.trim()) {
        keys.add(binding.key.trim());
      }
    }
  }
  for (const key of Object.keys(flow.inputDefaults ?? {})) {
    if (key.trim()) keys.add(key.trim());
  }
  return Array.from(keys.values());
}

function parseStringRecord(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce(
      (acc, [key, value]) => {
        acc[key] = value == null ? '' : String(value);
        return acc;
      },
      {} as Record<string, string>
    );
  } catch {
    return {};
  }
}

export function isScheduleStateValid(schedule: SchedulerScheduleState): boolean {
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

export function SchedulerTaskForm({
  state,
  onChange,
  showDescription = false,
  showEnabled = false,
}: SchedulerTaskFormProps) {
  const navigate = useNavigate();
  const stateRef = useRef(state);
  stateRef.current = state;
  const set = useCallback(
    (patch: Partial<SchedulerTaskFormState>) => onChange({ ...stateRef.current, ...patch }),
    [onChange]
  );
  const [composedFlowsLoading, setComposedFlowsLoading] = useState(false);
  const [composedFlowsError, setComposedFlowsError] = useState<string | null>(null);
  const [composedFlows, setComposedFlows] = useState<ComposedFlowItem[]>([]);
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarValue, setNewVarValue] = useState('');
  const [expertMode, setExpertMode] = useState(false);
  const [compileCheck, setCompileCheck] = useState<{
    ok: boolean;
    message: string;
    segments: Array<{ index: number; alias: string; name: string; scenarioPath: string }>;
    diagnostics: string[];
  } | null>(null);
  const registrationConfig = useRegistrationStore(s => s.config);

  const sheetsParams = useMemo(() => {
    const spreadsheetId = registrationConfig.advanced.googleSheetsSpreadsheetId?.trim();
    const serviceAccountJson = registrationConfig.advanced.googleSheetsServiceAccountJson?.trim();
    if (!spreadsheetId || !serviceAccountJson) return null;
    return { spreadsheetId, serviceAccountJson };
  }, [
    registrationConfig.advanced.googleSheetsSpreadsheetId,
    registrationConfig.advanced.googleSheetsServiceAccountJson,
  ]);

  const {
    dataset: sheetsDataset,
    isLoading: sheetsLoading,
    error: sheetsError,
    refresh: refreshSheets,
  } = useGoogleSheetsDataset({
    autoFetch: state.taskType === 'composedFlow' && state.emailSourceMode === 'googleSheets',
    params: sheetsParams,
  });

  const refreshComposedFlows = useCallback(async () => {
    const alias = state.profileAlias.trim();
    if (!alias || state.taskType !== 'composedFlow') {
      setComposedFlows([]);
      setComposedFlowsError(null);
      return;
    }
    setComposedFlowsLoading(true);
    setComposedFlowsError(null);
    try {
      const items = await listComposedFlows({ alias, limit: 100 });
      setComposedFlows(items);
    } catch (error) {
      setComposedFlowsError(
        error instanceof Error ? error.message : t('scheduler.failedToLoadFlows')
      );
      setComposedFlows([]);
    } finally {
      setComposedFlowsLoading(false);
    }
  }, [state.profileAlias, state.taskType]);

  useEffect(() => {
    void refreshComposedFlows();
  }, [refreshComposedFlows]);

  const composedFlowOptions = useMemo(
    () => [
      {
        value: '',
        label: composedFlowsLoading ? t('scheduler.loadingFlows') : t('scheduler.selectFlow'),
      },
      ...composedFlows.map(flow => ({
        value: flow.id,
        label: `${flow.name} • ${formatProfileAliasOptionLabel(flow.alias)} (${flow.runCount} runs)`,
      })),
    ],
    [composedFlows, composedFlowsLoading]
  );

  const selectedComposedFlow = useMemo(
    () => composedFlows.find(item => item.id === state.composedFlowId),
    [composedFlows, state.composedFlowId]
  );

  const sheetOptions = useMemo(
    () => [
      { value: '', label: sheetsLoading ? t('scheduler.loadingSheets') : t('scheduler.selectSheet') },
      ...(sheetsDataset?.sheets ?? []).map(sheet => ({
        value: sheet.id,
        label: `${sheet.name} (${sheet.rowCount ?? sheet.rows.length})`,
      })),
    ],
    [sheetsDataset?.sheets, sheetsLoading]
  );

  const sheetColumnOptions = useMemo(() => {
    const selectedSheet = (sheetsDataset?.sheets ?? []).find(s => s.id === state.emailSheetId);
    const columns = selectedSheet?.columns ?? [];
    return [
      { value: '', label: t('scheduler.selectColumn') },
      ...columns.map(col => ({ value: col, label: col })),
    ];
  }, [sheetsDataset?.sheets, state.emailSheetId]);

  const parsedFlow = useMemo(
    () => parseFlowObject(state.composedFlowJson),
    [state.composedFlowJson]
  );

  const compiledFlowPreview = useMemo(
    () => (parsedFlow ? compileComposedFlow(parsedFlow) : null),
    [parsedFlow]
  );

  const flowInputKeys = useMemo(
    () => (parsedFlow ? collectFlowInputKeys(parsedFlow) : []),
    [parsedFlow]
  );

  const flowVariables = useMemo(
    () => parseStringRecord(state.flowVariablesJson),
    [state.flowVariablesJson]
  );

  const variableKeys = useMemo(() => {
    const out = new Set<string>(flowInputKeys);
    Object.keys(flowVariables).forEach(key => {
      if (key.trim()) out.add(key.trim());
    });
    return Array.from(out.values());
  }, [flowInputKeys, flowVariables]);

  const setFlowVariables = useCallback(
    (next: Record<string, string>) => {
      set({
        flowVariablesJson: JSON.stringify(next, null, 2),
      });
    },
    [set]
  );

  const updateFlowVariable = useCallback(
    (key: string, value: string) => {
      const next = { ...flowVariables, [key]: value };
      setFlowVariables(next);
    },
    [flowVariables, setFlowVariables]
  );

  const removeFlowVariable = useCallback(
    (key: string) => {
      const next = { ...flowVariables };
      delete next[key];
      setFlowVariables(next);
    },
    [flowVariables, setFlowVariables]
  );

  const addFlowVariable = useCallback(() => {
    const key = newVarKey.trim();
    if (!key) return;
    const next = { ...flowVariables, [key]: newVarValue };
    setFlowVariables(next);
    setNewVarKey('');
    setNewVarValue('');
  }, [flowVariables, newVarKey, newVarValue, setFlowVariables]);

  const runCompileCheck = useCallback(() => {
    if (!parsedFlow) {
      setCompileCheck({
        ok: false,
        message: t('scheduler.flowJsonInvalid'),
        segments: [],
        diagnostics: [t('scheduler.provideValidFlowJson')],
      });
      return;
    }

    const compiled = compileComposedFlow(parsedFlow);
    setCompileCheck({
      ok: compiled.diagnostics.length === 0 && compiled.segments.length > 0,
      message:
        compiled.segments.length > 0
          ? `Compiled ${compiled.segments.length} runnable segment(s)`
          : t('scheduler.noRunnableSegments'),
      segments: compiled.segments.map(seg => ({
        index: seg.index,
        alias: seg.alias,
        name: seg.name,
        scenarioPath: seg.scenarioPath,
      })),
      diagnostics: compiled.diagnostics,
    });
  }, [parsedFlow]);

  const openInScenariosComposer = useCallback(() => {
    const alias = state.profileAlias.trim();
    if (!alias) return;
    const params = new URLSearchParams();
    params.set('alias', alias);
    params.set('openCompose', '1');
    if (state.composedFlowId.trim()) {
      params.set('flowId', state.composedFlowId.trim());
    }
    navigate(`/scenarios?${params.toString()}`);
  }, [navigate, state.composedFlowId, state.profileAlias]);

  const applyCachedFlowFromComposer = useCallback(() => {
    try {
      const raw = localStorage.getItem(SCHEDULER_FLOW_CACHE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as CachedSchedulerFlow;
      if (!parsed || typeof parsed !== 'object') return;
      if (typeof parsed.alias !== 'string' || typeof parsed.flowJson !== 'string') return;

      set({
        profileAlias: parsed.alias,
        composedFlowId: typeof parsed.flowId === 'string' ? parsed.flowId : '',
        composedFlowJson: parsed.flowJson,
      });
    } catch {
      // ignore broken localStorage payload
    }
  }, [set]);

  useEffect(() => {
    if (state.taskType !== 'composedFlow') return;
    if (!state.composedFlowId.trim()) return;
    if (state.composedFlowJson.trim()) return;
    if (!selectedComposedFlow?.flowJson) return;

    set({
      composedFlowJson: selectedComposedFlow.flowJson,
    });
  }, [
    selectedComposedFlow?.flowJson,
    set,
    state.composedFlowId,
    state.composedFlowJson,
    state.taskType,
  ]);

  return (
    <div className="space-y-4">
      <Input
        label="Task name"
        value={state.name}
        onChange={e => set({ name: e.target.value })}
        placeholder="e.g., Morning scenario replay"
      />

      {showDescription ? (
        <Textarea
          label="Description"
          value={state.description ?? ''}
          onChange={e => set({ description: e.target.value })}
          rows={2}
        />
      ) : null}

      {showEnabled ? (
        <div>
          <div className="block text-sm font-medium text-vsc-text mb-2">{t('scheduler.enabled')}</div>
          <Toggle
            label={t('scheduler.taskEnabled')}
            checked={Boolean(state.enabled)}
            onChange={enabled => set({ enabled })}
          />
        </div>
      ) : null}

      <Select
        label="Task type"
        value={state.taskType}
        onChange={e => {
          const nextType = e.target.value as SchedulerTaskTypeOption;
          if (nextType === 'scenario') {
            set({
              taskType: nextType,
              scriptPath: 'python/run_scenario_replay.py',
            });
            return;
          }
          if (nextType === 'composedFlow') {
            set({
              taskType: nextType,
              scriptPath: 'python/run_composed_flow.py',
            });
            return;
          }
          set({ taskType: nextType });
        }}
      >
        <option value="scenario">{t('scheduler.taskTypeScenario')}</option>
        <option value="composedFlow">{t('scheduler.taskTypeComposedFlow')}</option>
        <option value="script">{t('scheduler.taskTypeScript')}</option>
      </Select>

      {state.taskType === 'script' ? (
        <Input
          label="Script path"
          value={state.scriptPath}
          onChange={e => set({ scriptPath: e.target.value })}
          placeholder="python/my_script.py"
        />
      ) : null}

      {state.taskType === 'scenario' ? (
        <SchedulerScenarioPicker
          profileAlias={state.profileAlias}
          onProfileAliasChange={profileAlias => set({ profileAlias, scenarioPath: '' })}
          scenarioPath={state.scenarioPath}
          onScenarioPathChange={scenarioPath => set({ scenarioPath })}
        />
      ) : null}

      {state.taskType === 'composedFlow' ? (
        <div className="rounded-md border border-vsc-border bg-vsc-input/40 p-3 space-y-3">
          <div className="text-sm font-medium text-vsc-text">{t('scheduler.composedFlowTarget')}</div>
          <Input
            label="Profile alias"
            value={state.profileAlias}
            onChange={e =>
              set({
                profileAlias: e.target.value,
                composedFlowId: '',
                composedFlowJson: '',
              })
            }
            placeholder="profile alias"
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Select
              label="Saved composed flow"
              value={state.composedFlowId}
              options={composedFlowOptions}
              onValueChange={value => {
                if (!value) {
                  set({
                    composedFlowId: '',
                    composedFlowJson: '',
                    composedFlowPath: '',
                  });
                  return;
                }
                const selected = composedFlows.find(item => item.id === value);
                set({
                  composedFlowId: value,
                  composedFlowJson: selected?.flowJson ?? '',
                  composedFlowPath: '',
                });
              }}
            />
            <div className="flex items-end">
              <Button variant="secondary" onClick={() => void refreshComposedFlows()}>
                {t('scheduler.refreshFlows')}
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Button variant="secondary" onClick={applyCachedFlowFromComposer}>
                {t('scheduler.useCurrentFromComposer')}
              </Button>
              <Button
                variant="secondary"
                onClick={openInScenariosComposer}
                disabled={!state.profileAlias.trim()}
              >
                {t('scheduler.openInComposer')}
              </Button>
              <div className="text-xs text-vsc-muted">{composedFlowsError ?? ''}</div>
            </div>
          </div>

          <div className="rounded-md border border-vsc-border bg-vsc-input/20 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-vsc-text-muted">
                {selectedComposedFlow
                  ? `Using saved flow: ${selectedComposedFlow.name}`
                  : state.composedFlowId
                    ? `Using flow id: ${state.composedFlowId}`
                    : t('scheduler.noSavedFlowSelected')}
              </div>
              <Button variant="secondary" size="sm" onClick={() => setExpertMode(prev => !prev)}>
                {expertMode ? t('scheduler.hideExpertMode') : t('scheduler.showExpertMode')}
              </Button>
            </div>
            <div className="text-xs text-vsc-muted">
              {t('scheduler.flowJsonHelpText')}
            </div>
            {state.emailSourceMode === 'googleSheets' ? (
              <div className="text-xs text-vsc-muted">
                {t('scheduler.currentEmailSourcePolicy')}{' '}
                <span className="text-vsc-text">{state.emailSourcePolicy}</span>
              </div>
            ) : null}
          </div>

          {expertMode ? (
            <div className="rounded-md border border-vsc-border bg-vsc-input/20 p-3 space-y-3">
              <div className="text-xs text-vsc-text-muted">{t('scheduler.expertMode')}</div>
              <Input
                label={t('scheduler.compiledPlanPath')}
                value={state.composedFlowPath}
                onChange={e => set({ composedFlowPath: e.target.value })}
                placeholder="C:\\...\\compiled-plan.json"
              />
              <Textarea
                label="Flow JSON"
                rows={5}
                value={state.composedFlowJson}
                onChange={e => set({ composedFlowJson: e.target.value })}
                placeholder='{"id":"flow_...", "nodes": [...] }'
                className="bg-vsc-input border-vsc-border text-vsc-text font-mono text-sm"
                shellClassName="bg-vsc-input border-vsc-border"
              />
            </div>
          ) : null}

          <div className="rounded-md border border-vsc-border bg-vsc-input/20 p-3 space-y-2">
            <div className="text-xs text-vsc-text-muted">{t('scheduler.flowInputVariables')}</div>

            {variableKeys.length === 0 ? (
              <div className="text-xs text-vsc-muted">{t('scheduler.noInputKeysDetected')}</div>
            ) : (
              <div className="space-y-2">
                {variableKeys.map(key => {
                  const detected = flowInputKeys.includes(key);
                  return (
                    <div key={key} className="grid grid-cols-1 md:grid-cols-[1fr,2fr,auto] gap-2">
                      <Input label="Key" value={key} disabled className="h-9" />
                      <Input
                        label="Value"
                        value={flowVariables[key] ?? ''}
                        onChange={e => updateFlowVariable(key, e.target.value)}
                        className="h-9"
                      />
                      <div className="flex items-end">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => removeFlowVariable(key)}
                          disabled={detected}
                          title={detected ? t('scheduler.detectedKeysCannotBeRemoved') : t('scheduler.removeVariable')}
                        >
                          {t('scheduler.remove')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-[1fr,2fr,auto] gap-2">
              <Input
                label={t('scheduler.newKey')}
                value={newVarKey}
                onChange={e => setNewVarKey(e.target.value)}
                className="h-9"
                placeholder="customKey"
              />
              <Input
                label={t('scheduler.newValue')}
                value={newVarValue}
                onChange={e => setNewVarValue(e.target.value)}
                className="h-9"
                placeholder="value"
              />
              <div className="flex items-end">
                <Button variant="secondary" size="sm" onClick={addFlowVariable}>
                  {t('scheduler.add')}
                </Button>
              </div>
            </div>
          </div>

          <Select
            label={t('scheduler.emailSourceOverride')}
            value={state.emailSourceMode}
            options={[
              { value: 'none', label: t('scheduler.none') },
              { value: 'manualList', label: t('scheduler.manualList') },
              { value: 'googleSheets', label: t('scheduler.googleSheetsColumn') },
            ]}
            onValueChange={value =>
              set({
                emailSourceMode: value as SchedulerTaskFormState['emailSourceMode'],
              })
            }
          />

          {state.emailSourceMode === 'googleSheets' ? (
            <Select
              label="Email source policy"
              value={state.emailSourcePolicy}
              options={[
{ value: 'strict', label: t('scheduler.strict') },
    { value: 'fallback_to_pool', label: t('scheduler.fallbackToPool') },
    { value: 'prefer_pool', label: t('scheduler.preferPool') },
              ]}
              onValueChange={value =>
                set({
                  emailSourcePolicy: value as SchedulerTaskFormState['emailSourcePolicy'],
                })
              }
            />
          ) : null}

          {state.emailSourceMode === 'manualList' ? (
            <Textarea
              label="Email list (one per line)"
              rows={4}
              value={state.emailListRaw}
              onChange={e => set({ emailListRaw: e.target.value })}
              placeholder={'first@example.com\nsecond@example.com'}
              className="bg-vsc-input border-vsc-border text-vsc-text font-mono text-sm"
              shellClassName="bg-vsc-input border-vsc-border"
            />
          ) : null}

          {state.emailSourceMode === 'googleSheets' ? (
            <div className="rounded-md border border-vsc-border bg-vsc-input/30 p-3 space-y-3">
              {!sheetsParams ? (
                <div className="text-xs text-amber-300">
                  {t('scheduler.configureGoogleSheets')}
                </div>
              ) : (
                <>
                  {sheetsError ? <div className="text-xs text-amber-300">{sheetsError}</div> : null}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Select
                      label={t('scheduler.sheet')}
                      value={state.emailSheetId}
                      options={sheetOptions}
                      onValueChange={value =>
                        set({
                          emailSheetId: value,
                          emailSheetColumn: '',
                        })
                      }
                    />
                    <Select
                      label={t('scheduler.column')}
                      value={state.emailSheetColumn}
                      options={sheetColumnOptions}
                      onValueChange={value => set({ emailSheetColumn: value })}
                    />
                    <div className="flex items-end">
                      <Button variant="secondary" onClick={() => void refreshSheets()}>
                        {t('scheduler.refreshSheets')}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {state.taskType === 'composedFlow' ? (
        <div className="rounded-md border border-vsc-border bg-vsc-input/20 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-vsc-text-muted">{t('scheduler.composedFlowPreview')}</div>
            <Button variant="secondary" size="sm" onClick={runCompileCheck}>
              {t('scheduler.testCompile')}
            </Button>
          </div>
          {parsedFlow ? (
            <>
              <div>{t('scheduler.flowName')} {parsedFlow.name || t('scheduler.unnamed')}</div>
              <div>{t('scheduler.flowNodes')} {parsedFlow.nodes.length}</div>
              <div>
                {t('scheduler.runnableSegments')} {compiledFlowPreview?.segments.length ?? 0} • {t('scheduler.diagnostics')}{' '}
                {compiledFlowPreview?.diagnostics.length ?? 0}
              </div>
            </>
          ) : (
            <div className="text-vsc-muted">{t('scheduler.provideValidFlowJsonPreview')}</div>
          )}

          {compileCheck ? (
            <div className="mt-2 rounded-md border border-vsc-border bg-vsc-input/20 p-2 space-y-1">
              <div className={compileCheck.ok ? 'text-green-400' : 'text-amber-300'}>
                {compileCheck.message}
              </div>
              {compileCheck.diagnostics.length > 0 ? (
                <div className="text-amber-300">
                  {compileCheck.diagnostics.map(item => (
                    <div key={item}>• {item}</div>
                  ))}
                </div>
              ) : null}
              {compileCheck.segments.length > 0 ? (
                <div className="text-vsc-muted">
                  {compileCheck.segments.map(seg => (
                    <div key={`${seg.index}:${seg.scenarioPath}`}>
                      #{seg.index} [{seg.alias}] {seg.name} → {seg.scenarioPath}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <SchedulerScheduleSection
        value={state.schedule}
        onChange={schedule => set({ schedule })}
        title="Schedule"
      />

      <SchedulerReliabilitySection
        value={state.reliability}
        onChange={reliability => set({ reliability })}
      />

      <Textarea
        label="Additional config JSON"
        rows={4}
        value={state.configRaw}
        onChange={e => set({ configRaw: e.target.value })}
        className="bg-vsc-input border-vsc-border text-vsc-text font-mono text-sm"
        shellClassName="bg-vsc-input border-vsc-border"
      />

      <Textarea
        label="Effective config preview"
        rows={6}
        value={JSON.stringify(buildEffectiveConfig(state), null, 2)}
        onChange={() => {}}
        className="bg-vsc-input border-vsc-border text-vsc-text font-mono text-sm"
        shellClassName="bg-vsc-input border-vsc-border"
        disabled
      />
    </div>
  );
}
