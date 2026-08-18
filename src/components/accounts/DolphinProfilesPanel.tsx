import type { ReactNode } from 'react';

interface DolphinProfilesPanelProps {
  header?: ReactNode;
  body: ReactNode;
}

export function DolphinProfilesPanel({ header, body }: DolphinProfilesPanelProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className="flex-1 overflow-hidden">{body}</div>
    </div>
  );
}
