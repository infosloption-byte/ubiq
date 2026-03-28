import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import './index.css';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,

  // Only run in production — no noise from local dev
  enabled: import.meta.env.PROD,

  environment: import.meta.env.MODE,

  // Capture 10% of sessions for performance tracing
  tracesSampleRate: 0.1,

  // Record what the user was doing before the error (breadcrumbs)
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      // Replay 5% of sessions, 100% of sessions with errors
      sessionSampleRate: 0.05,
      errorSampleRate: 1.0,
      // Mask all text/inputs by default — don't record user code
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <div className="min-h-screen bg-[#050509] flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 className="text-white text-xl font-bold">Something went wrong</h2>
            <p className="text-slate-400 text-sm">
              This error has been reported automatically. Try refreshing the page.
            </p>
            <p className="text-slate-600 text-xs font-mono">
              {(error as Error)?.message}
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={resetError}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => window.location.href = '/dashboard'}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 text-sm rounded-lg transition-colors border border-white/10"
              >
                Go to dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);