import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Modal, Button } from '../ui';
import {
  startOAuthFlowSafe,
  pollOAuthStatusSafe,
  openUrlInBrowser,
} from '../../lib/tauri/modules/aiProxy';
import { ExternalLink, Loader2, Copy, Check } from 'lucide-react';

interface OAuthModalProps {
  isOpen: boolean;
  provider: string;
  providerName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const MAX_POLL_ATTEMPTS = 60; // 2 minutes (60 * 2 seconds)
const POLL_INTERVAL = 2000; // 2 seconds

export default function OAuthModal({
  isOpen,
  provider,
  providerName,
  onClose,
  onSuccess,
}: OAuthModalProps) {
  const [oauthUrl, setOauthUrl] = useState('');
  const [oauthState, setOauthState] = useState('');
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollAttempts, setPollAttempts] = useState(0);

  useEffect(() => {
    if (isOpen && provider) {
      initOAuth();
    }
    return () => {
      setPolling(false);
      setPollAttempts(0);
    };
  }, [isOpen, provider]);

  const initOAuth = async () => {
    try {
      setLoading(true);
      const response = await startOAuthFlowSafe(provider);
      if (!response) {
        toast.error('AI Proxy is not ready. Start the proxy and try again.');
        onClose();
        return;
      }
      setOauthUrl(response.url);
      setOauthState(response.state);
    } catch (e) {
      console.error('[OAuthModal] Failed to start OAuth:', e);
      const message = e instanceof Error ? e.message : String(e);
      if (/401\s*Unauthorized/i.test(message)) {
        toast.error(
          'AI Proxy auth mismatch detected. Restart AI Proxy from Settings and retry OAuth.'
        );
      }
      toast.error(`Failed to start OAuth: ${e instanceof Error ? e.message : String(e)}`);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleStartOAuth = async () => {
    if (!oauthUrl) return;

    try {
      setLoading(true);
      await openUrlInBrowser(oauthUrl);
      toast.success('Browser opened. Please complete authorization.');
      startPolling();
    } catch (e) {
      console.error('[OAuthModal] Failed to open browser:', e);
      toast.error(`Failed to open browser: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const startPolling = () => {
    setPolling(true);
    setPollAttempts(0);
    pollStatus();
  };

  const pollStatus = async () => {
    if (!oauthState) return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      setPollAttempts(attempts);

      if (attempts > MAX_POLL_ATTEMPTS) {
        clearInterval(interval);
        setPolling(false);
        toast.error('OAuth timeout. Please try again.');
        return;
      }

      try {
        const status = await pollOAuthStatusSafe(provider, oauthState);
        if (!status) {
          // Proxy not available; keep waiting silently.
          return;
        }

        if (status.status === 'ok') {
          clearInterval(interval);
          setPolling(false);
          toast.success('OAuth completed successfully!');
          onSuccess();
        } else if (status.status === 'error') {
          clearInterval(interval);
          setPolling(false);
          toast.error(`OAuth failed: ${status.error || 'Unknown error'}`);
        }
      } catch (e) {
        console.error('[OAuthModal] Poll error:', e);
      }
    }, POLL_INTERVAL);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(oauthUrl);
      setCopied(true);
      toast.success('URL copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error('Failed to copy URL');
    }
  };

  const truncateUrl = (url: string, maxLength: number = 40) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Connect ${providerName}`}
      size="sm"
      closeOnBackdrop={!polling}
      closeOnEscape={!polling}
    >
      <div className="space-y-4">
        {/* Instructions */}
        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <p className="text-sm text-slate-300">
            Click the button below to open the authorization page in your browser. Complete the
            OAuth flow and return here.
          </p>
        </div>

        {/* Start OAuth Button */}
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={handleStartOAuth}
          disabled={loading || polling || !oauthUrl}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Loading...
            </>
          ) : polling ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Waiting for authorization... ({pollAttempts}/{MAX_POLL_ATTEMPTS})
            </>
          ) : (
            <>
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Authorization Page
            </>
          )}
        </Button>

        {/* Authorization URL */}
        {oauthUrl && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              Authorization URL
            </label>
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2.5 border border-white/10">
              <span className="flex-1 text-xs text-slate-300 font-mono truncate">
                {truncateUrl(oauthUrl)}
              </span>
              <button
                className="flex-shrink-0 p-1.5 rounded hover:bg-white/10 transition-colors"
                onClick={handleCopy}
                title="Copy URL"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Polling Status */}
        {polling && (
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
              <div>
                <p className="text-sm font-medium text-white">Waiting for authorization...</p>
                <p className="text-xs text-slate-400 mt-1">
                  Complete the OAuth flow in your browser
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <Button onClick={onClose} variant="secondary" disabled={polling}>
            {polling ? 'Cancel' : 'Close'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
