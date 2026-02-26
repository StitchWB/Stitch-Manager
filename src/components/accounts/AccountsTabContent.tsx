import type { ReactNode } from 'react';

interface AccountsTabContentProps {
  children: ReactNode;
}

export function AccountsTabContent({ children }: AccountsTabContentProps) {
  return <div className="flex-1 overflow-hidden min-w-0">{children}</div>;
}
