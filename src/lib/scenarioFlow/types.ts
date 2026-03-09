export type FlowContextBindingPath =
  | 'alias'
  | 'proxy'
  | 'credentials.login'
  | 'credentials.password';

export type FlowListPickStrategy = 'next' | 'first' | 'random';

export interface FlowExecutionContext {
  alias: string;
  proxy?: string | null;
  configJson?: string | null;
  credentials?: {
    login?: string | null;
    password?: string | null;
  };
}

export interface FlowListDataSource {
  id: string;
  values: string[];
  strategy?: FlowListPickStrategy;
}

export type FlowBinding =
  | {
      kind: 'constant';
      value: string;
    }
  | {
      kind: 'context';
      path: FlowContextBindingPath;
    }
  | {
      kind: 'input';
      key: string;
    }
  | {
      kind: 'list';
      sourceId: string;
      strategy?: FlowListPickStrategy;
    };

export interface FlowNodeBase {
  id: string;
  name: string;
}

export interface FlowSwitchContextNode extends FlowNodeBase {
  type: 'switchContext';
  context: Partial<FlowExecutionContext>;
}

export interface FlowRunScenarioNode extends FlowNodeBase {
  type: 'runScenario';
  scenarioPath: string;
  startUrl?: string | null;
  continueOnError?: boolean;
  contextOverride?: Partial<FlowExecutionContext>;
  bindings: Record<string, FlowBinding>;
}

export type ComposedFlowNode = FlowSwitchContextNode | FlowRunScenarioNode;

export interface ComposedFlow {
  id: string;
  alias: string;
  name: string;
  version: 1;
  createdAt: string;
  updatedAt: string;
  defaults: FlowExecutionContext;
  inputDefaults: Record<string, string>;
  dataLists: FlowListDataSource[];
  nodes: ComposedFlowNode[];
}

export interface CompileFlowOptions {
  inputValues?: Record<string, string>;
  contextOverride?: Partial<FlowExecutionContext>;
}

export interface CompiledFlowSegment {
  index: number;
  total: number;
  name: string;
  alias: string;
  scenarioPath: string;
  startUrl?: string | null;
  proxy?: string | null;
  configJson?: string | null;
  credentials?: {
    login?: string | null;
    password?: string | null;
  };
  continueOnError: boolean;
  resolvedVariables: Record<string, string>;
}

export interface CompiledFlowPlan {
  flowId: string;
  flowName: string;
  createdAt: string;
  segments: CompiledFlowSegment[];
  diagnostics: string[];
}
