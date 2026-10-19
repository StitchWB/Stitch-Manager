import { useCallback, useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';

import { SchedulerScenarioPicker } from './SchedulerScenarioPicker';
import { SchedulerReliabilitySection } from './SchedulerReliabilitySection';
import { SchedulerScheduleSection } from './SchedulerScheduleSection';
import { ComposedFlowSection } from './taskForm/ComposedFlowSection';
import { FlowCompilePreview } from './taskForm/FlowCompilePreview';
import { buildEffectiveConfig } from './taskForm/taskConfig';
import type { SchedulerTaskFormState } from './taskForm/types';
import { Input, Select, Textarea, Toggle } from '@/components/ui';

export type { SchedulerTaskFormState, SchedulerTaskTypeOption } from './taskForm/types';
export {
  buildEffectiveConfig,
  buildScheduleFromState,
  buildTaskTypeFromState,
  validateTaskFormState,
} from './taskForm/taskConfig';

interface SchedulerTaskFormProps {
  state: SchedulerTaskFormState;
  onChange: (next: SchedulerTaskFormState) => void;
  showDescription?: boolean;
  showEnabled?: boolean;
}

export function SchedulerTaskForm({
  state,
  onChange,
  showDescription = false,
  showEnabled = false,
}: SchedulerTaskFormProps) {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const set = useCallback(
    (patch: Partial<SchedulerTaskFormState>) => onChange({ ...stateRef.current, ...patch }),
    [onChange]
  );

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
          const nextType = e.target.value as SchedulerTaskFormState['taskType'];
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
        <ComposedFlowSection state={state} set={set} />
      ) : null}

      {state.taskType === 'composedFlow' ? (
        <FlowCompilePreview composedFlowJson={state.composedFlowJson} />
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
