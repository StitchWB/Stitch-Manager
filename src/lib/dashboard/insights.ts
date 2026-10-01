export interface HealthPart {
  id: string;
  weight: number;
  score: number;
  detail: string;
}

export interface HealthReport {
  score: number;
  parts: HealthPart[];
}

export interface FleetAccount {
  provider: string;
  status: string;
  createdAt: string | number | null;
  quota: { used: number; limit: number } | null;
}

export interface RegEvent {
  providerId: string;
  at: number;
  ok: boolean;
}

export interface FleetInsight {
  providerId: string;
  active: number;
  target: number;
  pacePerDay: number | null;
  daysToTarget: number | null;
  attainable: boolean;
  successDeltaPct: number | null;
}

export interface ActionItem {
  id: string;
  severity: 'danger' | 'warn' | 'info';
  message: string;
  actionLabel: string;
  to: string | null;
}

const DAY_MS = 86_400_000;
const PACE_WINDOW_DAYS = 7;

export function computeHealth(parts: HealthPart[]): HealthReport {
  const weighted = parts.filter(part => part.weight > 0);
  if (weighted.length === 0) return { score: 100, parts };
  const totalWeight = weighted.reduce((sum, part) => sum + part.weight, 0);
  const raw = weighted.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight;
  return { score: Math.round(Math.min(100, Math.max(0, raw))), parts };
}

export function fleetHealthPart(
  activeByProvider: Record<string, number>,
  targets: Record<string, number>,
): HealthPart {
  const coverage = Object.entries(targets)
    .filter(([, target]) => target > 0)
    .map(([provider, target]) => Math.min((activeByProvider[provider] ?? 0) / target, 1));
  if (coverage.length === 0) {
    return { id: 'fleet', weight: 3, score: 100, detail: 'No fleet targets set' };
  }
  const score = (coverage.reduce((sum, value) => sum + value, 0) / coverage.length) * 100;
  return {
    id: 'fleet',
    weight: 3,
    score: Math.round(score),
    detail: `${coverage.length} targeted providers`,
  };
}

export function quotaHealthPart(accounts: FleetAccount[]): HealthPart {
  let withQuota = 0;
  let near = 0;
  for (const account of accounts) {
    if (account.quota === null || account.quota.limit <= 0) continue;
    withQuota += 1;
    if (account.quota.used / account.quota.limit > 0.8) near += 1;
  }
  if (withQuota === 0) {
    return { id: 'quota', weight: 2, score: 100, detail: 'No quota data' };
  }
  return {
    id: 'quota',
    weight: 2,
    score: Math.round((1 - near / withQuota) * 100),
    detail: `${near}/${withQuota} near limit`,
  };
}

export function servicesHealthPart(running: number, total: number): HealthPart {
  if (total <= 0) {
    return { id: 'services', weight: 2, score: 100, detail: 'No service plugins' };
  }
  return {
    id: 'services',
    weight: 2,
    score: Math.round((running / total) * 100),
    detail: `${running}/${total} running`,
  };
}

export function errorsHealthPart(errorCount24h: number): HealthPart {
  const score = errorCount24h <= 0 ? 100 : Math.max(0, 100 - errorCount24h * 10);
  return {
    id: 'errors',
    weight: 1,
    score,
    detail: `${errorCount24h} errors in 24h`,
  };
}

export function computeFleetInsights(
  accounts: FleetAccount[],
  targets: Record<string, number>,
  regEvents: RegEvent[],
  now: number,
): FleetInsight[] {
  const ids = new Set(accounts.map(account => account.provider));
  for (const id of Object.keys(targets)) ids.add(id);
  const windowStart = now - PACE_WINDOW_DAYS * DAY_MS;
  const prevStart = now - 2 * PACE_WINDOW_DAYS * DAY_MS;

  return [...ids].sort().map(providerId => {
    const own = accounts.filter(account => account.provider === providerId);
    const active = own.filter(account => account.status === 'active').length;
    const target = targets[providerId] ?? 0;

    const createdAts = own
      .map(account =>
        account.createdAt === null ? null : new Date(account.createdAt).getTime(),
      )
      .filter((value): value is number => value !== null && Number.isFinite(value));

    let pacePerDay: number | null = null;
    if (createdAts.length > 0) {
      const inWindow = createdAts.filter(ts => ts >= windowStart && ts <= now).length;
      const oldest = Math.min(...createdAts);
      const spanDays = Math.min(
        PACE_WINDOW_DAYS,
        Math.max(1, Math.ceil((now - Math.max(oldest, windowStart)) / DAY_MS)),
      );
      pacePerDay = Math.round((inWindow / spanDays) * 10) / 10;
    }

    const gap = target - active;
    const daysToTarget =
      gap <= 0 ? 0 : pacePerDay !== null && pacePerDay > 0 ? Math.ceil(gap / pacePerDay) : null;
    const attainable = gap <= 0 || (pacePerDay !== null && pacePerDay > 0);

    const ownEvents = regEvents.filter(event => event.providerId === providerId);
    const recent = ownEvents.filter(event => event.at >= windowStart && event.at <= now);
    const previous = ownEvents.filter(event => event.at >= prevStart && event.at < windowStart);
    let successDeltaPct: number | null = null;
    if (recent.length >= 3 && previous.length >= 3) {
      const rate = (events: RegEvent[]) => events.filter(event => event.ok).length / events.length;
      successDeltaPct = Math.round((rate(recent) - rate(previous)) * 100);
    }

    return { providerId, active, target, pacePerDay, daysToTarget, attainable, successDeltaPct };
  });
}

export function buildActionQueue(args: {
  insights: FleetInsight[];
  servicesDown: Array<{ id: string; name: string }>;
  proxiesDead: number;
  schedulerStopped: boolean;
  nearLimit: number;
}): ActionItem[] {
  const queue: ActionItem[] = [];
  if (args.nearLimit > 0) {
    queue.push({
      id: 'quota-near',
      severity: 'danger',
      message: `${args.nearLimit} accounts near quota limit`,
      actionLabel: 'Open accounts',
      to: '/accounts',
    });
  }
  for (const service of args.servicesDown) {
    queue.push({
      id: `service-down:${service.id}`,
      severity: 'danger',
      message: `${service.name} is not running`,
      actionLabel: 'Open plugins',
      to: '/plugins',
    });
  }
  for (const insight of args.insights) {
    if (insight.target > insight.active && !insight.attainable) {
      queue.push({
        id: `fleet-unreachable:${insight.providerId}`,
        severity: 'warn',
        message: `${insight.providerId}: target ${insight.target} unreachable at current pace`,
        actionLabel: 'Open autoreg',
        to: '/autoreg',
      });
    }
  }
  if (args.proxiesDead > 0) {
    queue.push({
      id: 'proxies-dead',
      severity: 'warn',
      message: `${args.proxiesDead} dead proxies in pool`,
      actionLabel: 'Open proxy library',
      to: '/settings',
    });
  }
  if (args.schedulerStopped) {
    queue.push({
      id: 'scheduler-stopped',
      severity: 'warn',
      message: 'Scheduler is stopped',
      actionLabel: 'Open automation',
      to: '/settings?category=automation',
    });
  }
  for (const insight of args.insights) {
    if (insight.target > insight.active && insight.attainable) {
      const eta = insight.daysToTarget === null ? '' : ` (~${insight.daysToTarget}d)`;
      queue.push({
        id: `fleet-gap:${insight.providerId}`,
        severity: 'info',
        message: `${insight.providerId}: ${insight.active}/${insight.target} active${eta}`,
        actionLabel: 'Register',
        to: '/autoreg',
      });
    }
  }
  return queue;
}
