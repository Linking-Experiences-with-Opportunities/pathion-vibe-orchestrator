'use client';

import { useState, useEffect } from 'react';

interface RunnerStatus {
  path: 'browser' | 'server' | 'unknown';
  exitCode: number | null;
  reason: string | null;
  durationMs: number | null;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  cacheStatus: 'cached' | 'network' | 'unknown';
}

// Note: Window.__updateRunnerStatus is declared in src/types/window.d.ts

export default function RunnerDevPanel() {
  const [status, setStatus] = useState<RunnerStatus>({
    path: 'unknown',
    exitCode: null,
    reason: null,
    durationMs: null,
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    cacheStatus: 'unknown'
  });

  const [isVisible, setIsVisible] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    // Skip dev panel on mobile devices - not useful for mobile debugging
    if (typeof window !== 'undefined' && window.navigator) {
      const userAgent = window.navigator.userAgent;
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      if (isMobile) {
        return;
      }
    }

    // Set client-side flag
    setIsClient(true);
    
    // Initialize client-side status
    setStatus(prev => ({
      ...prev,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      crossOriginIsolated: (window as any).crossOriginIsolated === true
    }));

    // Register global update function
    window.__updateRunnerStatus = (newStatus: Partial<RunnerStatus>) => {
      setStatus(prev => ({ ...prev, ...newStatus }));
    };

    // Check cache status
    if ('caches' in window) {
      caches.open('PYODIDE_CACHE_v0282').then(cache => {
        cache.match('/pyodide/0.28.2/pyodide.js').then(response => {
          setStatus(prev => ({
            ...prev,
            cacheStatus: response ? 'cached' : 'network'
          }));
        });
      });
    }

    // Listen for telemetry events
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      if (args[0]?.includes?.('[Telemetry]')) {
        const event = args[0].split(' ')[1]?.replace(':', '');
        const props = args[1];
        
        if (event === 'run_duration_ms') {
          setStatus(prev => ({ ...prev, durationMs: props.duration }));
        } else if (event === 'fallback_used') {
          setStatus(prev => ({ ...prev, path: 'server', reason: props.reason }));
        }
      }
      originalConsoleLog.apply(console, args);
    };

    return () => {
      console.log = originalConsoleLog;
    };
  }, []);

  // Only show in development and on client side
  if (process.env.NODE_ENV !== 'development' || !process.env.NEXT_PUBLIC_SHOW_RUNNER_PANEL || !isClient) {
    return null;
  }

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsVisible(!isVisible)}
        className="fixed bottom-4 right-4 z-50 bg-blue-600 text-white p-2 rounded-full shadow-lg hover:bg-blue-700 transition-colors"
        title="Toggle Runner Debug Panel"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </button>

      {/* Debug Panel */}
      {isVisible && (
        <div className="fixed bottom-20 right-4 z-40 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-4 w-80 max-h-96 overflow-y-auto">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white">Runner Status</h3>
            <button
              onClick={() => setIsVisible(false)}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Path:</span>
              <span className={`font-mono ${
                status.path === 'browser' ? 'text-green-600' : 
                status.path === 'server' ? 'text-blue-600' : 
                'text-gray-500'
              }`}>
                {status.path}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Exit Code:</span>
              <span className={`font-mono ${
                status.exitCode === 0 ? 'text-green-600' :
                status.exitCode === 124 ? 'text-yellow-600' :
                status.exitCode === 137 ? 'text-orange-600' :
                status.exitCode !== null ? 'text-red-600' : 'text-gray-500'
              }`}>
                {status.exitCode ?? 'N/A'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Reason:</span>
              <span className="font-mono text-gray-700 dark:text-gray-300">
                {status.reason ?? 'N/A'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Duration:</span>
              <span className="font-mono text-gray-700 dark:text-gray-300">
                {status.durationMs ? `${status.durationMs}ms` : 'N/A'}
              </span>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-600 pt-2 mt-3">
              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">SAB:</span>
                <span className={status.sharedArrayBuffer ? 'text-green-600' : 'text-red-600'}>
                  {status.sharedArrayBuffer ? '✓' : '✗'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">COI:</span>
                <span className={status.crossOriginIsolated ? 'text-green-600' : 'text-red-600'}>
                  {status.crossOriginIsolated ? '✓' : '✗'}
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-gray-600 dark:text-gray-400">Cache:</span>
                <span className={
                  status.cacheStatus === 'cached' ? 'text-green-600' :
                  status.cacheStatus === 'network' ? 'text-yellow-600' : 'text-gray-500'
                }>
                  {status.cacheStatus === 'cached' ? '✓' : status.cacheStatus === 'network' ? '⚠' : '?'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
