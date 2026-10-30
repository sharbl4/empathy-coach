// Unsaved form text lives only in this tab's memory: never localStorage, never logs.
// It survives in-app navigation and re-login after an expired session, not a reload.
const store = new Map<string, unknown>();

export function readDraft<T>(key: string): T | undefined { return store.get(key) as T | undefined; }
export function writeDraft<T>(key: string, value: T) { store.set(key, value); }
export function deleteDraft(key: string) { store.delete(key); }
export function clearDrafts() { store.clear(); }
/** Unsaved learning text (auth helpers such as the remembered email do not count). */
export function hasUnsavedDrafts() { return [...store.keys()].some(key => !key.startsWith('auth:')); }
