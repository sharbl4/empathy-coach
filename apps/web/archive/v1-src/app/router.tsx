// Minimal History API router. React Router is not in the approved dependency set,
// and the app needs only a handful of routes, a redirect and a leave guard.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export interface Location { pathname: string; search: string; }
type Listener = () => void;
/** Return true to allow the navigation. Called with the navigation to resume later. */
type Blocker = (retry: () => void) => boolean;

const listeners = new Set<Listener>();
let blocker: Blocker | null = null;
let snapshot: Location = read();

function read(): Location { return { pathname: window.location.pathname, search: window.location.search }; }
function emit() { snapshot = read(); listeners.forEach(listener => listener()); }

window.addEventListener('popstate', () => {
  const target = window.location.pathname + window.location.search;
  if (blocker && !blocker(() => { window.history.pushState(null, '', target); emit(); })) {
    // Undo the browser's back/forward until the user decides.
    window.history.pushState(null, '', snapshot.pathname + snapshot.search);
    return;
  }
  emit();
});

export function navigate(to: string, options: { replace?: boolean; force?: boolean } = {}) {
  const go = () => {
    if (to === snapshot.pathname + snapshot.search) return;
    if (options.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    emit();
    window.scrollTo(0, 0);
  };
  if (!options.force && blocker && !blocker(go)) return;
  go();
}

export function setNavigationBlocker(next: Blocker | null) { blocker = next; }

export function useLocation(): Location {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => snapshot);
}

/** Matches `/sessions/:id` style patterns. Returns params or null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

/** Only same-origin app paths are accepted as `next` targets. */
export function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/auth/')) return null;
  return value;
}
