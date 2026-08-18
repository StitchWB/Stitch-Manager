import { useState } from 'react';
import { cn } from '../../lib/utils';
import { Copy, Check, Key, CheckCircle2, FileText } from 'lucide-react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { Tooltip } from '../Tooltip';

interface SuccessCardProps {
  email: string;
  hasToken?: boolean;
  onCopyToken?: () => void;
  className?: string;
}

export function SuccessCard({ email, hasToken, onCopyToken, className }: SuccessCardProps) {
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const { copy } = useCopyToClipboard();

  const handleCopyEmail = async () => {
    await copy(email);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleCopyToken = async () => {
    if (onCopyToken) {
      onCopyToken();
    }
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleCopyJson = async () => {
    const jsonData = JSON.stringify({ email, hasToken }, null, 2);
    await copy(jsonData);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  // COMPACT MODE: Thin alert strip (h-12) instead of large card
  return (
    <div 
      className={cn(
        'relative h-12 px-3 overflow-hidden animate-in slide-in-from-top-2 duration-300',
        'border-y border-emerald-500/20 bg-emerald-500/10 flex items-center gap-3',
        className
      )}
    >
      {/* Check icon */}
      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />

      {/* Email - bold and prominent */}
      <span className="flex-1 min-w-0 font-mono text-sm font-bold text-white truncate">
        {email}
      </span>

      {/* Compact action buttons - icon only */}
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip content="Copy Email">
          <button
            onClick={handleCopyEmail}
            className={cn(
              'p-1.5 rounded transition-all text-[10px] flex items-center gap-1',
              copiedEmail 
                ? 'bg-emerald-500/30 text-emerald-300' 
                : 'bg-white/10 text-slate-400 hover:text-white hover:bg-white/20'
            )}
          >
            {copiedEmail ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </Tooltip>
        
        {hasToken && (
          <>
            <Tooltip content="Copy Token">
              <button
                onClick={handleCopyToken}
                className={cn(
                  'p-1.5 rounded transition-all text-[10px] flex items-center gap-1',
                  copiedToken 
                    ? 'bg-cyan-500/30 text-cyan-300' 
                    : 'bg-white/10 text-slate-400 hover:text-white hover:bg-white/20'
                )}
              >
                {copiedToken ? <Check className="w-3 h-3" /> : <Key className="w-3 h-3" />}
              </button>
            </Tooltip>
            <Tooltip content="Copy JSON">
              <button
                onClick={handleCopyJson}
                className={cn(
                  'p-1.5 rounded transition-all text-[10px] flex items-center gap-1',
                  copiedJson 
                    ? 'bg-indigo-500/30 text-indigo-300' 
                    : 'bg-white/10 text-slate-400 hover:text-white hover:bg-white/20'
                )}
              >
                {copiedJson ? <Check className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
