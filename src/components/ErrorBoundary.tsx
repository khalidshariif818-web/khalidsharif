import React from 'react';

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#E1DCC5] dark:bg-slate-950 text-slate-900 dark:text-slate-100">
          <div className="max-w-md w-full border border-[#D4CEB8] dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-xl space-y-4 shadow-sm">
            <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              We could not load this page properly. Please reload to try again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium rounded-md bg-[#0376B8] hover:bg-[#025E94] text-white dark:bg-sky-500 dark:text-slate-950"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
