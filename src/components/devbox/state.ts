import type { DevboxVitalCard } from '@/lib/backend/modules/devbox';

export type VitalState = 'healthy' | 'degraded' | 'down' | 'unknown' | 'pending' | 'disabled';

export const STATE_DOT: Record<VitalState, string> = {
  healthy: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  down: 'bg-red-400',
  unknown: 'bg-slate-500',
  pending: 'bg-indigo-400',
  disabled: 'bg-slate-600',
};

export const STATE_TEXT: Record<VitalState, string> = {
  healthy: 'text-emerald-300',
  degraded: 'text-amber-300',
  down: 'text-red-300',
  unknown: 'text-slate-400',
  pending: 'text-indigo-300',
  disabled: 'text-slate-500',
};

export const STATE_BORDER: Record<VitalState, string> = {
  healthy: 'border-white/10',
  degraded: 'border-amber-500/30',
  down: 'border-red-500/30',
  unknown: 'border-white/10',
  pending: 'border-indigo-500/30',
  disabled: 'border-white/10',
};

const STATE_LABEL_KEY: Record<VitalState, string> = {
  healthy: 'devboxPage.stateHealthy',
  degraded: 'devboxPage.stateDegraded',
  down: 'devboxPage.stateDown',
  unknown: 'devboxPage.stateUnknown',
  pending: 'devboxPage.statePending',
  disabled: 'devboxPage.stateDisabled',
};

export function vitalStateLabelKey(state: VitalState): string {
  return STATE_LABEL_KEY[state];
}

const UP_VALUES = new Set(['up', 'on', 'true']);
const HOST_COUNT_RE = /^(\d+)\s*\/\s*(\d+)$/;

export function parseHostCount(value: string): { alive: number; recorded: number } | null {
  const match = HOST_COUNT_RE.exec(String(value ?? '').trim());
  if (!match) return null;
  return { alive: Number(match[1]), recorded: Number(match[2]) };
}

export function findVitalCard(cards: DevboxVitalCard[] | null, id: string): DevboxVitalCard | null {
  if (!Array.isArray(cards)) return null;
  const needle = id.toLowerCase();
  return (
    cards.find(
      card => card.id?.toLowerCase().includes(needle) || card.title?.toLowerCase().includes(needle),
    ) ?? null
  );
}

export function cardVitalState(card: DevboxVitalCard | null, id: string): VitalState {
  if (card === null) return 'unknown';
  const value = String(card.value ?? '').trim().toLowerCase();
  if (id === 'host_services') {
    const count = parseHostCount(value);
    if (count === null) return card.tone === 'down' ? 'down' : card.tone === 'warn' ? 'degraded' : 'unknown';
    if (count.recorded === 0) return 'unknown';
    if (count.alive === 0) return 'down';
    if (count.alive < count.recorded) return 'degraded';
    return 'healthy';
  }
  if (UP_VALUES.has(value)) return 'healthy';
  if (value === 'down' || value === 'stopped') return 'down';
  if (value === 'off' || value === 'false' || value === 'disabled') return 'disabled';
  if (card.tone === 'down') return 'down';
  if (card.tone === 'warn') return 'degraded';
  return 'unknown';
}

const STACK_SERVICE_IDS = ['ingress', 'bridge', 'runner', 'watchdog', 'host_services'] as const;

export function stackVitalState(cards: DevboxVitalCard[] | null): VitalState {
  if (!Array.isArray(cards) || cards.length === 0) return 'unknown';
  const states: VitalState[] = [];
  for (const id of STACK_SERVICE_IDS) {
    const card = findVitalCard(cards, id);
    if (card === null) continue;
    const state = cardVitalState(card, id);
    if (state === 'disabled' || state === 'unknown') continue;
    states.push(state);
  }
  if (states.length === 0) return 'unknown';
  if (states.every(state => state === 'healthy')) return 'healthy';
  if (states.every(state => state === 'down')) return 'down';
  return 'degraded';
}
