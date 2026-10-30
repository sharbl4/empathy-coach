// Public browser settings only. Model keys, DB URLs and admin keys never belong here.

const env = import.meta.env;

export const supabaseUrl = (env.VITE_SUPABASE_URL ?? '').trim();
export const supabaseKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
export const supabaseConfigured = supabaseUrl !== '' && supabaseKey !== '';

// Dev-only fixture mode. `import.meta.env.DEV` is false in production builds,
// so the fixture branch and its modules are removed from the bundle.
export const fixtureMode: boolean = env.DEV && env.VITE_API_MODE === 'fixtures';

// Auth links put status into the URL fragment. The SDK clears it, so keep only
// the safe status fields here, before the client is created. Tokens are dropped.
export interface AuthRedirectInfo { path: string; type: string | null; error: string | null; errorCode: string | null; }

function readRedirectInfo(): AuthRedirectInfo {
  const raw = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '');
  const query = typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, '');
  const hash = new URLSearchParams(raw);
  const search = new URLSearchParams(query);
  const pick = (key: string) => hash.get(key) ?? search.get(key);
  const path = typeof window === 'undefined' ? '/' : window.location.pathname;
  return { path, type: pick('type'), error: pick('error'), errorCode: pick('error_code') };
}

export const authRedirect: AuthRedirectInfo = readRedirectInfo();

export const authRedirectUrl = (path: '/auth/callback' | '/auth/recovery') => `${window.location.origin}${path}`;
