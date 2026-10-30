// DEV ONLY. In-memory auth stand-in for VITE_API_MODE=fixtures. Never part of a production build:
// it is loaded through a dynamic import guarded by import.meta.env.DEV (see lib/services.ts).
import { id as fixtureUserId } from '@between/contracts/fixtures';
import { AuthFailure, type AuthAdapter, type AuthState } from './types';

interface Account { password: string; confirmed: boolean; }

export function createFixtureAuth(): AuthAdapter {
  const accounts = new Map<string, Account>();
  const listeners = new Set<(state: AuthState) => void>();
  let state: AuthState = { user: null, recovery: false };
  const publish = (next: AuthState) => { state = next; listeners.forEach(listener => listener(state)); };
  const pause = () => new Promise(resolve => setTimeout(resolve, 250));

  return {
    kind: 'fixtures',
    async init() { return state; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async accessToken() { return state.user ? 'dev-fixture-token' : null; },
    async refresh() { return state.user ? 'dev-fixture-token' : null; },
    async signUp(email, password) {
      await pause();
      if (password.length < 8) throw new AuthFailure('weak_password');
      // Dev mode skips the email round-trip; the check-email screen offers a labelled shortcut.
      accounts.set(email.toLowerCase(), { password, confirmed: false });
    },
    async resendSignup() { await pause(); },
    async signIn(email, password) {
      await pause();
      const account = accounts.get(email.toLowerCase());
      if (!account) { accounts.set(email.toLowerCase(), { password, confirmed: true }); }
      else if (account.password !== password) throw new AuthFailure('invalid_credentials');
      else if (!account.confirmed) throw new AuthFailure('email_not_confirmed');
      publish({ user: { id: fixtureUserId, email }, recovery: false });
    },
    async requestPasswordReset() { await pause(); },
    async updatePassword(password) {
      await pause();
      if (password.length < 8) throw new AuthFailure('weak_password');
      if (state.user?.email) accounts.set(state.user.email.toLowerCase(), { password, confirmed: true });
      publish({ ...state, recovery: false });
    },
    async signOut() { await pause(); publish({ user: null, recovery: false }); },
    dev: {
      async confirmEmail(email) {
        const account = accounts.get(email.toLowerCase());
        if (account) account.confirmed = true;
        publish({ user: { id: fixtureUserId, email }, recovery: false });
      },
      async openRecoveryLink(email) {
        publish({ user: { id: fixtureUserId, email }, recovery: true });
      },
    },
  };
}
