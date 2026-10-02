import type { Connection } from './sync-hub';
import type { AuthorityTrackedSend, AuthorityTrackedSendOptions } from './frame-transport';

export interface AuthorityConnectionBinding {
  readonly sendTracked: (
    message: string,
    options?: AuthorityTrackedSendOptions,
  ) => AuthorityTrackedSend;
}

const bindings = new WeakMap<Connection, AuthorityConnectionBinding>();

/** Package-internal registration; callers cannot confer authority through Connection fields. */
export function registerAuthorityConnection(
  connection: Connection,
  binding: AuthorityConnectionBinding,
): void {
  bindings.set(connection, binding);
}

export function authorityConnectionBinding(
  connection: Connection,
): AuthorityConnectionBinding | undefined {
  return bindings.get(connection);
}

export function copyAuthorityConnectionBinding(source: Connection, target: Connection): void {
  const binding = bindings.get(source);
  if (binding) bindings.set(target, binding);
}

export function unregisterAuthorityConnection(connection: Connection): void {
  bindings.delete(connection);
}
