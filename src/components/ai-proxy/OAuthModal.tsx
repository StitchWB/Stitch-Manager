import { t } from "@/lib/i18n";import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

import {
  providerAuthFlowStart,
  providerAuthFlowStatus,
  openUrlInBrowser } from
'../../lib/backend/modules/aiProxy';
import { ExternalLink, Loader2, Copy, Check } from 'lucide-react';
import { Button, IconButton, Modal } from '@/components/ui';

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
  onSuccess
}: OAuthModalProps) {
  const [oauthUrl, setOauthUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [flowType, setFlowType] = useState<'device_code' | 'auth_code' | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);

  const initOAuth = useCallback(async () => {
    try {
      setLoading(true);
      const response = await providerAuthFlowStart({ provider });
      setOauthUrl(response.authUrl);
      setSessionId(response.sessionId);
      setFlowType(response.flowType);
      setUserCode(response.userCode);
      setVerificationUri(response.verificationUri);
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
  }, [provider, onClose]);

  useEffect(() => {
    if (isOpen && provider) {
      void initOAuth();
    }
    return () => {
      setPolling(false);
      setPollAttempts(0);
      setFlowType(null);
      setUserCode(null);
      setVerificationUri(null);
    };
  }, [isOpen, provider, initOAuth]);

  const handleStartOAuth = async () => {
    if (!oauthUrl) return;

    try {
      setLoading(true);
      await openUrlInBrowser(oauthUrl);
      if (flowType === 'device_code') {
        toast.success('Verification page opened. Enter the code above to authorize.');
      } else {
        toast.success('Browser opened. Please complete authorization.');
      }
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
    if (!sessionId) return;

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
        const status = await providerAuthFlowStatus({ sessionId });

        if (status.phase === 'token_ready') {
          clearInterval(interval);
          setPolling(false);
          toast.success('OAuth completed successfully!');
          onSuccess();
        } else if (
        status.phase === 'failed' ||
        status.phase === 'expired' ||
        status.phase === 'cancelled')
        {
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
    } catch {
      toast.error('Failed to copy URL');
    }
  };

  const handleCopyCode = async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopiedCode(true);
      toast.success('Code copied to clipboard');
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error('Failed to copy code');
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
      closeOnEscape={!polling}>
      
      <div className="space-y-4">
        {/* Instructions */}
        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
          {flowType === 'device_code' ?
          <div className="space-y-2">
              <p className="text-sm text-slate-300 font-medium">{t("aiHub.o_auth_modal.device_code_authorization")}</p>
              <ol className="text-sm text-slate-400 list-decimal list-inside space-y-1">
                <li>{t("aiHub.o_auth_modal.open_the_verification_page_using_the_button_below")}</li>
                <li>{t("aiHub.o_auth_modal.enter_the_user_code_shown_above")}</li>
                <li>{t("aiHub.o_auth_modal.sign_in_with_your_aws_builder_id")}</li>
                <li>{t("aiHub.o_auth_modal.return_here_authorization_completes_automatically")}</li>
              </ol>
            </div> :

          <p className="text-sm text-slate-300">{t("aiHub.o_auth_modal.click_the_button_below_to_open_the_authorization_p")}


          </p>
          }
        </div>

        {/* Device Code Display */}
        {flowType === 'device_code' && userCode &&
        <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <p className="text-sm text-slate-300 mb-3">{t("aiHub.o_auth_modal.enter_this_code_on_the_verification_page")}</p>
            <div className="flex items-center gap-3">
              <code className="text-2xl font-mono font-bold text-white tracking-widest bg-white/10 px-4 py-2 rounded flex-1 text-center">
                {userCode}
              </code>
              <IconButton
              variant="ghost"
              size="sm"
              onClick={handleCopyCode}
              title="Copy Code"
              className="flex-shrink-0">
              
                {copiedCode ?
              <Check className="w-4 h-4 text-green-500" /> :

              <Copy className="w-4 h-4 text-slate-400" />
              }
              </IconButton>
            </div>
            {verificationUri &&
          <p className="text-xs text-slate-500 mt-2 truncate">{verificationUri}</p>
          }
          </div>
        }

        {/* Start OAuth Button */}
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={handleStartOAuth}
          disabled={loading || polling || !oauthUrl}>
          
          {loading ?
          <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("aiProxy.oAuthModal.loading")}
            </> :
          polling ?
          <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t("aiProxy.oAuthModal.waitingForAuthorization", { pollAttempts, maxPollAttempts: MAX_POLL_ATTEMPTS })}<br/>({pollAttempts}/{MAX_POLL_ATTEMPTS})
            </> :

          <>
              <ExternalLink className="w-4 h-4" />
              {flowType === 'device_code' ? t("aiProxy.oAuthModal.openVerificationPage") : t("aiProxy.oAuthModal.openAuthorizationPage")}
            </>
          }
        </Button>

        {/* Authorization URL */}
        {oauthUrl &&
        <div className="space-y-2">
            <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">
              {flowType === 'device_code' ? 'Verification URL' : 'Authorization URL'}
            </div>
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2.5 border border-white/10">
              <span className="flex-1 text-xs text-slate-300 font-mono truncate">
                {truncateUrl(oauthUrl)}
              </span>
              <IconButton
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              title="Copy URL"
              className="flex-shrink-0">
              
                {copied ?
              <Check className="w-4 h-4 text-green-500" /> :

              <Copy className="w-4 h-4 text-slate-400" />
              }
              </IconButton>
            </div>
          </div>
        }

        {/* Polling Status */}
        {polling &&
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-yellow-500 animate-spin" />
              <div>
                <p className="text-sm font-medium text-white">{t("aiHub.o_auth_modal.waiting_for_authorization")}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {flowType === 'device_code' ?
                'Enter the code on the verification page and sign in' :
                'Complete the OAuth flow in your browser'}
                </p>
              </div>
            </div>
          </div>
        }

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <Button onClick={onClose} variant="secondary" disabled={polling}>
            {polling ? 'Cancel' : 'Close'}
          </Button>
        </div>
      </div>
    </Modal>);

}