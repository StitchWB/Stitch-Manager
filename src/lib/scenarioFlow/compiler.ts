import type {
  CompileFlowOptions,
  CompiledFlowPlan,
  CompiledFlowSegment,
  ComposedFlow,
  ComposedFlowNode,
  FlowBinding,
  FlowExecutionContext,
  FlowListDataSource,
  FlowContextBindingPath,
} from './types';

type ListCursorState = Record<string, number>;

const mergeContext = (
  base: FlowExecutionContext,
  override?: Partial<FlowExecutionContext>
): FlowExecutionContext => {
  if (!override) {
    return {
      ...base,
      credentials: {
        ...(base.credentials ?? {}),
      },
    };
  }

  return {
    ...base,
    ...override,
    credentials: {
      ...(base.credentials ?? {}),
      ...(override.credentials ?? {}),
    },
  };
};

const getFromContextPath = (ctx: FlowExecutionContext, path: FlowContextBindingPath) => {
  switch (path) {
    case 'alias':
      return ctx.alias;
    case 'proxy':
      return ctx.proxy ?? '';
    case 'credentials.login':
      return ctx.credentials?.login ?? '';
    case 'credentials.password':
      return ctx.credentials?.password ?? '';
    default:
      return '';
  }
};

const pickFromList = (
  source: FlowListDataSource | undefined,
  binding: Extract<FlowBinding, { kind: 'list' }>,
  cursors: ListCursorState
): string => {
  if (!source || source.values.length === 0) return '';

  const strategy = binding.strategy ?? source.strategy ?? 'next';
  if (strategy === 'first') {
    return source.values[0] ?? '';
  }

  if (strategy === 'random') {
    const idx = Math.floor(Math.random() * source.values.length);
    return source.values[idx] ?? '';
  }

  const prev = cursors[source.id] ?? 0;
  const idx = prev % source.values.length;
  cursors[source.id] = prev + 1;
  return source.values[idx] ?? '';
};

const resolveBinding = (
  binding: FlowBinding,
  context: FlowExecutionContext,
  inputValues: Record<string, string>,
  sources: Map<string, FlowListDataSource>,
  cursors: ListCursorState
): string => {
  switch (binding.kind) {
    case 'constant':
      return binding.value;
    case 'context':
      return String(getFromContextPath(context, binding.path) ?? '');
    case 'input':
      return String(inputValues[binding.key] ?? '');
    case 'list':
      return pickFromList(sources.get(binding.sourceId), binding, cursors);
    default:
      return '';
  }
};

const compileNode = (
  node: ComposedFlowNode,
  context: FlowExecutionContext,
  inputValues: Record<string, string>,
  sources: Map<string, FlowListDataSource>,
  cursors: ListCursorState,
  diagnostics: string[]
): CompiledFlowSegment | null => {
  if (node.type !== 'runScenario') {
    return null;
  }

  const effectiveContext = mergeContext(context, node.contextOverride);
  if (!effectiveContext.alias?.trim()) {
    diagnostics.push(`Node ${node.name}: missing alias`);
  }
  if (!node.scenarioPath?.trim()) {
    diagnostics.push(`Node ${node.name}: missing scenarioPath`);
    return null;
  }

  const resolvedVariables: Record<string, string> = {};
  for (const [key, binding] of Object.entries(node.bindings ?? {})) {
    resolvedVariables[key] = resolveBinding(
      binding,
      effectiveContext,
      inputValues,
      sources,
      cursors
    );
  }

  return {
    nodeId: node.id,
    index: 0,
    total: 0,
    name: node.name,
    alias: effectiveContext.alias,
    scenarioPath: node.scenarioPath,
    startUrl: node.startUrl ?? null,
    proxy: effectiveContext.proxy ?? null,
    configJson: effectiveContext.configJson ?? null,
    credentials: {
      login: effectiveContext.credentials?.login ?? null,
      password: effectiveContext.credentials?.password ?? null,
    },
    continueOnError: Boolean(node.continueOnError),
    nextOnSuccessNodeId: node.nextNodeId ?? null,
    nextOnErrorNodeId:
      node.type === 'runScenario'
        ? (node.errorNextNodeId ?? (node.continueOnError ? (node.nextNodeId ?? null) : null))
        : null,
    resolvedVariables,
  };
};

const resolveNodeOrder = (flow: ComposedFlow, diagnostics: string[]): ComposedFlowNode[] => {
  const nodes = flow.nodes ?? [];
  if (nodes.length < 2) return nodes;
  const hasExplicitLinks = nodes.some(node => Boolean(node.nextNodeId));
  if (!hasExplicitLinks) {
    return nodes;
  }

  const byId = new Map(nodes.map(node => [node.id, node]));
  const incoming = new Set<string>();
  for (const node of nodes) {
    if (node.nextNodeId && byId.has(node.nextNodeId)) {
      incoming.add(node.nextNodeId);
    }
  }

  const firstByList = nodes[0]?.id;
  const graphStart = nodes.find(node => !incoming.has(node.id))?.id;
  const startId = (firstByList && byId.has(firstByList) ? firstByList : null) ?? graphStart;
  if (!startId) return nodes;

  const ordered: ComposedFlowNode[] = [];
  const visited = new Set<string>();
  let cursor: string | null = startId;

  while (cursor && byId.has(cursor) && !visited.has(cursor)) {
    const node = byId.get(cursor);
    if (!node) break;
    ordered.push(node);
    visited.add(cursor);

    if (node.nextNodeId && !byId.has(node.nextNodeId)) {
      diagnostics.push(`Node ${node.name}: nextNodeId '${node.nextNodeId}' not found`);
      cursor = null;
      break;
    }

    const nextId = node.nextNodeId ?? null;
    if (!nextId) {
      cursor = null;
      break;
    }
    cursor = nextId;
  }

  if (cursor && visited.has(cursor)) {
    diagnostics.push(`Cycle detected near node '${cursor}'. Falling back to list order.`);
    return nodes;
  }

  if (ordered.length < nodes.length) {
    const remaining = nodes.filter(node => !visited.has(node.id));
    diagnostics.push(
      `Graph order covered ${ordered.length}/${nodes.length} nodes. Appending ${remaining.length} unlinked node(s) by list order.`
    );
    return [...ordered, ...remaining];
  }

  return ordered;
};

export const compileComposedFlow = (
  flow: ComposedFlow,
  options: CompileFlowOptions = {}
): CompiledFlowPlan => {
  const diagnostics: string[] = [];
  const inputValues = {
    ...(flow.inputDefaults ?? {}),
    ...(options.inputValues ?? {}),
  };

  const sources = new Map<string, FlowListDataSource>();
  for (const source of flow.dataLists ?? []) {
    sources.set(source.id, source);
  }

  const cursors: ListCursorState = {};
  let currentContext = mergeContext(flow.defaults, options.contextOverride);
  const segments: CompiledFlowSegment[] = [];
  const orderedNodes = resolveNodeOrder(flow, diagnostics);

  for (const node of orderedNodes) {
    if (node.type === 'switchContext') {
      currentContext = mergeContext(currentContext, node.context);
      continue;
    }

    const segment = compileNode(node, currentContext, inputValues, sources, cursors, diagnostics);
    if (segment) {
      segments.push(segment);
    }
  }

  const total = segments.length;
  for (let i = 0; i < total; i += 1) {
    segments[i] = {
      ...segments[i],
      index: i + 1,
      total,
    };
  }

  return {
    flowId: flow.id,
    flowName: flow.name,
    entryNodeId: orderedNodes[0]?.id ?? null,
    createdAt: new Date().toISOString(),
    segments,
    diagnostics,
  };
};
