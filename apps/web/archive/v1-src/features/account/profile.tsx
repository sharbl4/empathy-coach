import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useServices } from '../../app/context';
import type { Me } from '../../lib/api/client';
import { errorMessage, isAbort } from '../../lib/api/errors';

interface ProfileValue { me: Me | null; loading: boolean; error: string | null; reload(): void; setMe(me: Me): void; }
const ProfileContext = createContext<ProfileValue | null>(null);

export function useProfile(): ProfileValue {
  const value = useContext(ProfileContext);
  if (!value) throw new Error('ProfileProvider missing');
  return value;
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { api } = useServices();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.me(controller.signal)
      .then(setMe)
      .catch(caught => { if (!isAbort(caught)) setError(errorMessage(caught)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, attempt]);

  const reload = useCallback(() => setAttempt(value => value + 1), []);
  return <ProfileContext.Provider value={{ me, loading, error, reload, setMe }}>{children}</ProfileContext.Provider>;
}
