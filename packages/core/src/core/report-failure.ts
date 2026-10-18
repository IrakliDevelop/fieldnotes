/** Reports a contained failure; reportError reaches window 'error' listeners so host monitoring sees it. */
export function reportFailure(error: unknown, label: string): void {
  if (typeof reportError === 'function') reportError(error);
  else console.error(`[fieldnotes] ${label}`, error);
}
