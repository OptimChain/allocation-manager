import { useEffect } from 'react';

/**
 * Run `task` now and then every `intervalMs` while the tab is visible.
 *
 * - Hidden tabs don't poll (saves upstream rate-limit budget); on return the
 *   task runs immediately if a tick was missed.
 * - `task` receives an AbortSignal that fires on unmount or when `task` /
 *   `intervalMs` change, so callers can drop stale responses with
 *   `if (signal.aborted) return;` before setting state.
 * - Memoise `task` with useCallback: a new identity restarts the loop, which
 *   is exactly what you want when its inputs (symbol, range…) change.
 */
export function usePolling(
  task: (signal: AbortSignal) => unknown,
  intervalMs: number,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    let lastRun = 0;
    const run = () => {
      lastRun = Date.now();
      void task(controller.signal);
    };

    const timer = setInterval(() => {
      if (!document.hidden) run();
    }, intervalMs);
    const onVisibility = () => {
      if (!document.hidden && Date.now() - lastRun >= intervalMs) run();
    };

    run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [task, intervalMs, enabled]);
}
