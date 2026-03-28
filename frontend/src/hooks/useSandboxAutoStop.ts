import { useEffect, useRef } from 'react';
import { getAuthToken } from '../services/api';

/**
 * useSandboxAutoStop
 *
 * Automatically stops a running sandbox container when the user leaves
 * the editor page. Covers three scenarios:
 *
 *   1. Browser close / tab close / hard refresh
 *      → window 'beforeunload' fires.
 *      → Uses fetch({ keepalive: true }) so the request completes even
 *        as the page is torn down. keepalive is the only reliable way
 *        to fire a network request on page close — XHR and axios both
 *        get cancelled before they complete.
 *
 *   2. React Router in-app navigation (clicking sidebar links, back button)
 *      → 'beforeunload' does NOT fire for SPA navigation.
 *      → The useEffect cleanup function fires when the component unmounts,
 *        which is when React Router navigates away from ProjectEditorPage.
 *      → Uses a regular fetch (no keepalive needed — the JS runtime is
 *        still alive for in-app navigation).
 *
 *   3. User walks away / laptop sleeps / network drops
 *      → Neither handler fires.
 *      → The backend cron (ubiq:cleanup-sandboxes) catches these after
 *        the configured idle threshold (default 2 hours).
 *
 * The hook only fires stop requests when isRunning is true — it does
 * nothing if the sandbox was never started or was already stopped.
 */
export function useSandboxAutoStop(projectId: number, isRunning: boolean) {
    // Keep a ref so the beforeunload callback always sees the latest value
    // without needing to be re-registered every time isRunning changes.
    const isRunningRef = useRef(isRunning);

    useEffect(() => {
        isRunningRef.current = isRunning;
    }, [isRunning]);

    useEffect(() => {
        const apiUrl  = import.meta.env.VITE_API_URL;
        const stopUrl = `${apiUrl}/projects/${projectId}/stop`;

        /**
         * Send a stop request using fetch with keepalive: true.
         * keepalive allows the browser to complete the request even
         * after the page document has been unloaded. This is the
         * only reliable mechanism for fire-and-forget on page close.
         *
         * Limitations of keepalive:
         *   - Max body size: 64KB (fine for our empty POST)
         *   - No response handling (page is gone anyway)
         *   - Not supported in IE (not a concern here)
         */
        const stopWithBeacon = () => {
            if (!isRunningRef.current) return;
            const token = getAuthToken();
            if (!token) return;

            fetch(stopUrl, {
                method:    'POST',
                keepalive: true,               // survives page unload
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type':  'application/json',
                },
            }).catch(() => {
                // Errors are expected here — the page is closing.
                // The backend cron will clean up if this fails.
            });
        };

        /**
         * For React Router navigation (component unmount), we have a
         * live JS runtime so we can use a normal async fetch.
         * We fire it as a best-effort — no await, no error surfacing.
         */
        const stopNormal = () => {
            if (!isRunningRef.current) return;
            const token = getAuthToken();
            if (!token) return;

            fetch(stopUrl, {
                method:  'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type':  'application/json',
                },
            }).catch(() => {
                // Best-effort — cron handles failures
            });
        };

        // Register beforeunload for browser close/refresh
        window.addEventListener('beforeunload', stopWithBeacon);

        // Cleanup fires on React Router navigation (component unmount)
        return () => {
            window.removeEventListener('beforeunload', stopWithBeacon);
            stopNormal(); // fire stop on unmount (in-app navigation)
        };
    }, [projectId]); // projectId is stable — only re-register if project changes
}