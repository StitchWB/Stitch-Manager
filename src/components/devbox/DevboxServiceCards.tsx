import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  devboxIngressControl,
  devboxStackStart,
  devboxTime,
  devboxWatchdogControl,
  type DevboxAccepted,
  type DevboxOverviewGateway,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { devboxLabel } from './labels';

const SERVICES = [
  { id: 'ingress', nameKey: 'devboxPage.serviceIngress', tipKey: 'devboxPage.tipVitalIngress' },
  { id: 'bridge', nameKey: 'devboxPage.serviceBridge', tipKey: 'devboxPage.tipVitalBridge' },
  { id: 'runner', nameKey: 'devboxPage.serviceRunner', tipKey: 'devboxPage.tipVitalRunner' },
  {
    id: 'watchdog',
    nameKey: 'devboxPage.serviceWatchdog',
    tipKey: 'devboxPage.tipVitalWatchdog',
  },
  {
    id: 'host_services',
    nameKey: 'devboxPage.serviceHost',
    tipKey: 'devboxPage.tipVitalHostServices',
  },
  {
    id: 'gateway',
    nameKey: 'devboxPage.serviceGateway',
    tipKey: 'devboxPage.tipVitalGateway',
  },
] as const;

const UP_VALUES = new Set(['up', 'on', 'true']);

const DOT_CLASSES = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  down: 'bg-red-400',
  unknown: 'bg-slate-500',
} as const;

const BORDER_CLASSES = {
  ok: 'border-white/10',
  warn: 'border-amber-500/30',
  down: 'border-amber-500/30',
  unknown: 'border-white/10',
} as const;

const VALUE_CLASSES = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  down: 'text-amber-300',
  unknown: 'text-slate-400',
} as const;

function findCard(cards: DevboxVitalCard[] | null, id: string): DevboxVitalCard | null {
  if (!Array.isArray(cards)) return null;
  return cards.find(c => c.id?.toLowerCase().includes(id) || c.title?.toLowerCase().includes(id)) ?? null;
}

const HOST_COUNT_RE = /^(\d+)\s*\/\s*(\d+)$/;

type CardState = 'ok' | 'warn' | 'down' | 'unknown';

function cardState(card: DevboxVitalCard | null, up: boolean): CardState {
  if (card === null) return 'unknown';
  if (up) return 'ok';
  if (card.tone === 'warn') return 'warn';
  if (card.tone === 'down') return 'down';
  return 'ok';
}

function gatewayVital(
  gateway: DevboxOverviewGateway | null,
  name: string,
): DevboxVitalCard | null {
  if (gateway === null || !gateway.enabled) return null;
  return {
    id: 'gateway',
    title: name,
    value: gateway.up ? 'up' : 'down',
    tone: gateway.up ? 'ok' : 'warn',
    sub: t('devboxPage.gatewayMetrics', { calls: gateway.calls, errors: gateway.errors }),
    updatedAt: null,
  };
}

function hostServicesState(card: DevboxVitalCard | null): CardState | null {
  if (card === null) return null;
  const match = HOST_COUNT_RE.exec(String(card.value ?? '').trim());
  if (!match) return null;
  const alive = Number(match[1]);
  const recorded = Number(match[2]);
  if (recorded === 0) return 'unknown';
  return alive > 0 ? 'ok' : 'warn';
}

export interface DevboxServiceCardsProps {
  cards: DevboxVitalCard[] | null;
  gateway: DevboxOverviewGateway | null;
  activeProfile: string;
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
}

export function DevboxServiceCards({
  cards,
  gateway,
  activeProfile,
  busy,
  onAction,
}: DevboxServiceCardsProps) {
  return (
    <DevboxSection title={t('devboxPage.sectionOverview')} testId="devbox-services">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        {SERVICES.map(service => {
          const card =
            service.id === 'gateway'
              ? gatewayVital(gateway, t(service.nameKey))
              : findCard(cards, service.id);
          if (service.id === 'gateway' && card === null) return null;
          const value = card ? String(card.value ?? '').toLowerCase() : null;
          const up = value !== null && UP_VALUES.has(value);
          const state =
            (service.id === 'host_services' ? hostServicesState(card) : null) ??
            cardState(card, up);
          const name = card ? devboxLabel(card.title) : t(service.nameKey);
          const hint = card?.hint ? devboxLabel(card.hint) : null;
          const tip = hint ? `${t(service.tipKey)} · ${hint}` : t(service.tipKey);
          const updatedAt = card?.updatedAt;

          let action = null;
          if (service.id === 'ingress' && card !== null && !up) {
            action = (
              <Button
                size="xs"
                variant="secondary"
                disabled={busy}
                data-testid="devbox-service-ingress-enable"
                onClick={() => onAction(devboxIngressControl('up'))}
              >
                {t('devboxPage.serviceEnable')}
              </Button>
            );
          }
          if (service.id === 'runner' && card !== null && !up) {
            action = (
              <Button
                size="xs"
                variant="secondary"
                disabled={busy || activeProfile === ''}
                data-testid="devbox-service-runner-restart"
                onClick={() => onAction(devboxStackStart(activeProfile, false))}
              >
                {t('devboxPage.restart')}
              </Button>
            );
          }
          if (service.id === 'bridge' && card !== null && !up) {
            action = (
              <Button
                size="xs"
                variant="secondary"
                disabled={busy || activeProfile === ''}
                data-testid="devbox-service-bridge-start"
                onClick={() => onAction(devboxStackStart(activeProfile, false))}
              >
                {t('devboxPage.promptChipStackStart')}
              </Button>
            );
          }
          if (service.id === 'watchdog' && card !== null) {
            action = (
              <Toggle
                size="sm"
                label=""
                checked={up}
                disabled={busy}
                tooltip={t('devboxPage.tipWatchdog')}
                onChange={next => onAction(devboxWatchdogControl(next ? 'start' : 'stop'))}
              />
            );
          }

          return (
            <Tooltip key={service.id} content={tip} wrapperClassName="min-w-0">
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg border bg-white/[0.02] px-2.5 py-1.5',
                  BORDER_CLASSES[state],
                )}
                data-testid={`devbox-service-${service.id}`}
              >
                <span
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASSES[state])}
                  aria-hidden
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-2xs uppercase tracking-wider text-slate-400">
                    {name}
                  </span>
                  <span
                    className={cn('truncate text-xs font-semibold', VALUE_CLASSES[state])}
                    data-testid={`devbox-service-value-${service.id}`}
                    title={card?.value}
                  >
                    {card === null ? '—' : card.value}
                  </span>
                  {card?.sub ? (
                    <span
                      className="truncate text-2xs text-slate-500"
                      data-testid={`devbox-service-sub-${service.id}`}
                    >
                      {card.sub}
                    </span>
                  ) : null}
                </span>
                {updatedAt !== null && updatedAt !== undefined && updatedAt !== '' && (
                  <span className="shrink-0 text-2xs text-slate-500">
                    {devboxTime(updatedAt)}
                  </span>
                )}
                {action && <span className="ml-auto shrink-0">{action}</span>}
              </div>
            </Tooltip>
          );
        })}
      </div>
    </DevboxSection>
  );
}
