import { t } from '@/lib/i18n';
import type { ActionItem, FleetInsight } from '@/lib/dashboard/insights';

export interface ActionTextContext {
  insights: FleetInsight[];
  providerNames: Record<string, string>;
  nearLimit: number;
  proxiesDead: number;
}

export function localizeAction(
  item: ActionItem,
  ctx: ActionTextContext,
): { message: string; actionLabel: string } {
  const providerName = (id: string) => ctx.providerNames[id] ?? id;

  if (item.id === 'quota-near') {
    return {
      message: t('dashboard.cc.queue.quotaNear', { count: ctx.nearLimit }),
      actionLabel: t('dashboard.cc.queue.openAccounts'),
    };
  }
  if (item.id === 'proxies-dead') {
    return {
      message: t('dashboard.cc.queue.proxiesDead', { count: ctx.proxiesDead }),
      actionLabel: t('dashboard.cc.queue.openSettings'),
    };
  }
  if (item.id === 'scheduler-stopped') {
    return {
      message: t('dashboard.cc.queue.schedulerStopped'),
      actionLabel: t('dashboard.cc.queue.openAutomation'),
    };
  }
  if (item.id.startsWith('service-down:')) {
    const id = item.id.slice('service-down:'.length);
    return {
      message: t('dashboard.cc.queue.serviceDown', { name: id }),
      actionLabel: t('dashboard.cc.queue.openPlugins'),
    };
  }
  if (item.id.startsWith('fleet-unreachable:')) {
    const providerId = item.id.slice('fleet-unreachable:'.length);
    const insight = ctx.insights.find(i => i.providerId === providerId);
    return {
      message: t('dashboard.cc.queue.fleetUnreachable', {
        provider: providerName(providerId),
        target: insight?.target ?? 0,
      }),
      actionLabel: t('dashboard.cc.queue.openAutoreg'),
    };
  }
  if (item.id.startsWith('fleet-gap:')) {
    const providerId = item.id.slice('fleet-gap:'.length);
    const insight = ctx.insights.find(i => i.providerId === providerId);
    const params = {
      provider: providerName(providerId),
      active: insight?.active ?? 0,
      target: insight?.target ?? 0,
    };
    return {
      message:
        insight && insight.daysToTarget !== null && insight.daysToTarget > 0
          ? t('dashboard.cc.queue.fleetGapEta', { ...params, days: insight.daysToTarget })
          : t('dashboard.cc.queue.fleetGap', params),
      actionLabel: t('dashboard.cc.queue.register'),
    };
  }
  return { message: item.message, actionLabel: item.actionLabel };
}
