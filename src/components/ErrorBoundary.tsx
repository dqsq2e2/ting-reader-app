import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-white dark:bg-slate-900 p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-slate-50 dark:bg-slate-800 rounded-2xl shadow-2xl p-6 border border-red-200 dark:border-red-900/30">
            <div className="flex items-center gap-3 mb-4 text-red-600 dark:text-red-400">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <h2 className="text-xl font-bold">应用遇到错误</h2>
            </div>
            
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              很抱歉，程序发生了一个意外错误导致无法继续运行。
            </p>

            <div className="bg-slate-900 text-slate-300 p-4 rounded-xl text-xs font-mono mb-6 overflow-x-auto border border-slate-700">
              <p className="text-red-400 font-bold mb-2">{this.state.error?.toString()}</p>
              <pre className="whitespace-pre-wrap opacity-70">
                {this.state.errorInfo?.componentStack || this.state.error?.stack || 'No stack trace available'}
              </pre>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                    // Clear cache/storage if needed? For now just reload
                    window.location.reload();
                }}
                className="flex-1 px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-primary-500/20"
              >
                刷新页面
              </button>
              <button
                 onClick={() => {
                    localStorage.clear();
                    window.location.reload();
                 }}
                 className="px-4 py-3 bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-900/20 dark:hover:bg-red-900/30 dark:text-red-400 font-bold rounded-xl transition-colors"
              >
                清除缓存重试
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
