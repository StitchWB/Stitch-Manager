import { Loader2, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ConfirmActionButton } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  checkGoogleOAuthCallback,
  disconnectGoogleOAuth,
  getGoogleOAuthStatus,
  startGoogleOAuth,
} from '@/lib/backend/modules/googleSheets';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;

export interface OAuthConnectButtonProps {
  /** Called whenever OAuth status changes (mount, connect, disconnect). */
  onStatusChange: (connected: boolean, email: string | null) => void;
}

type Phase = 'loading' | 'disconnected' | 'connecting' | 'connected' | 'error';

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.34-1.36-.34-2.1s.12-1.44.34-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function centerPopupFeatures(): string {
  const left = Math.max(0, (window.screen.availWidth - POPUP_WIDTH) / 2);
  const top = Math.max(0, (window.screen.availHeight - POPUP_HEIGHT) / 2);
  return `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`;
}

export function OAuthConnectButton({ onStatusChange }: OAuthConnectButtonProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);
  // Live refs so the interval callback sees fresh values without re-creating the interval.
  const phaseRef = useRef<Phase>('loading');
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const applyStatus = useCallback(
    (connected: boolean, emailValue: string | null) => {
      if (connected) {
        setPhase('connected');
        setEmail(emailValue);
        setErrorMessage(null);
      } else {
        setPhase('disconnected');
        setEmail(null);
      }
      onStatusChangeRef.current(connected, emailValue);
    },
    []
  );

  // Initial status check on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getGoogleOAuthStatus();
        if (cancelled) return;
        applyStatus(status.connected, status.email);
      } catch (err) {
        if (cancelled) return;
        // Backend may not implement the endpoint yet — fall back to disconnected.
        setPhase('disconnected');
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [applyStatus, stopPolling]);

  const handleConnect = useCallback(async () => {
    setErrorMessage(null);
    let authUrl: string;
    let oauthState: string;
    try {
      const response = await startGoogleOAuth();
      authUrl = response.authUrl;
      oauthState = response.state;
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      return;
    }

    const popup = window.open(authUrl, 'google-oauth', centerPopupFeatures());
    if (!popup) {
      setPhase('error');
      setErrorMessage(t('settings.googleSheets.oauth.popupBlocked'));
      return;
    }

    setPhase('connecting');
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
    stopPolling();

    pollTimerRef.current = setInterval(async () => {
      // User closed popup before completing.
      if (popup.closed && phaseRef.current === 'connecting') {
        // One last callback check — the callback may have completed just before close.
        try {
          const callbackResult = await checkGoogleOAuthCallback(oauthState);
          if (callbackResult.received && callbackResult.success) {
            stopPolling();
            applyStatus(true, callbackResult.email);
            return;
          }
        } catch {
          /* fall through to timeout/disconnect */
        }
        stopPolling();
        setPhase('disconnected');
        return;
      }

      if (Date.now() > pollDeadlineRef.current) {
        stopPolling();
        setPhase('error');
        setErrorMessage(t('settings.googleSheets.oauth.timeout'));
        return;
      }

      try {
        const callbackResult = await checkGoogleOAuthCallback(oauthState);
        if (callbackResult.received && callbackResult.success) {
          stopPolling();
          applyStatus(true, callbackResult.email);
        }
      } catch {
        // Transient polling error — keep trying until deadline.
      }
    }, POLL_INTERVAL_MS);
  }, [applyStatus, stopPolling]);

  const handleDisconnect = useCallback(async () => {
    setErrorMessage(null);
    try {
      await disconnectGoogleOAuth();
      applyStatus(false, null);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [applyStatus]);

  if (phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>{t('settings.googleSheets.oauth.connecting')}</span>
      </div>
    );
  }

  if (phase === 'connected') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>{t('settings.googleSheets.oauth.connected', { email: email ?? '' })}</span>
        </div>
        <ConfirmActionButton
          size="sm"
          variant="danger"
          onConfirm={handleDisconnect}
          leftIcon={<LogOut className="w-3.5 h-3.5" />}
        >
          {t('settings.googleSheets.oauth.disconnect')}
        </ConfirmActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={handleConnect}
          disabled={phase === 'connecting'}
          leftIcon={<GoogleGlyph className="w-3.5 h-3.5" />}
        >
          {phase === 'connecting' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t('settings.googleSheets.oauth.connecting')}
            </>
          ) : (
            t('settings.googleSheets.oauth.connect')
          )}
        </Button>
      </div>
      {phase === 'error' && errorMessage && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
