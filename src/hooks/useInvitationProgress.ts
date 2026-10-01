import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLearning, fetchProgress, type ProgressData } from '../lib/invitationApi';
import type { LearningAttempt } from '../lib/invitationOutcomes';
import { captureAppError } from '../lib/monitoring';

/** The member's own record (attempts, moves, forecasts) plus family learning rows. */
export function useInvitationProgress(accountId: string | null) {
  const [data, setData] = useState<ProgressData | null>(null);
  const [learning, setLearning] = useState<LearningAttempt[]>([]);
  const [loading, setLoading] = useState(accountId !== null);
  const [error, setError] = useState(false);
  const request = useRef(0);

  const reload = useCallback(async () => {
    const id = ++request.current;
    if (!accountId) {
      setData(null);
      setLearning([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const [progress, rows] = await Promise.all([fetchProgress(accountId), fetchLearning()]);
      if (id !== request.current) return;
      setData(progress);
      setLearning(rows);
    } catch (loadError) {
      captureAppError(loadError);
      if (id === request.current) setError(true);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
    return () => { request.current += 1; };
  }, [reload]);

  return { data, learning, loading, error, reload };
}
