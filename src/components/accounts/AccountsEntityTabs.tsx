import { Users, LayoutGrid } from 'lucide-react';
import { TabButton } from '@/components/ui';
import { t } from '../../lib/i18n';

export type AccountsEntityTab = 'accounts' | 'profiles';

interface AccountsEntityTabsProps {
  value: AccountsEntityTab;
  onChange: (value: AccountsEntityTab) => void;
  accountsCount: number;
  profilesCount: number;
}

export function AccountsEntityTabs({
  value,
  onChange,
  accountsCount,
  profilesCount,
}: AccountsEntityTabsProps) {
  return (
    <div className="flex items-center gap-1 min-w-0 shrink-0">
      <TabButton
        active={value === 'accounts'}
        onClick={() => onChange('accounts')}
        icon={<Users size={14} />}
        label={
          <span className="flex items-center gap-1.5">
            <span className="hidden sm:inline">{t('accounts.entityAccounts')}</span>
            <span className="sm:hidden">{t('accounts.entityAccounts').slice(0, 3)}</span>
            <span className="text-[10px] text-slate-400 font-normal">{accountsCount}</span>
          </span>
        }
      />
      <TabButton
        active={value === 'profiles'}
        onClick={() => onChange('profiles')}
        icon={<LayoutGrid size={14} />}
        label={
          <span className="flex items-center gap-1.5">
            <span className="hidden sm:inline">{t('accounts.entityBrowserProfiles')}</span>
            <span className="sm:hidden">{t('accounts.entityProfiles')}</span>
            <span className="text-[10px] text-slate-400 font-normal">{profilesCount}</span>
          </span>
        }
      />
    </div>
  );
}
