
import type { ProviderName } from '../../types';
import type { SaveStatus } from '../../stores/registration';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PROVIDER_REQUIREMENT_HINTS } from './providerRequirements';
import { IdentitySystemCard, type IdentityConfig } from '@/components/ui';

interface IdentityTabProps {
  provider: ProviderName;
  identityConfig: IdentityConfig;
  onConfigChange: (updates: Partial<IdentityConfig>) => void;
  onTest: () => Promise<boolean>;
  disabled: boolean;
  saveStatus: SaveStatus;
  passwordSet: boolean;
  gmailAppPasswordSet: boolean;
  // Addy.io props
  onTestAddyio: () => Promise<void>;
  isTestingAddyio: boolean;
  addyioConnectionStatus: 'idle' | 'success' | 'error';
  addyioConnectionMessage: string;
  addyioAccountInfo: any;
  addyioDomains: string[];
}

export function IdentityTab({
  provider,
  identityConfig,
  onConfigChange,
  onTest,
  disabled,
  saveStatus,
  passwordSet,
  gmailAppPasswordSet,
  onTestAddyio,
  isTestingAddyio,
  addyioConnectionStatus,
  addyioConnectionMessage,
  addyioAccountInfo,
  addyioDomains,
}: IdentityTabProps) {
  // AWS doesn't need IMAP configuration
  if (provider === 'aws') {
    return (
      <div className="card border border-orange-500/20 p-8 text-center">
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-orange-500/10 flex items-center justify-center">
          <svg className="w-10 h-10 text-orange-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6.763 10.036c.022.615.022 1.194.022 1.773 0 .615 0 1.195-.022 1.773h-6.74c-.022-.578-.022-1.158-.022-1.773s0-1.195.022-1.773h6.74zm6.104 6.741c.434.638.868 1.195 1.302 1.753.434.558.868 1.116 1.302 1.674-1.085.434-2.17.723-3.255.868-.434-.578-.868-1.116-1.302-1.674-.434-.558-.868-1.116-1.302-1.753 1.085-.145 2.17-.434 3.255-.868zm-6.104-13.482c.022.615.022 1.194.022 1.773 0 .615 0 1.195-.022 1.773h-6.74c-.022-.578-.022-1.158-.022-1.773s0-1.195.022-1.773h6.74zm13.482 6.741c.022.578.022 1.158.022 1.773s0 1.195-.022 1.773h-6.74c.022-.578.022-1.158.022-1.773s0-1.195-.022-1.773h6.74zm-6.104-6.741c.434.638.868 1.195 1.302 1.753.434.558.868 1.116 1.302 1.674-1.085.434-2.17.723-3.255.868-.434-.578-.868-1.116-1.302-1.674-.434-.558-.868-1.116-1.302-1.753 1.085-.145 2.17-.434 3.255-.868zm-6.104 13.482c-.434-.638-.868-1.195-1.302-1.753-.434-.558-.868-1.116-1.302-1.674 1.085-.434 2.17-.723 3.255-.868.434.578.868 1.116 1.302 1.674.434.558.868 1.116 1.302 1.753-1.085.145-2.17.434-3.255.868z" />
          </svg>
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">AWS Builder ID</h3>
        <p className="text-sm text-slate-400 mb-6">
          Configure count and headless mode in Engine tab, then click START
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/30 text-sm text-orange-400">
          <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px] shadow-orange-500/50 animate-pulse" />
          Ready
        </div>
      </div>
    );
  }

  // IDE/Git Mode - Show IMAP Card
  return (
    <div className="space-y-4">
      {provider === 'openai' && PROVIDER_REQUIREMENT_HINTS.openai && (
        <div className={cn('rounded-lg p-3 border', 'bg-amber-500/5 border-amber-500/20')}>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white">
                {PROVIDER_REQUIREMENT_HINTS.openai.title}
              </div>
              <ul className="mt-1 text-[11px] text-slate-300 space-y-0.5">
                <li>• {PROVIDER_REQUIREMENT_HINTS.openai.points[0]}</li>
                <li>
                  • {PROVIDER_REQUIREMENT_HINTS.openai.points[1]} —{' '}
                  <span className="text-amber-300 font-semibold inline-flex items-center gap-1">
                    <EyeOff className="w-3 h-3" /> headless OFF
                  </span>{' '}
                  recommended
                </li>
                <li>• {PROVIDER_REQUIREMENT_HINTS.openai.points[2]}</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <IdentitySystemCard
        config={identityConfig}
        onChange={updates => {
          if ('emailPattern' in updates) {
            onConfigChange({ ...updates });
          } else {
            onConfigChange(updates);
          }
        }}
        onTest={onTest}
        disabled={disabled}
        saveStatus={saveStatus}
        passwordSet={passwordSet}
        gmailAppPasswordSet={gmailAppPasswordSet}
        // Addy.io props
        onTestAddyio={onTestAddyio}
        isTestingAddyio={isTestingAddyio}
        addyioConnectionStatus={addyioConnectionStatus}
        addyioConnectionMessage={addyioConnectionMessage}
        addyioAccountInfo={addyioAccountInfo}
        addyioDomains={addyioDomains}
      />
    </div>
  );
}
