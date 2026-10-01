import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@/lib/i18n';

import { listComposedFlows, type ComposedFlowItem } from '../../../../lib/backend/modules/pythonJobs';
import { formatProfileAliasOptionLabel } from '../../../../lib/profiles/displayName';
import { Button, Input, Select, Textarea } from '@/components/ui';
import { EmailSourceEditor } from './EmailSourceEditor';
import { FlowVariablesEditor } from './FlowVariablesEditor';
import type { SchedulerTaskFormState } from './types';

const SCHEDULER_FLOW_CACHE_KEY = 'scheduler:currentComposedFlow';

interface CachedSchedulerFlow {
  alias: string;
  flowId: string;
  flowName: string;
  flowJson: string;
  updatedAt?: string;
}

interface ComposedFlowSectionProps {
  state: SchedulerTaskFormState;
  set: (patch: Partial<SchedulerTaskFormState>) => void;
}

export function ComposedFlowSection({ state, set }: ComposedFlowSectionProps) {
  const navigate = useNavigate();
  const [composedFlowsLoading, setComposedFlowsLoading] = useState(false);
  const [composedFlowsError, setComposedFlowsError] = useState<string | null>(null);
  const [composedFlows, setComposedFlows] = useState<ComposedFlowItem[]>([]);
  const [expertMode, setExpertMode] = useState(false);

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
    queueMicrotask(() => {
    void refreshComposedFlows();
    });
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

      <FlowVariablesEditor
        composedFlowJson={state.composedFlowJson}
        flowVariablesJson={state.flowVariablesJson}
        set={set}
      />

      <EmailSourceEditor state={state} set={set} />
    </div>
  );
}
