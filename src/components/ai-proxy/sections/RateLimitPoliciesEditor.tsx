import { useMemo } from 'react';
import { Gauge, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import { AI_PROXY_PROVIDER_FILTERS } from '@/components/ai-proxy/providerMeta';
import {
  Button,
  EmptyState,
  GlassCard,
  IconButton,
  NumberInput,
  ProviderLogo,
  Select,
  StatusBadge,
  Toggle,
  Tooltip,
} from '@/components/ui';
import type { RateLimitPolicy } from '@/lib/backend/modules/backgroundManager';
import type { ProviderCapability } from '@/lib/backend/modules/aiProxy';
import { useAppStore } from '@/stores/app';

interface RateLimitPoliciesEditorProps {
  enabled: boolean;
  reservePercent: number;
  policies: RateLimitPolicy[];
  capabilities: ProviderCapability[];
  disabled?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onReservePercentChange: (value: number) => void;
  onPoliciesChange: (policies: RateLimitPolicy[]) => void;
}

const DEFAULT_POLICY: Omit<RateLimitPolicy, 'provider'> = {
  rpmLimit: 500,
  rpmWindowSeconds: 60,
  tpmLimit: 500_000,
  tpmWindowSeconds: 60,
};

export function RateLimitPoliciesEditor({
  enabled,
  reservePercent,
  policies,
  capabilities,
  disabled = false,
  onEnabledChange,
  onReservePercentChange,
  onPoliciesChange,
}: RateLimitPoliciesEditorProps) {
  const language = useAppStore(state => state.language);
  const isRu = language === 'ru';
  const copy = isRu
    ? {
      step: '01 · Ёмкость',
      title: 'Лимиты RPM и TPM',
      description:
        'Gateway пропускает запрос, только когда в обоих окнах есть место. Это предотвращает 429 до выбора аккаунта.',
      active: 'Применяются',
      inactive: 'Без ограничений',
      reserve: 'Резерв ёмкости',
      reserveHint: 'Оставляет запас на задержки метрик и параллельные запросы',
      provider: 'Провайдер',
      rpm: 'Запросов в окне',
      rpmUnit: 'RPM',
      rpmWindow: 'Окно RPM',
      tpm: 'Токенов в окне',
      tpmUnit: 'TPM',
      tpmWindow: 'Окно TPM',
      seconds: 'сек',
      add: 'Добавить лимит',
      remove: 'Удалить лимит',
      emptyTitle: 'Лимиты провайдеров не заданы',
      emptyDescription:
        'Добавьте реальную ёмкость тарифного плана. Провайдеры без правила считаются unlimited.',
      example: 'Пример: 500 запросов / 60 сек и 500K токенов / 6 сек',
    }
    : {
      step: '01 · Capacity',
      title: 'RPM and TPM limits',
      description:
        'The gateway admits a request only when both windows have capacity. This prevents 429s before account selection.',
      active: 'Enforced',
      inactive: 'Unlimited',
      reserve: 'Capacity reserve',
      reserveHint: 'Keeps headroom for metric delay and concurrent requests',
      provider: 'Provider',
      rpm: 'Requests per window',
      rpmUnit: 'RPM',
      rpmWindow: 'RPM window',
      tpm: 'Tokens per window',
      tpmUnit: 'TPM',
      tpmWindow: 'TPM window',
      seconds: 'sec',
      add: 'Add limit',
      remove: 'Remove limit',
      emptyTitle: 'No provider limits configured',
      emptyDescription:
        'Add the real capacity of the provider plan. Providers without a policy remain unlimited.',
      example: 'Example: 500 requests / 60 sec and 500K tokens / 6 sec',
    };

  const providerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const provider of AI_PROXY_PROVIDER_FILTERS) {
      if (provider.id !== 'all') ids.add(provider.id);
    }
    for (const capability of capabilities) ids.add(capability.provider);
    for (const policy of policies) ids.add(policy.provider);
    return Array.from(ids).sort((left, right) => left.localeCompare(right));
  }, [capabilities, policies]);

  const addPolicy = () => {
    const configured = new Set(policies.map(policy => policy.provider.toLowerCase()));
    const provider = providerIds.find(id => !configured.has(id.toLowerCase()));
    if (!provider) return;
    onPoliciesChange([...policies, { provider, ...DEFAULT_POLICY }]);
  };

  const updatePolicy = (index: number, patch: Partial<RateLimitPolicy>) => {
    onPoliciesChange(
      policies.map((policy, policyIndex) =>
        policyIndex === index ? { ...policy, ...patch } : policy
      )
    );
  };

  const removePolicy = (index: number) => {
    onPoliciesChange(policies.filter((_, policyIndex) => policyIndex !== index));
  };

  const hasAvailableProvider = providerIds.some(
    provider => !policies.some(policy => policy.provider.toLowerCase() === provider.toLowerCase())
  );

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] p-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-400/15">
            <Gauge size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-300/70">
              {copy.step}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{copy.title}</h3>
              <StatusBadge status={enabled ? 'active' : 'inactive'} size="sm" withDot>
                {enabled ? copy.active : copy.inactive}
              </StatusBadge>
            </div>
            <p className="mt-0.5 max-w-2xl text-[11px] leading-4 text-slate-400">{copy.description}</p>
          </div>
        </div>
        <Toggle
          label=""
          checked={enabled}
          onChange={onEnabledChange}
          disabled={disabled}
          tooltip={copy.description}
        />
      </div>

      <div className="space-y-2 p-3">
        <div className="flex flex-col gap-2 rounded-lg border border-white/[0.06] bg-vsc-bg/45 p-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-300" />
            <div>
              <div className="text-xs font-medium text-slate-200">{copy.reserve}</div>
              <div className="mt-0.5 text-[10px] leading-4 text-slate-500">
                {copy.reserveHint}
              </div>
            </div>
          </div>
          <div className="w-full shrink-0 sm:w-[150px]">
            <NumberInput
              label=""
              value={reservePercent}
              onChange={value => onReservePercentChange(Math.max(0, Math.min(50, value)))}
              min={0}
              max={50}
              step={5}
              unit="%"
              disabled={disabled || !enabled}
            />
          </div>
        </div>

        {policies.length === 0 ? (
          <EmptyState
            compact
            icon={Gauge}
            title={copy.emptyTitle}
            description={copy.emptyDescription}
            action={
              <Button
                variant="primary"
                size="xs"
                onClick={addPolicy}
                disabled={disabled || !hasAvailableProvider}
                leftIcon={<Plus size={12} />}
              >
                {copy.add}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {policies.map((policy, index) => {
              const options = providerIds
                .filter(
                  provider =>
                    provider === policy.provider ||
                    !policies.some(
                      candidate => candidate.provider.toLowerCase() === provider.toLowerCase()
                    )
                )
                .map(provider => ({ value: provider, label: provider }));
              return (
                <div
                  key={`${policy.provider}-${index}`}
                  className="grid gap-1.5 rounded-lg border border-white/[0.07] bg-vsc-bg/45 p-2 min-[860px]:grid-cols-[225px_minmax(0,1fr)_minmax(0,1fr)] min-[860px]:items-end"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ProviderLogo provider={policy.provider} size={20} colored />
                    <div className="min-w-0 flex-1">
                      <Select
                        label={copy.provider}
                        value={policy.provider}
                        onValueChange={provider => updatePolicy(index, { provider })}
                        options={options}
                        disabled={disabled || !enabled}
                      />
                    </div>
                    <Tooltip content={copy.remove}>
                      <IconButton
                        variant="danger"
                        size="sm"
                        onClick={() => removePolicy(index)}
                        disabled={disabled}
                        aria-label={`${copy.remove}: ${policy.provider}`}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </div>

                  <div className="grid grid-cols-[minmax(0,1fr)_124px] gap-1.5 rounded-md border border-white/[0.05] p-1.5">
                    <NumberInput
                      label={copy.rpm}
                      value={policy.rpmLimit}
                      onChange={rpmLimit => updatePolicy(index, { rpmLimit: Math.max(1, rpmLimit) })}
                      min={1}
                      max={2_000_000_000}
                      step={10}
                      unit={copy.rpmUnit}
                      disabled={disabled || !enabled}
                    />
                    <NumberInput
                      label={copy.rpmWindow}
                      value={policy.rpmWindowSeconds}
                      onChange={rpmWindowSeconds =>
                        updatePolicy(index, {
                          rpmWindowSeconds: Math.max(1, Math.min(3600, rpmWindowSeconds)),
                        })
                      }
                      min={1}
                      max={3600}
                      step={1}
                      unit={copy.seconds}
                      disabled={disabled || !enabled}
                    />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_124px] gap-1.5 rounded-md border border-white/[0.05] p-1.5">
                    <NumberInput
                      label={copy.tpm}
                      value={policy.tpmLimit}
                      onChange={tpmLimit => updatePolicy(index, { tpmLimit: Math.max(1, tpmLimit) })}
                      min={1}
                      max={2_000_000_000}
                      step={1000}
                      unit={copy.tpmUnit}
                      disabled={disabled || !enabled}
                    />
                    <NumberInput
                      label={copy.tpmWindow}
                      value={policy.tpmWindowSeconds}
                      onChange={tpmWindowSeconds =>
                        updatePolicy(index, {
                          tpmWindowSeconds: Math.max(1, Math.min(3600, tpmWindowSeconds)),
                        })
                      }
                      min={1}
                      max={3600}
                      step={1}
                      unit={copy.seconds}
                      disabled={disabled || !enabled}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
          <span className="text-[11px] text-slate-500">{copy.example}</span>
          <Button
            variant="secondary"
            size="xs"
            onClick={addPolicy}
            disabled={disabled || !hasAvailableProvider}
            leftIcon={<Plus size={12} />}
          >
            {copy.add}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
