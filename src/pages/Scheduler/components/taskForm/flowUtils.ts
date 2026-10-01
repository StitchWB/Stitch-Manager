import type { ComposedFlow } from '../../../../lib/scenarioFlow/types';

export function parseFlowObject(raw: string): ComposedFlow | null {
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

export function collectFlowInputKeys(flow: ComposedFlow): string[] {
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

export function parseStringRecord(raw: string): Record<string, string> {
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
