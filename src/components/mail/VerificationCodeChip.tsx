import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { extractVerificationMatches } from '@/lib/mail/verificationCodes';
import type { VerificationCodeMatch } from '@/lib/mail/verificationCodes';
import { t } from '@/lib/i18n';

interface VerificationCodeChipProps {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  /** Stable id of the parent message - resets local UI state on change. */
  messageId: string;
}

async function writeToClipboard(value: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    clipboard?: { writeText(text: string): Promise<void> };
  };
  if (nav.clipboard) {
    try {
      await nav.clipboard.writeText(value);
      return true;
    } catch {
      // ignore - fall through to legacy path
    }
  }

  // Fallback for older webviews that don't expose the async clipboard API.
  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function VerificationCodeChip({
  subject,
  text,
  html,
  messageId,
}: VerificationCodeChipProps) {
  const matches = useMemo(
    () => extractVerificationMatches({ subject, text, html }).slice(0, 3),
    [subject, text, html]
  );

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Reset local copy-state whenever a different message is opened
  useEffect(() => {
    setCopiedKey(null);
  }, [messageId]);

  // Auto-clear the copied indicator after a few seconds
  useEffect(() => {
    if (!copiedKey) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  if (matches.length === 0) {
    return null;
  }

  const handleCopy = async (match: VerificationCodeMatch) => {
    const ok = await writeToClipboard(match.value);
    if (ok) {
      setCopiedKey(`${match.kind}:${match.value}`);
      toast.success(
        match.kind === 'code'
          ? t('mail.verificationCodeCopied')
          : t('mail.verificationLinkCopied')
      );
    } else {
      toast.error(t('mail.verificationCopyFailed'));
    }
  };

  const handleOpenLink = (url: string) => {
    // window.open works inside Backend webview and bubbles to the host browser
    // via the iframe sandbox base-target=_blank rule. Outside the sandbox we
    // open in a new tab.
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-1.5">
      {matches.map(match => {
        const key = `${match.kind}:${match.value}`;
        const isCopied = copiedKey === key;
        const Icon = match.kind === 'code' ? KeyRound : Link2;

        return (
          <div
            key={key}
            className="flex items-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2"
            role="group"
            aria-label={
              match.kind === 'code'
                ? t('mail.verificationCodeFound')
                : t('mail.verificationLinkFound')
            }
          >
            <Icon size={14} className="text-indigo-300 shrink-0" />

            {match.kind === 'code' ? (
              <code className="text-base font-mono font-semibold text-white tracking-wider">
                {match.value}
              </code>
            ) : (
              <span className="text-xs text-slate-200 truncate flex-1 min-w-0">
                {match.snippet || match.value}
              </span>
            )}

            <div className="ml-auto flex items-center gap-1 shrink-0">
              {match.kind === 'link' ? (
                <button
                  type="button"
                  onClick={() => handleOpenLink(match.value)}
                  title={t('mail.verificationLinkOpen')}
                  className="p-1 rounded text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <ExternalLink size={12} />
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  void handleCopy(match);
                }}
                title={t('mail.verificationCopyAction')}
                className={`text-[11px] px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${
                  isCopied
                    ? 'bg-emerald-500/20 text-emerald-200'
                    : 'text-slate-200 hover:text-white hover:bg-white/10'
                }`}
              >
                {isCopied ? <Check size={12} /> : <Copy size={12} />}
                {isCopied ? t('mail.verificationCopied') : t('mail.verificationCopyAction')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
