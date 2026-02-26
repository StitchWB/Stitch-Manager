import type { ReactNode } from 'react';

interface ServiceAccountsPanelProps {
  header?: ReactNode;
  body: ReactNode;
}

export function ServiceAccountsPanel({ header, body }: ServiceAccountsPanelProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className="flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
