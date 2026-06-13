import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Uses the legacy "lab" dark palette to match the original
 * "VisuLab Render Error" fallback screen — the one place those Tailwind tokens still apply.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[VisuLab] render error', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-black/95 p-8">
          <div className="bg-lab-surface w-full max-w-md space-y-3 rounded-2xl border border-lab-warning/40 p-8 text-center">
            <h1 className="text-lab-warning font-lab text-xl font-light">VisuLab Render Error</h1>
            <p className="text-lab-muted font-lab text-sm leading-relaxed">
              {this.state.error.message}
            </p>
            <button
              className="bg-lab-accent hover:bg-lab-accent/80 mt-2 w-full rounded-xl py-3 text-white font-lab text-sm transition active:scale-95"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
