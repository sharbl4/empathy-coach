// Picks the adapters once at startup. Components only see AuthAdapter and ApiClient,
// so switching between fixtures and HTTP never touches component code.
import { fixtureMode, supabaseConfigured } from './config';
import { createApiClient, type ApiClient } from './api/client';
import { createHttpTransport } from './api/http';
import { AuthFailure, type AuthAdapter } from './auth/types';

export interface Services {
  auth: AuthAdapter;
  api: ApiClient;
  /** `fixtures` is dev-only and always shown with a visible label. */
  mode: 'http' | 'fixtures';
  onSessionExpired(listener: () => void): () => void;
}

function unconfiguredAuth(): AuthAdapter {
  const refuse = async () => { throw new AuthFailure('not_configured'); };
  return {
    kind: 'supabase',
    init: async () => ({ user: null, recovery: false }),
    subscribe: () => () => {},
    accessToken: async () => null,
    refresh: async () => null,
    signUp: refuse, resendSignup: refuse, signIn: refuse, requestPasswordReset: refuse, updatePassword: refuse, signOut: async () => {},
  };
}

export async function loadServices(): Promise<Services> {
  const expired = new Set<() => void>();
  const onSessionExpired = (listener: () => void) => { expired.add(listener); return () => { expired.delete(listener); }; };

  if (import.meta.env.DEV && fixtureMode) {
    const [{ createFixtureAuth }, { createFixtureTransport }] = await Promise.all([import('./auth/fixtures'), import('./api/fixtures')]);
    return { auth: createFixtureAuth(), api: createApiClient(createFixtureTransport()), mode: 'fixtures', onSessionExpired };
  }

  let auth: AuthAdapter;
  if (supabaseConfigured) {
    const { createSupabaseAuth } = await import('./auth/supabase');
    auth = createSupabaseAuth();
  } else {
    auth = unconfiguredAuth();
  }
  const transport = createHttpTransport({
    accessToken: () => auth.accessToken(),
    refresh: () => auth.refresh(),
    onUnauthorized: () => expired.forEach(listener => listener()),
  });
  return { auth, api: createApiClient(transport), mode: 'http', onSessionExpired };
}
