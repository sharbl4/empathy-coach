/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Dev only: `fixtures` swaps HTTP for shared contract fixtures. Ignored in production builds. */
  readonly VITE_API_MODE?: 'http' | 'fixtures';
}

interface ImportMeta { readonly env: ImportMetaEnv; }
