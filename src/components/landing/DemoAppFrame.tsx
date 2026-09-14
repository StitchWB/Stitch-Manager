/* eslint-disable i18next/no-literal-string -- Demo frame copy (title bar,
    DEMO badge, boundary card) is deliberately static, inline showcase data;
    it never goes through the locale files (same policy as src/pages/Landing.tsx). */

import { Component, lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import Sidebar from '../layout/Sidebar';
import Dashboard from '../../pages/Dashboard';
import { Badge } from '../ui/Badge';
import { disableDemoBackend, enableDemoBackend } from '../../lib/backend/core/demoBackend';

const Accounts = lazy(() => import('../../pages/Accounts'));
const AutoReg = lazy(() => import('../../pages/AutoReg'));
const AiOverview = lazy(() => import('../../pages/AiOverview'));
const AiProviders = lazy(() => import('../../pages/AiProviders'));
const Radar = lazy(() => import('../../pages/Radar'));
const Friends = lazy(() => import('../../pages/Friends'));
const Marketplace = lazy(() => import('../../pages/Marketplace'));
const Automation = lazy(() => import('../../pages/Automation'));
const Mail = lazy(() => import('../../pages/Mail'));
const Tools = lazy(() => import('../../pages/Tools'));
const Totp = lazy(() => import('../../pages/Totp'));
const Scheduler = lazy(() => import('../../pages/Scheduler'));
const Settings = lazy(() => import('../../pages/Settings'));
const Logs = lazy(() => import('../../pages/Logs'));

interface BoundaryState {
  error: string | null;
}

class DemoFrameBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(err: unknown): BoundaryState {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center p-6">
          <div className="p-4 rounded-xl border border-white/[0.08] bg-black/40 text-center max-w-md">
            <p className="text-sm text-slate-200">
              Демо: страница не отрисовалась / Demo page failed to render
            </p>
            <p className="mt-1 text-2xs text-slate-500 break-words">{this.state.error}</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function DemoRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/app" element={<Dashboard />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/autoreg" element={<AutoReg />} />
      <Route path="/ai" element={<AiOverview />} />
      <Route path="/ai/:section" element={<AiProviders />} />
      <Route path="/radar" element={<Radar />} />
      <Route path="/friends" element={<Friends />} />
      <Route path="/marketplace" element={<Marketplace />} />
      <Route path="/automation" element={<Automation />} />
      <Route path="/automation/:tab" element={<Automation />} />
      <Route path="/scheduler" element={<Scheduler />} />
      <Route path="/mail" element={<Mail />} />
      <Route path="/tools" element={<Tools />} />
      <Route path="/totp" element={<Totp />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/logs" element={<Logs />} />
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

function DemoInner() {
  return (
    <MemoryRouter initialEntries={['/app']}>
      <DemoFrameBoundary>
        <div className="h-full flex flex-col" style={{ background: '#0a0a0d' }}>
          <div className="flex-1 flex min-h-0 overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <main className="flex-1 min-h-0 overflow-hidden relative">
                <Suspense
                  fallback={
                    <div className="h-full flex items-center justify-center text-sm text-slate-500">
                      Loading…
                    </div>
                  }
                >
                  <DemoRoutes />
                </Suspense>
              </main>
            </div>
          </div>
        </div>
      </DemoFrameBoundary>
    </MemoryRouter>
  );
}

export function DemoAppFrame() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<Root | null>(null);
  const aliveRef = useRef(false);

  // Nested react-router Routers are forbidden, so the demo app lives in its
  // own React root inside the scaled frame. StrictMode remounts reuse the
  // same root; only a real unmount (alive flag still false in the microtask)
  // destroys it.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    aliveRef.current = true;
    enableDemoBackend();
    if (!rootRef.current) {
      rootRef.current = createRoot(host);
    }
    rootRef.current.render(<DemoInner />);
    return () => {
      aliveRef.current = false;
      disableDemoBackend();
      queueMicrotask(() => {
        if (!aliveRef.current && rootRef.current) {
          rootRef.current.unmount();
          rootRef.current = null;
        }
      });
    };
  }, []);

  return (
    <div className="relative">
      <div className="rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-2xl shadow-2xl shadow-indigo-950/40 overflow-hidden">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />

        <div className="flex items-center justify-between gap-4 px-5 py-2.5 border-b border-white/[0.06]">
          <span className="text-xs md:text-sm text-slate-400 font-mono truncate">
            Stitch Manager — Dashboard
          </span>
          <Badge variant="warning" size="sm" className="shrink-0">
            Demo / Демо
          </Badge>
        </div>

        {/*
          Frame viewport. The embedded app is rendered at a fixed 1360px design
          width and scaled to fit (origin-top-left); each inner height is
          viewportHeight / scale so the scaled content fills the frame:
            md : 640 / 0.53 → 1208   lg: 680 / 0.72 → 945
            xl : 720 / 0.90 → 800    2xl: 760 / 1.0 → 760
          Descendant scrollbars are hidden — the dense dashboard clips cleanly.
        */}
        <div className="relative h-[640px] lg:h-[680px] xl:h-[720px] 2xl:h-[760px] overflow-hidden [&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden">
          <div
            className="origin-top-left flex flex-col overflow-hidden w-[1360px] 2xl:w-full h-[1208px] lg:h-[945px] xl:h-[800px] 2xl:h-[760px] scale-[0.53] lg:scale-[0.72] xl:scale-[0.9] 2xl:scale-100"
            style={{ background: '#0a0a0d' }}
          >
            <div ref={hostRef} className="h-full" />
          </div>

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
            style={{
              background:
                'linear-gradient(to top, #0a0a0d 8%, rgba(10,10,13,0) 100%)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default DemoAppFrame;
