import { useRef, useState } from 'react';
import { AuthFailure, authMessages, type AuthErrorKind } from '../../lib/auth/types';

/** Runs one auth action at a time and keeps a user-facing error. */
export function useAuthAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ kind: AuthErrorKind; message: string } | null>(null);
  const running = useRef(false);

  async function run(action: () => Promise<void>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      const failure = caught instanceof AuthFailure ? caught : new AuthFailure('unknown');
      setError({ kind: failure.kind, message: failure.message || authMessages[failure.kind] });
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { busy, error, setError, run };
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;
