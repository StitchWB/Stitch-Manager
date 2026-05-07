import type { ProviderName } from '../../types/ui';
import type { SaveStatus } from '../../stores/registration';
import { AlertTriangle, EyeOff, Shield } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PROVIDER_REQUIREMENT_HINTS } from './providerRequirements';
import { IdentitySystemCard, type IdentityConfig, GlassCard, Badge } from '@/components/ui';

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
      <GlassCard className="p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
          <Shield className="w-8 h-8 text-orange-400" />
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">AWS Builder ID</h3>
        <p className="text-sm text-slate-400 mb-4">
          Настройте количество и режим headless во вкладке Движок, затем нажмите СТАРТ
        </p>
        <Badge variant="warning" size="lg" withDot withPulse>
          Готов
        </Badge>
      </GlassCard>
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
                    <EyeOff className="w-3 h-3" /> headless ВЫКЛ
                  </span>{' '}
                  рекомендуется
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
          // Map emailPattern to emailCustomPrefix for storage
          if ('emailPattern' in updates) {
            const { emailPattern, ...rest } = updates;
            onConfigChange({
              ...rest,
              emailCustomPrefix: emailPattern,
            });
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
