import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Input, Select, Textarea, Checkbox } from '@/components/ui';
import { toast } from 'sonner';
import {
  type ComposedFlowItem,
  type PythonJobStatus,
  deleteComposedFlow,
  getPythonJobStatus,
  listComposedFlows,
  listRecordedScenarios,
  markComposedFlowRan,
  startComposedFlowJob,
  upsertComposedFlow,
} from '@/lib/tauri/modules/pythonJobs';
import { useGoogleSheetsDataset } from '@/hooks/useGoogleSheetsDataset';
import { useRegistrationStore } from '@/stores/registration';
import { compileComposedFlow } from '@/lib/scenarioFlow/compiler';
import { createEmptyComposedFlow } from '@/lib/scenarioFlow/fixtures';
import { formatProfileAliasOptionLabel } from '@/lib/profiles/displayName';
import type {
  ComposedFlow,
  ComposedFlowNode,
  FlowBinding,
  FlowContextBindingPath,
  FlowListPickStrategy,
  FlowRunScenarioNode,
  FlowSwitchContextNode,
} from '@/lib/scenarioFlow/types';

type ComposedFlowModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
};

type JobRunState = {
  jobId: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  error: string | null;
  lastJobStatus: PythonJobStatus | null;
};

const mkNodeId = () => `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const SCHEDULER_FLOW_CACHE_KEY = 'scheduler:currentComposedFlow';

const cacheFlowForScheduler = (payload: {
  alias: string;
  flowId: string;
  flowJson: string;
  flowName: string;
}) => {
  try {
    localStorage.setItem(
      SCHEDULER_FLOW_CACHE_KEY,
      JSON.stringify({
        ...payload,
        updatedAt: new Date().toISOString(),
      })
    );
  } catch {
    // ignore storage errors
  }
};

const parseFlowItem = (item: ComposedFlowItem): ComposedFlow | null => {
  try {
    const parsed = JSON.parse(item.flowJson) as ComposedFlow;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.nodes)) return null;
    return {
      ...parsed,
      id: item.id,
      alias: item.alias,
      name: item.name,
    };
  } catch {
    return null;
  }
};

export function ComposedFlowModal({ alias, isOpen, onClose }: ComposedFlowModalProps) {
  const navigate = useNavigate();
  const [scenariosLoading, setScenariosLoading] = useState(false);
  const [scenarios, setScenarios] = useState<
    Array<{ id: string; name: string; scenarioPath: string }>
  >([]);

  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flows, setFlows] = useState<ComposedFlowItem[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [flow, setFlow] = useState<ComposedFlow | null>(null);

  const [saveLoading, setSaveLoading] = useState(false);
  const [runState, setRunState] = useState<JobRunState>({
    jobId: null,
    status: 'idle',
    error: null,
    lastJobStatus: null,
  });

  const registrationConfig = useRegistrationStore(state => state.config);
  const sheetsParams = useMemo(() => {
    const spreadsheetId = registrationConfig.advanced.googleSheetsSpreadsheetId?.trim();
    const serviceAccountJson = registrationConfig.advanced.googleSheetsServiceAccountJson?.trim();
    if (!spreadsheetId || !serviceAccountJson) return null;
    return { spreadsheetId, serviceAccountJson };
  }, [
    registrationConfig.advanced.googleSheetsServiceAccountJson,
    registrationConfig.advanced.googleSheetsSpreadsheetId,
  ]);
  const {
    dataset: sheetsDataset,
    isLoading: sheetsLoading,
    error: sheetsError,
    refresh: refreshSheets,
  } = useGoogleSheetsDataset({
    autoFetch: Boolean(isOpen && sheetsParams),
    params: sheetsParams,
  });
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [selectedSheetColumn, setSelectedSheetColumn] = useState<string>('');

  const refresh = useCallback(async () => {
    if (!alias) return;

    setScenariosLoading(true);
    setFlowsLoading(true);
    try {
      const [scenarioItems, flowItems] = await Promise.all([
        listRecordedScenarios({ alias, limit: 100 }),
        listComposedFlows({ alias, limit: 100 }),
      ]);

      setScenarios(
        scenarioItems.map(item => ({
          id: item.id,
          name: item.name,
          scenarioPath: item.scenarioPath,
        }))
      );
      setFlows(flowItems);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load composed flow data');
    } finally {
      setScenariosLoading(false);
      setFlowsLoading(false);
    }
  }, [alias]);

  useEffect(() => {
    if (!isOpen || !alias) return;
    void refresh();
  }, [alias, isOpen, refresh]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFlowId('');
      setFlow(null);
      setRunState({ jobId: null, status: 'idle', error: null, lastJobStatus: null });
      setSelectedSheetId('');
      setSelectedSheetColumn('');
      return;
    }
    if (alias && !flow) {
      setFlow(createEmptyComposedFlow(alias));
    }
  }, [alias, flow, isOpen]);

  useEffect(() => {
    if (!selectedFlowId) return;
    const selected = flows.find(item => item.id === selectedFlowId);
    if (!selected) return;

    const parsed = parseFlowItem(selected);
    if (!parsed) {
      toast.error('Selected flow JSON is invalid');
      return;
    }

    setFlow(parsed);
    setRunState({ jobId: null, status: 'idle', error: null, lastJobStatus: null });
  }, [flows, selectedFlowId]);

  useEffect(() => {
    const jobId = runState.jobId;
    if (!jobId || runState.status !== 'running') return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        if (cancelled) return;
        const status = await getPythonJobStatus(jobId);
        if (!status) return;

        if (status.state === 'succeeded') {
          setRunState({
            jobId: null,
            status: 'done',
            error: null,
            lastJobStatus: status,
          });
          if (flow?.id) {
            void markComposedFlowRan(flow.id).catch(() => {});
          }
          toast.success('Composed flow finished');
          return;
        }

        if (
          status.state === 'failed' ||
          status.state === 'cancelled' ||
          status.state === 'timedout'
        ) {
          setRunState({
            jobId: null,
            status: 'error',
            error: status.error ?? `Job ${status.state}`,
            lastJobStatus: status,
          });
          toast.error(status.error ?? `Composed flow failed: ${status.state}`);
          return;
        }

        setRunState(prev => ({ ...prev, lastJobStatus: status }));
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [flow?.id, runState.jobId, runState.status]);

  const compilePreview = useMemo(() => {
    if (!flow) {
      return null;
    }
    return compileComposedFlow(flow);
  }, [flow]);

  const flowOptions = useMemo(
    () => [
      { value: '', label: 'New flow' },
      ...flows.map(item => ({
        value: item.id,
        label: `${item.name} • ${formatProfileAliasOptionLabel(item.alias)} (${item.runCount} runs)`,
      })),
    ],
    [flows]
  );

  const scenarioOptions = useMemo(
    () => [
      { value: '', label: 'Select scenario...' },
      ...scenarios.map(item => ({
        value: item.scenarioPath,
        label: `${item.name} • ${item.scenarioPath}`,
      })),
    ],
    [scenarios]
  );

  const updateFlow = useCallback((fn: (prev: ComposedFlow) => ComposedFlow) => {
    setFlow(prev => {
      if (!prev) return prev;
      const next = fn(prev);
      return {
        ...next,
        updatedAt: new Date().toISOString(),
      };
    });
  }, []);

  const sheetOptions = useMemo(
    () => [
      { value: '', label: sheetsLoading ? 'Loading sheets...' : 'Select sheet' },
      ...(sheetsDataset?.sheets ?? []).map(sheet => ({
        value: sheet.id,
        label: `${sheet.name} (${sheet.rowCount ?? sheet.rows.length})`,
      })),
    ],
    [sheetsDataset?.sheets, sheetsLoading]
  );

  const sheetColumnOptions = useMemo(() => {
    const sheet = (sheetsDataset?.sheets ?? []).find(item => item.id === selectedSheetId);
    const columns = sheet?.columns ?? [];
    return [
      { value: '', label: 'Select column' },
      ...columns.map(col => ({ value: col, label: col })),
    ];
  }, [selectedSheetId, sheetsDataset?.sheets]);

  const importEmailsFromSheet = useCallback(() => {
    const sheet = (sheetsDataset?.sheets ?? []).find(item => item.id === selectedSheetId);
    if (!sheet) {
      toast.error('Select a sheet first');
      return;
    }
    if (!selectedSheetColumn) {
      toast.error('Select a column first');
      return;
    }

    const values = sheet.rows
      .map(row => {
        const value = row[selectedSheetColumn];
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number') return String(value);
        return '';
      })
      .filter(Boolean)
      .filter(value => value.includes('@'));

    if (values.length === 0) {
      toast.error('No email-like values found in selected column');
      return;
    }

    updateFlow(prev => {
      const rest = prev.dataLists.filter(d => d.id !== 'emails_pool');
      return {
        ...prev,
        dataLists: [
          {
            id: 'emails_pool',
            values,
            strategy: 'next',
          },
          ...rest,
        ],
      };
    });
    toast.success(`Imported ${values.length} emails from Google Sheets`);
  }, [selectedSheetColumn, selectedSheetId, sheetsDataset?.sheets, updateFlow]);

  const exportCompiledPlan = useCallback(() => {
    if (!flow) {
      toast.error('Nothing to export');
      return;
    }
    const plan = compileComposedFlow(flow);
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (flow.name || 'composed_flow').replace(/[^a-zA-Z0-9_-]+/g, '_');
    a.download = `${safeName}_compiled_plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flow]);

  const updateNode = useCallback(
    (nodeId: string, updater: (node: ComposedFlowNode) => ComposedFlowNode) => {
      updateFlow(prev => ({
        ...prev,
        nodes: prev.nodes.map(node => (node.id === nodeId ? updater(node) : node)),
      }));
    },
    [updateFlow]
  );

  const addRunNode = useCallback(() => {
    updateFlow(prev => {
      const node: FlowRunScenarioNode = {
        id: mkNodeId(),
        type: 'runScenario',
        name: `Run scenario #${prev.nodes.length + 1}`,
        scenarioPath: '',
        startUrl: null,
        continueOnError: false,
        bindings: {},
        contextOverride: {},
      };
      return {
        ...prev,
        nodes: [...prev.nodes, node],
      };
    });
  }, [updateFlow]);

  const addSwitchNode = useCallback(() => {
    updateFlow(prev => {
      const node: FlowSwitchContextNode = {
        id: mkNodeId(),
        type: 'switchContext',
        name: `Switch context #${prev.nodes.length + 1}`,
        context: {},
      };
      return {
        ...prev,
        nodes: [...prev.nodes, node],
      };
    });
  }, [updateFlow]);

  const removeNode = useCallback(
    (nodeId: string) => {
      updateFlow(prev => ({
        ...prev,
        nodes: prev.nodes.filter(node => node.id !== nodeId),
      }));
    },
    [updateFlow]
  );

  const saveFlow = useCallback(async () => {
    if (!flow || !alias) return;
    if (!flow.name.trim()) {
      toast.error('Flow name is required');
      return;
    }

    setSaveLoading(true);
    try {
      const persisted = await upsertComposedFlow({
        id: flow.id,
        alias,
        name: flow.name,
        flowJson: JSON.stringify(flow),
      });
      cacheFlowForScheduler({
        alias,
        flowId: persisted.id,
        flowJson: JSON.stringify(flow),
        flowName: flow.name,
      });
      setSelectedFlowId(persisted.id);
      await refresh();
      toast.success('Flow saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save flow');
    } finally {
      setSaveLoading(false);
    }
  }, [alias, flow, refresh]);

  const runFlow = useCallback(async () => {
    if (!flow || !alias) return;
    const plan = compileComposedFlow(flow);
    if (plan.segments.length === 0) {
      toast.error('Flow has no runnable scenario segments');
      return;
    }

    try {
      const response = await startComposedFlowJob({
        alias,
        planJson: JSON.stringify(plan),
        correlationId:
          typeof globalThis.crypto?.randomUUID === 'function'
            ? globalThis.crypto.randomUUID()
            : String(Date.now()),
      });
      setRunState({
        jobId: response.jobId,
        status: 'running',
        error: null,
        lastJobStatus: null,
      });
      toast.success('Composed flow started');
      setSelectedFlowId(flow.id);
      const compactFlow = JSON.stringify(flow);
      const compactPlan = JSON.stringify(plan);
      cacheFlowForScheduler({
        alias,
        flowId: flow.id,
        flowJson: compactFlow,
        flowName: flow.name,
      });
      const schedulerConfig = {
        mode: 'composed_flow',
        alias,
        flowId: flow.id,
        flow: JSON.parse(compactFlow),
        planJson: compactPlan,
      };
      try {
        await navigator.clipboard.writeText(JSON.stringify(schedulerConfig, null, 2));
        toast.success('Scheduler config copied to clipboard');
      } catch {
        // clipboard optional
      }
    } catch (error) {
      setRunState({
        jobId: null,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        lastJobStatus: null,
      });
      toast.error(error instanceof Error ? error.message : 'Failed to start composed flow');
    }
  }, [alias, flow]);

  const createSchedulerTaskFromFlow = useCallback(() => {
    if (!flow || !alias) {
      toast.error('Flow and alias are required');
      return;
    }

    cacheFlowForScheduler({
      alias,
      flowId: flow.id,
      flowJson: JSON.stringify(flow),
      flowName: flow.name,
    });

    onClose();
    navigate('/scheduler?prefill=composed');
  }, [alias, flow, navigate, onClose]);

  const removeFlow = useCallback(async () => {
    if (!selectedFlowId) return;
    try {
      await deleteComposedFlow(selectedFlowId);
      setSelectedFlowId('');
      if (alias) {
        setFlow(createEmptyComposedFlow(alias));
      }
      await refresh();
      toast.success('Flow deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete flow');
    }
  }, [alias, refresh, selectedFlowId]);

  const renderRunNode = (node: FlowRunScenarioNode) => {
    const bindingEntries = Object.entries(node.bindings ?? {});
    const contextPathOptions: Array<{ value: FlowContextBindingPath; label: string }> = [
      { value: 'alias', label: 'Context alias' },
      { value: 'proxy', label: 'Context proxy' },
      { value: 'credentials.login', label: 'Credential login' },
      { value: 'credentials.password', label: 'Credential password' },
    ];
    const listStrategyOptions: Array<{ value: FlowListPickStrategy; label: string }> = [
      { value: 'next', label: 'Next' },
      { value: 'first', label: 'First' },
      { value: 'random', label: 'Random' },
    ];
    const listSourceOptions = (flow?.dataLists ?? []).map(source => ({
      value: source.id,
      label: `${source.id} (${source.values.length})`,
    }));

    const updateBinding = (oldKey: string, newKey: string, binding: FlowBinding) => {
      const key = newKey.trim();
      updateNode(node.id, n => {
        if (n.type !== 'runScenario') return n;
        const next: Record<string, FlowBinding> = { ...n.bindings };
        delete next[oldKey];
        if (key) {
          next[key] = binding;
        }
        return {
          ...n,
          bindings: next,
        };
      });
    };

    const removeBinding = (key: string) => {
      updateNode(node.id, n => {
        if (n.type !== 'runScenario') return n;
        const next = { ...n.bindings };
        delete next[key];
        return {
          ...n,
          bindings: next,
        };
      });
    };

    const addBinding = () => {
      const baseName = 'var';
      let idx = 1;
      const existing = new Set(Object.keys(node.bindings ?? {}));
      while (existing.has(`${baseName}${idx}`)) idx += 1;
      const key = `${baseName}${idx}`;
      updateNode(node.id, n => {
        if (n.type !== 'runScenario') return n;
        return {
          ...n,
          bindings: {
            ...n.bindings,
            [key]: { kind: 'constant', value: '' },
          },
        };
      });
    };

    return (
      <div className="space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            label="Name"
            value={node.name}
            onChange={e => updateNode(node.id, n => ({ ...n, name: e.target.value }))}
            className="h-9"
          />
          <Select
            label="Scenario"
            value={node.scenarioPath}
            options={scenarioOptions}
            onValueChange={value =>
              updateNode(node.id, n => {
                if (n.type !== 'runScenario') return n;
                return { ...n, scenarioPath: value };
              })
            }
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            label="Start URL override"
            value={node.startUrl ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'runScenario') return n;
                return { ...n, startUrl: e.target.value || null };
              })
            }
            className="h-9"
          />
          <Input
            label="Proxy override"
            value={node.contextOverride?.proxy ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'runScenario') return n;
                return {
                  ...n,
                  contextOverride: {
                    ...(n.contextOverride ?? {}),
                    proxy: e.target.value || null,
                  },
                };
              })
            }
            className="h-9"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            label="Alias override"
            value={node.contextOverride?.alias ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'runScenario') return n;
                return {
                  ...n,
                  contextOverride: {
                    ...(n.contextOverride ?? {}),
                    alias: e.target.value,
                  },
                };
              })
            }
            className="h-9"
          />

          <div className="h-9 px-2 rounded-md border border-white/10 bg-black/30 inline-flex items-center">
            <Checkbox
              checked={Boolean(node.continueOnError)}
              onChange={e =>
                updateNode(node.id, n => {
                  if (n.type !== 'runScenario') return n;
                  return {
                    ...n,
                    continueOnError: e.target.checked,
                  };
                })
              }
              label="Continue on error"
              className="py-0 px-0 hover:bg-transparent"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            label="Login override"
            value={node.contextOverride?.credentials?.login ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'runScenario') return n;
                return {
                  ...n,
                  contextOverride: {
                    ...(n.contextOverride ?? {}),
                    credentials: {
                      ...(n.contextOverride?.credentials ?? {}),
                      login: e.target.value || null,
                    },
                  },
                };
              })
            }
            className="h-9"
          />
          <Input
            label="Password override"
            value={node.contextOverride?.credentials?.password ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'runScenario') return n;
                return {
                  ...n,
                  contextOverride: {
                    ...(n.contextOverride ?? {}),
                    credentials: {
                      ...(n.contextOverride?.credentials ?? {}),
                      password: e.target.value || null,
                    },
                  },
                };
              })
            }
            className="h-9"
          />
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">Bindings</div>
            <Button size="xs" variant="secondary" onClick={addBinding}>
              Add binding
            </Button>
          </div>

          {bindingEntries.length === 0 ? (
            <div className="text-xs text-slate-500">No bindings</div>
          ) : (
            bindingEntries.map(([key, binding]) => (
              <div
                key={key}
                className="rounded-md border border-white/10 bg-black/20 p-2 space-y-2"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Input
                    label="Variable"
                    value={key}
                    onChange={e => updateBinding(key, e.target.value, binding)}
                    className="h-9"
                  />
                  <Select
                    label="Source"
                    value={binding.kind}
                    options={[
                      { value: 'constant', label: 'Constant' },
                      { value: 'context', label: 'Context' },
                      { value: 'input', label: 'Flow input' },
                      { value: 'list', label: 'Data list' },
                    ]}
                    onValueChange={value => {
                      let nextBinding: FlowBinding = { kind: 'constant', value: '' };
                      if (value === 'context') {
                        nextBinding = { kind: 'context', path: 'alias' };
                      } else if (value === 'input') {
                        nextBinding = { kind: 'input', key: '' };
                      } else if (value === 'list') {
                        nextBinding = {
                          kind: 'list',
                          sourceId: listSourceOptions[0]?.value ?? 'emails_pool',
                          strategy: 'next',
                        };
                      }
                      updateBinding(key, key, nextBinding);
                    }}
                  />

                  {binding.kind === 'constant' ? (
                    <Input
                      label="Value"
                      value={binding.value}
                      onChange={e =>
                        updateBinding(key, key, {
                          kind: 'constant',
                          value: e.target.value,
                        })
                      }
                      className="h-9"
                    />
                  ) : null}

                  {binding.kind === 'context' ? (
                    <Select
                      label="Context path"
                      value={binding.path}
                      options={contextPathOptions}
                      onValueChange={value =>
                        updateBinding(key, key, {
                          kind: 'context',
                          path: value as FlowContextBindingPath,
                        })
                      }
                    />
                  ) : null}

                  {binding.kind === 'input' ? (
                    <Input
                      label="Input key"
                      value={binding.key}
                      onChange={e =>
                        updateBinding(key, key, {
                          kind: 'input',
                          key: e.target.value,
                        })
                      }
                      className="h-9"
                    />
                  ) : null}

                  {binding.kind === 'list' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:col-span-2">
                      <Select
                        label="List source"
                        value={binding.sourceId}
                        options={
                          listSourceOptions.length
                            ? listSourceOptions
                            : [{ value: 'emails_pool', label: 'emails_pool (0)' }]
                        }
                        onValueChange={value =>
                          updateBinding(key, key, {
                            kind: 'list',
                            sourceId: value,
                            strategy: binding.strategy ?? 'next',
                          })
                        }
                      />
                      <Select
                        label="Pick strategy"
                        value={binding.strategy ?? 'next'}
                        options={listStrategyOptions}
                        onValueChange={value =>
                          updateBinding(key, key, {
                            kind: 'list',
                            sourceId: binding.sourceId,
                            strategy: value as FlowListPickStrategy,
                          })
                        }
                      />
                    </div>
                  ) : null}

                  <div className="flex items-end">
                    <Button size="xs" variant="danger" onClick={() => removeBinding(key)}>
                      Remove binding
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const renderSwitchNode = (node: FlowSwitchContextNode) => {
    return (
      <div className="space-y-2">
        <Input
          label="Name"
          value={node.name}
          onChange={e => updateNode(node.id, n => ({ ...n, name: e.target.value }))}
          className="h-9"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            label="Alias"
            value={node.context.alias ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'switchContext') return n;
                return {
                  ...n,
                  context: {
                    ...n.context,
                    alias: e.target.value,
                  },
                };
              })
            }
            className="h-9"
          />
          <Input
            label="Proxy"
            value={node.context.proxy ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'switchContext') return n;
                return {
                  ...n,
                  context: {
                    ...n.context,
                    proxy: e.target.value || null,
                  },
                };
              })
            }
            className="h-9"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            label="Context login"
            value={node.context.credentials?.login ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'switchContext') return n;
                return {
                  ...n,
                  context: {
                    ...n.context,
                    credentials: {
                      ...(n.context.credentials ?? {}),
                      login: e.target.value || null,
                    },
                  },
                };
              })
            }
            className="h-9"
          />
          <Input
            label="Context password"
            value={node.context.credentials?.password ?? ''}
            onChange={e =>
              updateNode(node.id, n => {
                if (n.type !== 'switchContext') return n;
                return {
                  ...n,
                  context: {
                    ...n.context,
                    credentials: {
                      ...(n.context.credentials ?? {}),
                      password: e.target.value || null,
                    },
                  },
                };
              })
            }
            className="h-9"
          />
        </div>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Compose flow"
      size="xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-400">
            {runState.status === 'running'
              ? `Running job ${runState.jobId}`
              : runState.status === 'error'
                ? runState.error
                : runState.status === 'done'
                  ? 'Last run finished'
                  : `Segments: ${compilePreview?.segments.length ?? 0}`}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="danger" onClick={() => void removeFlow()} disabled={!selectedFlowId}>
              Delete
            </Button>
            <Button variant="secondary" onClick={() => void saveFlow()} isLoading={saveLoading}>
              Save
            </Button>
            <Button variant="secondary" onClick={createSchedulerTaskFromFlow}>
              Create Scheduler Task
            </Button>
            <Button onClick={() => void runFlow()} disabled={runState.status === 'running'}>
              Run flow
            </Button>
          </div>
        </div>
      }
    >
      {!alias ? (
        <div className="text-sm text-slate-400">Select profile alias first.</div>
      ) : !flow ? (
        <div className="text-sm text-slate-400">Loading...</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label={flowsLoading ? 'Saved flows (loading...)' : 'Saved flows'}
              value={selectedFlowId}
              options={flowOptions}
              onValueChange={value => {
                if (!value) {
                  setSelectedFlowId('');
                  if (alias) {
                    setFlow(createEmptyComposedFlow(alias));
                  }
                  return;
                }
                setSelectedFlowId(value);
              }}
            />
            <Input
              label="Flow name"
              value={flow.name}
              onChange={e => updateFlow(prev => ({ ...prev, name: e.target.value }))}
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Input
              label="Default alias"
              value={flow.defaults.alias}
              onChange={e =>
                updateFlow(prev => ({
                  ...prev,
                  alias: e.target.value,
                  defaults: {
                    ...prev.defaults,
                    alias: e.target.value,
                  },
                }))
              }
              className="h-9"
            />
            <Input
              label="Default proxy"
              value={flow.defaults.proxy ?? ''}
              onChange={e =>
                updateFlow(prev => ({
                  ...prev,
                  defaults: {
                    ...prev.defaults,
                    proxy: e.target.value || null,
                  },
                }))
              }
              className="h-9"
            />
            <Input
              label="Default config JSON"
              value={flow.defaults.configJson ?? ''}
              onChange={e =>
                updateFlow(prev => ({
                  ...prev,
                  defaults: {
                    ...prev.defaults,
                    configJson: e.target.value || null,
                  },
                }))
              }
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              label="Default credential login"
              value={flow.defaults.credentials?.login ?? ''}
              onChange={e =>
                updateFlow(prev => ({
                  ...prev,
                  defaults: {
                    ...prev.defaults,
                    credentials: {
                      ...(prev.defaults.credentials ?? {}),
                      login: e.target.value || null,
                    },
                  },
                }))
              }
              className="h-9"
            />
            <Input
              label="Default credential password"
              value={flow.defaults.credentials?.password ?? ''}
              onChange={e =>
                updateFlow(prev => ({
                  ...prev,
                  defaults: {
                    ...prev.defaults,
                    credentials: {
                      ...(prev.defaults.credentials ?? {}),
                      password: e.target.value || null,
                    },
                  },
                }))
              }
              className="h-9"
            />
          </div>

          <Textarea
            label="Email list source (emails_pool, one email per line)"
            value={(flow.dataLists.find(d => d.id === 'emails_pool')?.values ?? []).join('\n')}
            onChange={e => {
              const values = e.target.value
                .split(/\r?\n/g)
                .map(v => v.trim())
                .filter(Boolean);
              updateFlow(prev => {
                const rest = prev.dataLists.filter(d => d.id !== 'emails_pool');
                return {
                  ...prev,
                  dataLists: [
                    {
                      id: 'emails_pool',
                      values,
                      strategy: 'next',
                    },
                    ...rest,
                  ],
                };
              });
            }}
            className="h-24 min-h-[96px]"
          />

          <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
            <div className="text-xs text-slate-400">Import emails from Google Sheets</div>
            {!sheetsParams ? (
              <div className="text-xs text-amber-300">
                Configure Google Sheets credentials in AutoReg settings first.
              </div>
            ) : (
              <>
                {sheetsError ? <div className="text-xs text-amber-300">{sheetsError}</div> : null}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Select
                    label="Sheet"
                    value={selectedSheetId}
                    options={sheetOptions}
                    onValueChange={value => {
                      setSelectedSheetId(value);
                      setSelectedSheetColumn('');
                    }}
                  />
                  <Select
                    label="Column"
                    value={selectedSheetColumn}
                    options={sheetColumnOptions}
                    onValueChange={setSelectedSheetColumn}
                  />
                  <div className="flex items-end gap-2">
                    <Button variant="secondary" onClick={() => void refreshSheets()}>
                      Refresh sheets
                    </Button>
                    <Button variant="secondary" onClick={importEmailsFromSheet}>
                      Import
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => addRunNode()} disabled={scenariosLoading}>
              Add run-scenario node
            </Button>
            <Button variant="secondary" onClick={() => addSwitchNode()}>
              Add switch-context node
            </Button>
            <Button variant="secondary" onClick={() => void refresh()}>
              Refresh lists
            </Button>
            <Button variant="secondary" onClick={exportCompiledPlan}>
              Export compiled plan
            </Button>
          </div>

          <div className="space-y-3">
            {flow.nodes.length === 0 ? (
              <div className="text-xs text-slate-500">
                No nodes yet. Add at least one run-scenario node.
              </div>
            ) : (
              flow.nodes.map((node, idx) => (
                <div
                  key={node.id}
                  className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-slate-400">
                      #{idx + 1} • {node.type}
                    </div>
                    <Button size="xs" variant="danger" onClick={() => removeNode(node.id)}>
                      Remove
                    </Button>
                  </div>

                  {node.type === 'runScenario'
                    ? renderRunNode(node as FlowRunScenarioNode)
                    : renderSwitchNode(node as FlowSwitchContextNode)}
                </div>
              ))
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
            <div className="text-slate-400 mb-1">Compile preview</div>
            <div className="text-slate-200">Segments: {compilePreview?.segments.length ?? 0}</div>
            {compilePreview?.diagnostics?.length ? (
              <div className="text-amber-300 mt-1">
                {compilePreview.diagnostics.map(item => (
                  <div key={item}>{item}</div>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 mt-1">No diagnostics</div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
