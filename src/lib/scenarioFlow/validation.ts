import type { ComposedFlow, ComposedFlowNode } from './types';

export type FlowValidationSeverity = 'error' | 'warning';

export interface FlowValidationIssue {
  severity: FlowValidationSeverity;
  code: string;
  message: string;
  nodeId?: string;
  targetType?: 'node' | 'edge';
  edgeId?: string;
}

export interface FlowValidationResult {
  issues: FlowValidationIssue[];
  errors: FlowValidationIssue[];
  warnings: FlowValidationIssue[];
  canRun: boolean;
}

const issue = (
  severity: FlowValidationSeverity,
  code: string,
  message: string,
  nodeId?: string,
  targetType?: 'node' | 'edge',
  edgeId?: string
): FlowValidationIssue => ({ severity, code, message, nodeId, targetType, edgeId });

export function validateComposedFlow(flow: ComposedFlow): FlowValidationResult {
  const issues: FlowValidationIssue[] = [];
  const nodes = flow.nodes ?? [];

  if (!flow.name.trim()) {
    issues.push(issue('error', 'flow_name_required', 'Flow name is required'));
  }
  if (!flow.defaults.alias?.trim()) {
    issues.push(issue('error', 'default_alias_required', 'Default alias is required'));
  }
  if (nodes.length === 0) {
    issues.push(issue('error', 'nodes_required', 'Add at least one node to run flow'));
  }

  const seenIds = new Set<string>();
  const byId = new Map<string, ComposedFlowNode>();
  for (const node of nodes) {
    if (!node.id?.trim()) {
      issues.push(issue('error', 'node_id_required', 'Node id is required'));
      continue;
    }
    if (seenIds.has(node.id)) {
      issues.push(issue('error', 'node_id_duplicate', `Duplicate node id: ${node.id}`, node.id));
      continue;
    }
    seenIds.add(node.id);
    byId.set(node.id, node);

    if (!node.name?.trim()) {
      issues.push(issue('warning', 'node_name_missing', 'Node name is empty', node.id));
    }

    if (node.type === 'runScenario' && !node.scenarioPath?.trim()) {
      issues.push(
        issue(
          'error',
          'scenario_path_required',
          'Run-scenario node requires scenario path',
          node.id
        )
      );
    }
  }

  for (const node of nodes) {
    if (node.nextNodeId) {
      if (!byId.has(node.nextNodeId)) {
        issues.push(
          issue(
            'error',
            'next_node_missing',
            `Node '${node.name}' points to missing success node '${node.nextNodeId}'`,
            node.id,
            'edge',
            `${node.id}::success`
          )
        );
      }
      if (node.nextNodeId === node.id) {
        issues.push(
          issue('error', 'self_loop', `Node '${node.name}' has self-loop success edge`, node.id)
        );
      }
    }

    if (node.type === 'runScenario' && node.errorNextNodeId) {
      if (!byId.has(node.errorNextNodeId)) {
        issues.push(
          issue(
            'error',
            'error_next_node_missing',
            `Node '${node.name}' points to missing error node '${node.errorNextNodeId}'`,
            node.id,
            'edge',
            `${node.id}::error`
          )
        );
      }
      if (node.errorNextNodeId === node.id) {
        issues.push(
          issue('error', 'self_loop', `Node '${node.name}' has self-loop error edge`, node.id)
        );
      }
    }

    if (node.type === 'runScenario') {
      for (const [bindingKey, binding] of Object.entries(node.bindings ?? {})) {
        if (binding.kind === 'input' && !flow.inputDefaults[binding.key]) {
          issues.push(
            issue(
              'warning',
              'input_default_missing',
              `Binding '${bindingKey}' references flow input '${binding.key}' without default value`,
              node.id
            )
          );
        }
      }
    }
  }

  const startNode = nodes[0] ?? null;
  if (startNode && byId.size > 0) {
    const reachable = new Set<string>();
    const stack = [startNode.id];
    let hops = 0;

    while (stack.length > 0 && hops < Math.max(40, byId.size * 5)) {
      hops += 1;
      const id = stack.pop();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      const node = byId.get(id);
      if (!node) continue;
      if (node.nextNodeId) stack.push(node.nextNodeId);
      if (node.type === 'runScenario' && node.errorNextNodeId) {
        stack.push(node.errorNextNodeId);
      }
    }

    if (hops >= Math.max(40, byId.size * 5)) {
      issues.push(
        issue(
          'warning',
          'cycle_guard',
          'Graph may contain a cycle; runtime loop guard may stop execution'
        )
      );
    }

    for (const node of nodes) {
      if (!reachable.has(node.id)) {
        issues.push(
          issue(
            'warning',
            'node_unreachable',
            `Node '${node.name}' is unreachable from start node`,
            node.id
          )
        );
      }
    }
  }

  const errors = issues.filter(item => item.severity === 'error');
  const warnings = issues.filter(item => item.severity === 'warning');
  return {
    issues,
    errors,
    warnings,
    canRun: errors.length === 0,
  };
}
