import {
  buildActionQueue,
  computeFleetInsights,
  computeHealth,
  errorsHealthPart,
  fleetHealthPart,
  quotaHealthPart,
  servicesHealthPart,
  type FleetAccount,
  type RegEvent,
} from '@/lib/dashboard/insights';

const NOW = 1_750_000_000_000;
const DAY = 86_400_000;

const account = (provider: string, status = 'active', createdAt: number | null = null): FleetAccount => ({
  provider,
  status,
  createdAt,
  quota: null,
});

describe('computeHealth', () => {
  it('weights parts and rounds to 0..100', () => {
    const report = computeHealth([
      { id: 'a', weight: 3, score: 100, detail: '' },
      { id: 'b', weight: 1, score: 0, detail: '' },
    ]);
    expect(report.score).toBe(75);
    expect(report.parts).toHaveLength(2);
  });

  it('ignores zero-weight parts and reports 100 when nothing is weighted', () => {
    expect(computeHealth([{ id: 'a', weight: 0, score: 10, detail: '' }]).score).toBe(100);
    expect(computeHealth([]).score).toBe(100);
  });
});

describe('health parts', () => {
  it('fleet part averages coverage of targeted providers', () => {
    const part = fleetHealthPart({ kiro: 2 }, { kiro: 4, windsurf: 0 });
    expect(part.score).toBe(50);
  });

  it('fleet part is 100 without targets', () => {
    expect(fleetHealthPart({ kiro: 2 }, {}).score).toBe(100);
  });

  it('quota part scales with near-limit ratio', () => {
    const accounts = [
      { ...account('kiro'), quota: { used: 90, limit: 100 } },
      { ...account('kiro'), quota: { used: 10, limit: 100 } },
      { ...account('kiro'), quota: { used: 20, limit: 100 } },
      { ...account('kiro'), quota: { used: 30, limit: 100 } },
    ];
    expect(quotaHealthPart(accounts).score).toBe(75);
    expect(quotaHealthPart([account('kiro')]).score).toBe(100);
  });

  it('services part is running over total', () => {
    expect(servicesHealthPart(2, 4).score).toBe(50);
    expect(servicesHealthPart(0, 0).score).toBe(100);
  });

  it('errors part decays by 10 per error and floors at 0', () => {
    expect(errorsHealthPart(0).score).toBe(100);
    expect(errorsHealthPart(3).score).toBe(70);
    expect(errorsHealthPart(12).score).toBe(0);
  });
});

describe('computeFleetInsights', () => {
  it('derives pace from the creation span inside the 7d window', () => {
    const accounts = Array.from({ length: 7 }, (_, i) =>
      account('kiro', 'active', NOW - (5 - Math.floor(i / 2)) * DAY),
    );
    const [insight] = computeFleetInsights(accounts, {}, [], NOW);
    expect(insight.pacePerDay).toBe(1.4);
  });

  it('computes days to target from the gap and pace', () => {
    const accounts = Array.from({ length: 7 }, (_, i) =>
      account('kiro', 'inactive', NOW - (5 - Math.floor(i / 2)) * DAY),
    );
    const [insight] = computeFleetInsights(accounts, { kiro: 4 }, [], NOW);
    expect(insight.active).toBe(0);
    expect(insight.daysToTarget).toBe(3);
    expect(insight.attainable).toBe(true);
  });

  it('marks unreachable when there is no creation history', () => {
    const [insight] = computeFleetInsights([account('kiro', 'inactive')], { kiro: 4 }, [], NOW);
    expect(insight.pacePerDay).toBeNull();
    expect(insight.daysToTarget).toBeNull();
    expect(insight.attainable).toBe(false);
  });

  it('compares success rates of the last and previous 7d windows', () => {
    const events: RegEvent[] = [
      ...Array.from({ length: 3 }, (_, i) => ({ providerId: 'kiro', at: NOW - i * DAY, ok: true })),
      ...Array.from({ length: 3 }, (_, i) => ({ providerId: 'kiro', at: NOW - (8 + i) * DAY, ok: false })),
    ];
    const [insight] = computeFleetInsights([], { kiro: 0 }, events, NOW);
    expect(insight.successDeltaPct).toBe(100);
  });

  it('returns null delta when a window has fewer than 3 events', () => {
    const events: RegEvent[] = [
      { providerId: 'kiro', at: NOW - DAY, ok: true },
      ...Array.from({ length: 3 }, (_, i) => ({ providerId: 'kiro', at: NOW - (8 + i) * DAY, ok: false })),
    ];
    const [insight] = computeFleetInsights([], { kiro: 0 }, events, NOW);
    expect(insight.successDeltaPct).toBeNull();
  });

  it('unions account providers and target keys, sorted', () => {
    const insights = computeFleetInsights([account('windsurf')], { kiro: 1 }, [], NOW);
    expect(insights.map(i => i.providerId)).toEqual(['kiro', 'windsurf']);
  });
});

describe('buildActionQueue', () => {
  it('orders danger, warn, info with stable ids', () => {
    const insights = computeFleetInsights(
      [account('kiro', 'inactive'), account('trae', 'inactive')],
      { kiro: 4, trae: 2 },
      [],
      NOW,
    );
    const kiro = insights.find(i => i.providerId === 'kiro')!;
    const trae = insights.find(i => i.providerId === 'trae')!;
    const queue = buildActionQueue({
      insights: [
        { ...kiro, pacePerDay: null, attainable: false },
        { ...trae, pacePerDay: 1, daysToTarget: 2, attainable: true },
      ],
      servicesDown: [{ id: 'stitch-mail', name: 'Stitch Mail' }],
      proxiesDead: 3,
      schedulerStopped: true,
      nearLimit: 2,
    });
    expect(queue.map(item => item.id)).toEqual([
      'quota-near',
      'service-down:stitch-mail',
      'fleet-unreachable:kiro',
      'proxies-dead',
      'scheduler-stopped',
      'fleet-gap:trae',
    ]);
    expect(queue[0].severity).toBe('danger');
    expect(queue[5].message).toContain('~2d');
  });

  it('is empty when everything is healthy', () => {
    expect(
      buildActionQueue({ insights: [], servicesDown: [], proxiesDead: 0, schedulerStopped: false, nearLimit: 0 }),
    ).toEqual([]);
  });
});
