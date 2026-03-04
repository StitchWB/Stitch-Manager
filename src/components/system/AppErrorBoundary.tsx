import React from 'react';
import { reportFrontendError } from '@/lib/observability/client';
import { ButtonBase } from '../ui';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message?: string;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message,
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportFrontendError('React ErrorBoundary caught an exception', error, {
      componentStack: info.componentStack,
    });
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#050508] text-slate-200 p-6">
          <div className="max-w-xl w-full rounded-xl border border-white/10 bg-black/30 p-6">
            <h1 className="text-lg font-semibold mb-3">UI crashed</h1>
            <p className="text-sm text-slate-300 mb-4">
              A runtime error occurred. The event has been logged.
            </p>
            <p className="text-xs text-slate-400 font-mono break-all">
              {this.state.message ?? 'Unknown render error'}
            </p>
            <ButtonBase
              className="mt-5 px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
              onClick={() => window.location.reload()}
            >
              Reload app
            </ButtonBase>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
