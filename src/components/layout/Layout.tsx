import { ReactNode } from 'react';
import Sidebar from './Sidebar';
import { RolePreviewBanner } from '../auth/RolePreviewBanner';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen overflow-hidden flex flex-col text-slate-200" style={{ background: '#0a0a0d' }}>
      <RolePreviewBanner />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <main id="main-content" className="flex-1 min-h-0 overflow-hidden relative" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
