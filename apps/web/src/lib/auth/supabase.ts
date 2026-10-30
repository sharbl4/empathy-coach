import { createClient, isAuthError, isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { authRedirect, authRedirectUrl, supabaseKey, supabaseUrl } from '../config';
import { AuthFailure, type AuthAdapter, type AuthErrorKind, type AuthState } from './types';

function toFailure(error: unknown): AuthFailure {
  if (error instanceof AuthFailure) return error;
  if (isAuthRetryableFetchError(error)) return new AuthFailure('network');
  if (isAuthError(error)) {
    const byCode: Partial<Record<string, AuthErrorKind>> = {
      invalid_credentials: 'invalid_credentials', email_not_confirmed: 'email_not_confirmed',
      weak_password: 'weak_password', same_password: 'same_password',
      over_request_rate_limit: 'rate_limited', over_email_send_rate_limit: 'rate_limited',
      otp_expired: 'link_expired', flow_state_expired: 'link_expired', signup_disabled: 'signup_disabled',
      session_not_found: 'session_missing', refresh_token_not_found: 'session_missing',
    };
    const kind = (error.code && byCode[error.code]) || (error.status === 429 ? 'rate_limited' : error.name === 'AuthSessionMissingError' ? 'session_missing' : 'unknown');
    return new AuthFailure(kind);
  }
  if (error instanceof TypeError) return new AuthFailure('network');
  return new AuthFailure('unknown');
}

export function createSupabaseAuth(): AuthAdapter {
  // Implicit flow is the documented SPA default for SDK 2.76.1 (docs/services.md).
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  const listeners = new Set<(state: AuthState) => void>();
  let recovery = authRedirect.type === 'recovery';
  let state: AuthState = { user: null, recovery: false };
  const toState = (session: Session | null): AuthState => ({
    user: session ? { id: session.user.id, email: session.user.email ?? null } : null,
    recovery: Boolean(session) && recovery,
  });
  const publish = (next: AuthState) => { state = next; listeners.forEach(listener => listener(state)); };

  // Subscribe before init so a PASSWORD_RECOVERY event from the URL is not missed.
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    if (event === 'SIGNED_OUT') recovery = false;
    publish(toState(session));
  });

  const run = async (action: () => Promise<{ error: unknown }>): Promise<void> => {
    let result: { error: unknown };
    try { result = await action(); } catch (error) { throw toFailure(error); }
    if (result.error) throw toFailure(result.error);
  };

  return {
    kind: 'supabase',
    async init() {
      const { data, error } = await client.auth.getSession();
      if (error) recovery = false;
      state = toState(data.session);
      return state;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async accessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    async refresh() {
      const { data, error } = await client.auth.refreshSession();
      return error ? null : data.session?.access_token ?? null;
    },
    async signUp(email, password) {
      await run(() => client.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl('/auth/callback') } }));
    },
    async resendSignup(email) {
      await run(() => client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: authRedirectUrl('/auth/callback') } }));
    },
    async signIn(email, password) {
      await run(() => client.auth.signInWithPassword({ email, password }));
    },
    async requestPasswordReset(email) {
      await run(() => client.auth.resetPasswordForEmail(email, { redirectTo: authRedirectUrl('/auth/recovery') }));
    },
    async updatePassword(password) {
      await run(() => client.auth.updateUser({ password }));
      recovery = false;
      publish({ ...state, recovery: false });
    },
    async signOut() {
      recovery = false;
      await run(() => client.auth.signOut());
    },
  };
}
