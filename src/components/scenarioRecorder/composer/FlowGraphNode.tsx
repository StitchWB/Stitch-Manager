import { Handle, Position, type NodeProps } from 'reactflow';
import type { ComposedFlowNode } from '@/lib/scenarioFlow/types';

export type FlowNodeBadgeTone = 'emerald' | 'amber';

export type FlowCanvasNodeData = {
  id: string;
  name: string;
  index: number;
  type: ComposedFlowNode['type'];
  tone: FlowNodeBadgeTone;
  selected: boolean;
  executed: boolean;
  running?: boolean;
};

export type FlowCanvasEdgeData = {
  branch: 'success' | 'error';
  implicit?: boolean;
};

export type FlowRouteHistoryEntry = {
  fromNodeId: string;
  toNodeId: string;
  branch: 'success' | 'error';
};

export const FLOW_NODE_TONE: Record<ComposedFlowNode['type'], FlowNodeBadgeTone> = {
  runScenario: 'emerald',
  switchContext: 'amber',
};

const FlowCanvasNode = ({ data }: NodeProps<FlowCanvasNodeData>) => {
  const badgeStyles =
    data.tone === 'emerald'
      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
      : 'border-amber-400/50 bg-amber-500/20 text-amber-100';
  const ringStyles = data.selected
    ? 'border-sky-400/60 shadow-[0_0_0_2px_rgba(56,189,248,0.25)]'
    : data.running
      ? 'border-amber-300/60 shadow-[0_0_0_2px_rgba(251,191,36,0.20)]'
      : 'border-white/10';

  return (
    <div
      className={`rounded-2xl border ${ringStyles} bg-black/60 px-4 py-3 text-xs text-slate-100 shadow-lg backdrop-blur ${data.running ? 'animate-pulse' : ''}`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${badgeStyles}`}
        >
          {data.type === 'runScenario' ? 'Run' : 'Switch'}
        </div>
        <div className="text-[10px] text-slate-400">Step {data.index + 1}</div>
      </div>
      <div className="mt-2 text-sm font-semibold text-slate-100">{data.name || 'Untitled'}</div>
      <div className="mt-1 text-[11px] text-slate-400">
        {data.type === 'runScenario' ? 'Scenario execution' : 'Context override'}
      </div>
      {data.executed ? (
        <div className="mt-1 inline-flex rounded-full border border-cyan-300/40 bg-cyan-500/15 px-2 py-0.5 text-[10px] text-cyan-100">
          executed
        </div>
      ) : null}
      {!data.executed && data.running ? (
        <div className="mt-1 inline-flex rounded-full border border-amber-300/40 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-100">
          running
        </div>
      ) : null}
      <Handle type="target" id="in" position={Position.Left} className="!bg-slate-400/70" />
      <Handle
        type="source"
        id="success"
        position={Position.Right}
        className="!bg-emerald-400/80"
        style={{ top: data.type === 'runScenario' ? '35%' : '50%' }}
      />
      {data.type === 'runScenario' ? (
        <Handle
          type="source"
          id="error"
          position={Position.Right}
          className="!bg-rose-400/80"
          style={{ top: '70%' }}
        />
      ) : null}
    </div>
  );
};

export const FlowFallbackPanel = ({ label }: { label: string }) => (
  <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
    {label}
  </div>
);

export const FLOW_NODE_TYPES = {
  flowNode: FlowCanvasNode,
};
