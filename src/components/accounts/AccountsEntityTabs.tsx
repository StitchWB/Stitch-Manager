import { Users, LayoutGrid } from 'lucide-react';
import { TabButton } from '../ui/TabButton';

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
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <TabButton
        active={value === 'accounts'}
        onClick={() => onChange('accounts')}
        icon={<Users size={16} />}
        label={`Accounts (${accountsCount})`}
      />
      <TabButton
        active={value === 'profiles'}
        onClick={() => onChange('profiles')}
        icon={<LayoutGrid size={16} />}
        label={`Profiles (${profilesCount})`}
      />
    </div>
  );
}
