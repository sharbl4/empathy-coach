import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Services } from '../lib/services';
import type { AuthState } from '../lib/auth/types';
import { clearDrafts } from '../lib/drafts';

const ServicesContext = createContext<Services | null>(null);
interface AuthContextValue extends AuthState { expired: boolean; clearExpired(): void; }
const AuthContext = createContext<AuthContextValue | null>(null);

export function useServices(): Services {
  const value = useContext(ServicesContext);
  if (!value) throw new Error('ServicesProvider missing');
  return value;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}

export function AppProviders({ services, initial, children }: { services: Services; initial: AuthState; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const [expired, setExpired] = useState(false);

  useEffect(() => services.auth.subscribe(next => {
    setState(previous => {
      // A different account must never see the previous account's unsaved text.
      if (previous.user && previous.user.id !== next.user?.id && next.user) clearDrafts();
      return next;
    });
    if (next.user) setExpired(false);
  }), [services]);

  useEffect(() => services.onSessionExpired(() => {
    // Keep in-memory drafts: the same person usually signs back in right away.
    setExpired(true);
    void services.auth.signOut().catch(() => undefined);
    setState({ user: null, recovery: false });
  }), [services]);

  return (
    <ServicesContext.Provider value={services}>
      <AuthContext.Provider value={{ ...state, expired, clearExpired: () => setExpired(false) }}>{children}</AuthContext.Provider>
    </ServicesContext.Provider>
  );
}
