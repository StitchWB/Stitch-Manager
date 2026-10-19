import { t } from "@/lib/i18n";import { Button, Checkbox, FormGrid, Input, Select } from '@/components/ui';
import type {
  ComposedFlow,
  ComposedFlowNode,
  FlowBinding,
  FlowContextBindingPath,
  FlowListPickStrategy } from
'@/lib/scenarioFlow/types';

type ComposerNodeEditorProps = {
  selectedNode: ComposedFlowNode | null;
  flow: ComposedFlow;
  scenarioOptions: Array<{value: string;label: string;}>;
  updateNode: (nodeId: string, updater: (node: ComposedFlowNode) => ComposedFlowNode) => void;
};

export function ComposerNodeEditor({
  selectedNode,
  flow,
  scenarioOptions,
  updateNode
}: ComposerNodeEditorProps) {
  if (!selectedNode) return null;

  if (selectedNode.type === 'switchContext') {
    const node = selectedNode;
    const branchTargetOptions = [
    { value: '', label: 'None' },
    ...flow.nodes.
    filter((candidate) => candidate.id !== node.id).
    map((candidate) => ({
      value: candidate.id,
      label: `${candidate.name || candidate.id} • ${candidate.type}`
    }))];


    return (
      <div className="space-y-2">
        <Input
          label="Name"
          value={node.name}
          onChange={(e) => updateNode(node.id, (n) => ({ ...n, name: e.target.value }))}
          className="h-9" />
        
        <FormGrid responsive>
          <Input
            label="Alias"
            value={node.context.alias ?? ''}
            onChange={(e) =>
            updateNode(node.id, (n) => {
              if (n.type !== 'switchContext') return n;
              return {
                ...n,
                context: {
                  ...n.context,
                  alias: e.target.value
                }
              };
            })
            }
            className="h-9" />
          
          <Input
            label="Proxy"
            value={node.context.proxy ?? ''}
            onChange={(e) =>
            updateNode(node.id, (n) => {
              if (n.type !== 'switchContext') return n;
              return {
                ...n,
                context: {
                  ...n.context,
                  proxy: e.target.value || null
                }
              };
            })
            }
            className="h-9" />
          
        </FormGrid>

        <FormGrid responsive>
          <Input
            label="Context login"
            value={node.context.credentials?.login ?? ''}
            onChange={(e) =>
            updateNode(node.id, (n) => {
              if (n.type !== 'switchContext') return n;
              return {
                ...n,
                context: {
                  ...n.context,
                  credentials: {
                    ...(n.context.credentials ?? {}),
                    login: e.target.value || null
                  }
                }
              };
            })
            }
            className="h-9" />
          
          <Input
            label="Context password"
            value={node.context.credentials?.password ?? ''}
            onChange={(e) =>
            updateNode(node.id, (n) => {
              if (n.type !== 'switchContext') return n;
              return {
                ...n,
                context: {
                  ...n.context,
                  credentials: {
                    ...(n.context.credentials ?? {}),
                    password: e.target.value || null
                  }
                }
              };
            })
            }
            className="h-9" />
          
        </FormGrid>

        <Select
          label="Success next node"
          value={node.nextNodeId ?? ''}
          options={branchTargetOptions}
          onValueChange={(value) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'switchContext') return n;
            return {
              ...n,
              nextNodeId: value || null
            };
          })
          } />
        
      </div>);

  }

  const node = selectedNode;
  const bindingEntries = Object.entries(node.bindings ?? {});
  const branchTargetOptions = [
  { value: '', label: 'None' },
  ...flow.nodes.
  filter((candidate) => candidate.id !== node.id).
  map((candidate) => ({
    value: candidate.id,
    label: `${candidate.name || candidate.id} • ${candidate.type}`
  }))];

  const contextPathOptions: Array<{value: FlowContextBindingPath;label: string;}> = [
  { value: 'alias', label: 'Context alias' },
  { value: 'proxy', label: 'Context proxy' },
  { value: 'credentials.login', label: 'Credential login' },
  { value: 'credentials.password', label: 'Credential password' }];

  const listStrategyOptions: Array<{value: FlowListPickStrategy;label: string;}> = [
  { value: 'next', label: 'Next' },
  { value: 'first', label: 'First' },
  { value: 'random', label: 'Random' }];

  const listSourceOptions = (flow.dataLists ?? []).map((source) => ({
    value: source.id,
    label: `${source.id} (${source.values.length})`
  }));

  const updateBinding = (oldKey: string, newKey: string, binding: FlowBinding) => {
    const key = newKey.trim();
    updateNode(node.id, (n) => {
      if (n.type !== 'runScenario') return n;
      const next: Record<string, FlowBinding> = { ...n.bindings };
      delete next[oldKey];
      if (key) {
        next[key] = binding;
      }
      return {
        ...n,
        bindings: next
      };
    });
  };

  const removeBinding = (key: string) => {
    updateNode(node.id, (n) => {
      if (n.type !== 'runScenario') return n;
      const next = { ...n.bindings };
      delete next[key];
      return {
        ...n,
        bindings: next
      };
    });
  };

  const addBinding = () => {
    const baseName = 'var';
    let idx = 1;
    const existing = new Set(Object.keys(node.bindings ?? {}));
    while (existing.has(`${baseName}${idx}`)) idx += 1;
    const key = `${baseName}${idx}`;
    updateNode(node.id, (n) => {
      if (n.type !== 'runScenario') return n;
      return {
        ...n,
        bindings: {
          ...n.bindings,
          [key]: { kind: 'constant', value: '' }
        }
      };
    });
  };

  return (
    <div className="space-y-2">
      <FormGrid responsive>
        <Input
          label="Name"
          value={node.name}
          onChange={(e) => updateNode(node.id, (n) => ({ ...n, name: e.target.value }))}
          className="h-9" />
        
        <Select
          label="Scenario"
          value={node.scenarioPath}
          options={scenarioOptions}
          onValueChange={(value) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return { ...n, scenarioPath: value };
          })
          } />
        
      </FormGrid>

      <FormGrid responsive>
        <Input
          label="Start URL override"
          value={node.startUrl ?? ''}
          onChange={(e) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return { ...n, startUrl: e.target.value || null };
          })
          }
          className="h-9" />
        
        <Input
          label="Proxy override"
          value={node.contextOverride?.proxy ?? ''}
          onChange={(e) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return {
              ...n,
              contextOverride: {
                ...(n.contextOverride ?? {}),
                proxy: e.target.value || null
              }
            };
          })
          }
          className="h-9" />
        
      </FormGrid>

      <FormGrid responsive>
        <Select
          label="Success next node"
          value={node.nextNodeId ?? ''}
          options={branchTargetOptions}
          onValueChange={(value) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return {
              ...n,
              nextNodeId: value || null
            };
          })
          } />
        
        <Select
          label="Error next node"
          value={node.errorNextNodeId ?? ''}
          options={branchTargetOptions}
          onValueChange={(value) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return {
              ...n,
              errorNextNodeId: value || null
            };
          })
          } />
        
      </FormGrid>

      <FormGrid responsive>
        <Input
          label="Alias override"
          value={node.contextOverride?.alias ?? ''}
          onChange={(e) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return {
              ...n,
              contextOverride: {
                ...(n.contextOverride ?? {}),
                alias: e.target.value
              }
            };
          })
          }
          className="h-9" />
        
        <div className="flex items-end">
          <Checkbox
            label="Continue on error"
            checked={Boolean(node.continueOnError)}
            onChange={(e) =>
            updateNode(node.id, (n) => {
              if (n.type !== 'runScenario') return n;
              return {
                ...n,
                continueOnError: e.target.checked
              };
            })
            } />
          
        </div>
      </FormGrid>

      <FormGrid responsive>
        <Input
          label="Login override"
          value={node.contextOverride?.credentials?.login ?? ''}
          onChange={(e) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return {
              ...n,
              contextOverride: {
                ...(n.contextOverride ?? {}),
                credentials: {
                  ...(n.contextOverride?.credentials ?? {}),
                  login: e.target.value || null
                }
              }
            };
          })
          }
          className="h-9" />
        
        <Input
          label="Password override"
          value={node.contextOverride?.credentials?.password ?? ''}
          onChange={(e) =>
          updateNode(node.id, (n) => {
            if (n.type !== 'runScenario') return n;
            return {
              ...n,
              contextOverride: {
                ...(n.contextOverride ?? {}),
                credentials: {
                  ...(n.contextOverride?.credentials ?? {}),
                  password: e.target.value || null
                }
              }
            };
          })
          }
          className="h-9" />
        
      </FormGrid>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">{t("recorder.composer_node_editor.bindings")}</div>
          <Button size="xs" variant="secondary" onClick={addBinding}>{t("recorder.composer_node_editor.add_binding")}

          </Button>
        </div>

        {bindingEntries.length === 0 ?
        <div className="text-xs text-slate-500">{t("recorder.composer_node_editor.no_bindings")}</div> :

        bindingEntries.map(([key, binding]) =>
        <div key={key} className="rounded-md border border-white/10 bg-black/20 p-2 space-y-2">
              <FormGrid columns={4} responsive>
                <Input
              label="Variable"
              value={key}
              onChange={(e) => updateBinding(key, e.target.value, binding)}
              className="h-9" />
            
                <Select
              label="Source"
              value={binding.kind}
              options={[
              { value: 'constant', label: 'Constant' },
              { value: 'context', label: 'Context' },
              { value: 'input', label: 'Flow input' },
              { value: 'list', label: 'Data list' }]
              }
              onValueChange={(value) => {
                let nextBinding: FlowBinding = { kind: 'constant', value: '' };
                if (value === 'context') {
                  nextBinding = { kind: 'context', path: 'alias' };
                } else if (value === 'input') {
                  nextBinding = { kind: 'input', key: '' };
                } else if (value === 'list') {
                  nextBinding = {
                    kind: 'list',
                    sourceId: listSourceOptions[0]?.value ?? 'emails_pool',
                    strategy: 'next'
                  };
                }
                updateBinding(key, key, nextBinding);
              }} />
            

                {binding.kind === 'constant' ?
            <Input
              label="Value"
              value={binding.value}
              onChange={(e) =>
              updateBinding(key, key, {
                kind: 'constant',
                value: e.target.value
              })
              }
              className="h-9" /> :

            null}

                {binding.kind === 'context' ?
            <Select
              label="Context path"
              value={binding.path}
              options={contextPathOptions}
              onValueChange={(value) =>
              updateBinding(key, key, {
                kind: 'context',
                path: value as FlowContextBindingPath
              })
              } /> :

            null}

                {binding.kind === 'input' ?
            <Input
              label="Input key"
              value={binding.key}
              onChange={(e) =>
              updateBinding(key, key, {
                kind: 'input',
                key: e.target.value
              })
              }
              className="h-9" /> :

            null}

                {binding.kind === 'list' ?
            <FormGrid responsive className="md:col-span-2">
                    <Select
                label="List source"
                value={binding.sourceId}
                options={
                listSourceOptions.length ?
                listSourceOptions :
                [{ value: 'emails_pool', label: 'emails_pool (0)' }]
                }
                onValueChange={(value) =>
                updateBinding(key, key, {
                  kind: 'list',
                  sourceId: value,
                  strategy: binding.strategy ?? 'next'
                })
                } />
              
                    <Select
                label="Pick strategy"
                value={binding.strategy ?? 'next'}
                options={listStrategyOptions}
                onValueChange={(value) =>
                updateBinding(key, key, {
                  kind: 'list',
                  sourceId: binding.sourceId,
                  strategy: value as FlowListPickStrategy
                })
                } />
              
                  </FormGrid> :
            null}

                <div className="flex items-end">
                  <Button size="xs" variant="danger" onClick={() => removeBinding(key)}>{t("recorder.composer_node_editor.remove_binding")}

              </Button>
                </div>
              </FormGrid>
            </div>
        )
        }
      </div>
    </div>);

}