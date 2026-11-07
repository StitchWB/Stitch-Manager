import { listen, type UnlistenFn } from '@/lib/events';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';

interface FailoverPayload {
  served_model?: string;
  target?: string;
  attempts?: number;
  used_fallback?: boolean;
}

/** Surface a silent gateway failover (another provider/credential served the request) as a toast. */
export function startGatewayFailoverNotifications(): UnlistenFn {
  let disposed = false;
  let stop: UnlistenFn | null = null;

  void listen<FailoverPayload>('gateway.request.failover', (event) => {
    const data = event.payload ?? {};
    appToast.warning(
      t('aiHub.failover.toast', {
        provider: data.target ?? data.served_model ?? '?',
        attempts: data.attempts ?? 0,
      }),
      'ai-gateway',
    );
  }).then((unlisten) => {
    if (disposed) unlisten();
    else stop = unlisten;
  });

  return () => {
    disposed = true;
    stop?.();
  };
}
