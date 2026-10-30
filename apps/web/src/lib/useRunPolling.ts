import { useEffect, useState } from 'react';
import { useServices } from '../app/context';
import type { Run } from './api/client';
import { ApiFailure, errorMessage, isAbort } from './api/errors';

const INTERVAL_MS = 1500;
const MAX_CONSECUTIVE_ERRORS = 3;

export type PollState =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'done'; run: Run }
  | { phase: 'lost'; message: string };

/**
 * Polls GET /api/runs/:id every 1.5 s until succeeded/failed.
 * Stops on unmount or when runId changes (navigation), and after repeated errors
 * it gives up with a retry option instead of polling forever.
 */
export function useRunPolling(runId: string | null): { state: PollState; resume(): void } {
  const { api } = useServices();
  const [state, setState] = useState<PollState>({ phase: 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!runId) { setState({ phase: 'idle' }); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errors = 0;
    setState({ phase: 'waiting' });

    const tick = async () => {
      try {
        const run = await api.run(runId, controller.signal);
        errors = 0;
        if (run.status !== 'pending') { setState({ phase: 'done', run }); return; }
      } catch (error) {
        if (isAbort(error) || controller.signal.aborted) return;
        // 404 means the run (or its session) is gone; 401 is handled by the session-expired path.
        if (error instanceof ApiFailure && (error.code === 'NOT_FOUND' || error.code === 'UNAUTHORIZED')) { setState({ phase: 'lost', message: errorMessage(error) }); return; }
        if (++errors >= MAX_CONSECUTIVE_ERRORS) { setState({ phase: 'lost', message: 'Связь с сервером прервалась. Разбор продолжается — проверьте результат снова.' }); return; }
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, INTERVAL_MS);
    };
    timer = setTimeout(tick, INTERVAL_MS);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [api, runId, attempt]);

  return { state, resume: () => setAttempt(value => value + 1) };
}
