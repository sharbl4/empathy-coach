// One Idempotency-Key per user intent. A network retry of the same intent with the
// same payload reuses the key, so the server returns the original run instead of a new one.
// The key is dropped once the server has answered (accepted or a definitive error).
const intents = new Map<string, { key: string; payload: string }>();

export function intentKey(scope: string, payload: unknown): string {
  const serialized = JSON.stringify(payload);
  const existing = intents.get(scope);
  if (existing && existing.payload === serialized) return existing.key;
  const key = crypto.randomUUID();
  intents.set(scope, { key, payload: serialized });
  return key;
}

export function finishIntent(scope: string) { intents.delete(scope); }
