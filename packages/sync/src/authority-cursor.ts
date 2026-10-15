import { isAuthorityCursor } from './authority-protocol';
import type { AuthorityCursor } from './authority-protocol';

export function classifyAuthorityCursor(
  current: AuthorityCursor,
  incoming: AuthorityCursor,
): 'next' | 'duplicate-or-stale' | 'gap' | 'reset-required' {
  if (!isAuthorityCursor(current) || !isAuthorityCursor(incoming)) {
    throw new TypeError('Invalid authority cursor');
  }
  if (current.generation !== incoming.generation || current.streamId !== incoming.streamId) {
    return 'reset-required';
  }
  if (incoming.revision <= current.revision) return 'duplicate-or-stale';
  if (current.revision < Number.MAX_SAFE_INTEGER && incoming.revision === current.revision + 1)
    return 'next';
  return 'gap';
}
